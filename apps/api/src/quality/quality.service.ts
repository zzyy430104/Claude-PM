import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { NcSeverity, NcStatus } from '../generated/prisma/enums.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthUser } from '../common/auth.types.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ProjectAccess, ProjectCtx } from '../projects/access.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { CreateNcDto, NcTransitionDto, UpdateNcDto, UpdateQualityPlanDto } from './quality.dto.js';

/** 项目质量管理（8.1.3.6）：项目质量计划（含质量保证与质量控制活动）与项目不符合项 / 整改（CAR） */
@Injectable()
export class QualityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: ProjectAccess,
    private readonly notifications: NotificationsService,
  ) {}

  // ───── 质量计划 ─────

  async getPlan(actor: AuthUser, projectId: string) {
    const ctx = await this.access.load(actor, projectId);
    const plan = await this.prisma.qualityPlan.findUnique({ where: { projectId } });
    return plan ?? { projectId, tenantId: ctx.tenantId, objectives: '', procedures: '', activities: [], version: 0, approvedAt: null, approvedById: null };
  }

  async updatePlan(actor: AuthUser, projectId: string, dto: UpdateQualityPlanDto) {
    const ctx = await this.access.load(actor, projectId);
    this.access.requireManagerOrQuality(ctx);
    this.access.requireOpen(ctx);
    const data = { objectives: dto.objectives, procedures: dto.procedures, activities: dto.activities as unknown as Prisma.InputJsonValue | undefined };
    // 修改后需重新批准
    return this.audit.tx(
      actor,
      { action: 'qualityPlan.update', entity: 'QualityPlan', entityId: () => projectId, after: (p) => ({ version: p.version }) },
      (tx) =>
        tx.qualityPlan.upsert({
          where: { projectId },
          create: { ...data, projectId, tenantId: ctx.tenantId, updatedById: actor.id },
          update: { ...data, version: { increment: 1 }, approvedAt: null, approvedById: null, updatedById: actor.id },
        }),
    );
  }

  /** 批准质量计划：至少包含一项质量保证（QA）和一项质量控制（QC）活动 */
  async approvePlan(actor: AuthUser, projectId: string) {
    const ctx = await this.access.load(actor, projectId);
    if (!ctx.isQuality) throw new ForbiddenException('Project quality manager required');
    const plan = await this.prisma.qualityPlan.findUnique({ where: { projectId } });
    if (!plan) throw new NotFoundException('Quality plan not found');
    const acts = (plan.activities as { kind: string }[]) ?? [];
    if (!acts.some((a) => a.kind === 'QA') || !acts.some((a) => a.kind === 'QC')) {
      throw new ConflictException({ code: 'QUALITY_PLAN_INCOMPLETE', message: 'The quality plan needs at least one QA and one QC activity' });
    }
    return this.audit.tx(
      actor,
      { action: 'qualityPlan.approve', entity: 'QualityPlan', entityId: () => projectId, after: (p) => ({ version: p.version }) },
      (tx) => tx.qualityPlan.update({ where: { projectId }, data: { approvedAt: new Date(), approvedById: actor.id } }),
    );
  }

  // ───── 不符合项 / CAR ─────

  async listNc(actor: AuthUser, projectId: string) {
    const ctx = await this.access.load(actor, projectId);
    return this.prisma.nonconformity.findMany({ where: { projectId, tenantId: ctx.tenantId }, orderBy: { createdAt: 'desc' } });
  }

  async createNc(actor: AuthUser, projectId: string, dto: CreateNcDto) {
    const ctx = await this.access.load(actor, projectId);
    this.access.requireOpen(ctx);
    if (!ctx.member && !ctx.isManager) throw new ForbiddenException('Project members only');
    await this.checkRefs(ctx, dto.phaseId, dto.workPackageId);
    const count = await this.prisma.nonconformity.count({ where: { projectId } });
    const code = `NC-${String(count + 1).padStart(3, '0')}`;
    try {
      return await this.audit.tx(
        actor,
        { action: 'nonconformity.create', entity: 'Nonconformity', entityId: (n) => n.id, after: (n) => ({ code: n.code, severity: n.severity, title: n.title }) },
        (tx) => tx.nonconformity.create({ data: { ...dto, tenantId: ctx.tenantId, projectId, code, detectedById: actor.id } }),
      );
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new ConflictException('Please retry: nonconformity number collision');
      throw e;
    }
  }

  async updateNc(actor: AuthUser, projectId: string, id: string, dto: UpdateNcDto) {
    const ctx = await this.access.load(actor, projectId);
    this.access.requireOpen(ctx);
    const nc = await this.findNc(ctx, id);
    if (nc.status === NcStatus.CLOSED) throw new ConflictException('Nonconformity is closed');
    if (!ctx.isManager && !ctx.isQuality && nc.actionOwnerId !== actor.id) throw new ForbiddenException('Quality or project management required');
    if (dto.actionOwnerId) {
      const m = await this.prisma.projectMember.findFirst({ where: { projectId, tenantId: ctx.tenantId, userId: dto.actionOwnerId, active: true } });
      if (!m) throw new BadRequestException('Action owner must be an active project member');
    }
    if (dto.changeRequestId) {
      const cr = await this.prisma.changeRequest.findFirst({ where: { id: dto.changeRequestId, projectId, tenantId: ctx.tenantId } });
      if (!cr) throw new BadRequestException('Change request not found in this project');
    }
    return this.audit.tx(
      actor,
      { action: 'nonconformity.update', entity: 'Nonconformity', entityId: () => id, after: (n) => ({ status: n.status }) },
      (tx) => tx.nonconformity.update({ where: { id }, data: { ...dto, actionDueDate: dto.actionDueDate ? new Date(dto.actionDueDate) : undefined } }),
    );
  }

  /**
   * 状态流转：OPEN → ANALYSIS → ACTION → VERIFICATION → CLOSED
   * 分析完成才能制定措施；措施完成才能验证；验证人不能是措施负责人；严重和重大不符合项须由质量经理关闭
   */
  async transition(actor: AuthUser, projectId: string, id: string, dto: NcTransitionDto) {
    const ctx = await this.access.load(actor, projectId);
    this.access.requireOpen(ctx);
    const nc = await this.findNc(ctx, id);
    const from = nc.status;
    const to = dto.to;
    const ok =
      (from === NcStatus.OPEN && to === NcStatus.ANALYSIS) ||
      (from === NcStatus.ANALYSIS && to === NcStatus.ACTION) ||
      (from === NcStatus.ACTION && to === NcStatus.VERIFICATION) ||
      (from === NcStatus.VERIFICATION && (to === NcStatus.CLOSED || to === NcStatus.ACTION));
    if (!ok) throw new ConflictException(`Cannot move from ${from} to ${to}`);

    const isOwner = nc.actionOwnerId === actor.id;
    const data: Prisma.NonconformityUpdateInput = { status: to };
    const problems: string[] = [];

    if (to === NcStatus.ANALYSIS) {
      this.access.requireManagerOrQuality(ctx);
    } else if (to === NcStatus.ACTION && from === NcStatus.ANALYSIS) {
      this.access.requireManagerOrQuality(ctx);
      if (!nc.containment?.trim()) problems.push('必须记录遏制措施');
      if (!nc.rootCause?.trim()) problems.push('必须完成根本原因分析');
      if (!nc.correctiveAction?.trim()) problems.push('必须制定纠正措施');
      if (!nc.actionOwnerId) problems.push('必须指定措施负责人');
      if (!nc.actionDueDate) problems.push('必须设定措施完成期限');
    } else if (to === NcStatus.VERIFICATION) {
      if (!ctx.isManager && !ctx.isQuality && !isOwner) throw new ForbiddenException('Action owner or project management required');
      data.actionCompletedAt = new Date();
    } else if (to === NcStatus.ACTION && from === NcStatus.VERIFICATION) {
      this.access.requireManagerOrQuality(ctx);
      if (!dto.note?.trim()) problems.push('措施无效退回时必须写明原因');
      data.actionCompletedAt = null;
    } else if (to === NcStatus.CLOSED) {
      this.access.requireManagerOrQuality(ctx);
      if (isOwner) throw new ForbiddenException('The action owner cannot verify their own corrective action');
      if (nc.severity !== NcSeverity.MINOR && !ctx.isQuality) {
        throw new ForbiddenException('Major and critical nonconformities must be closed by the quality manager');
      }
      if (!dto.note?.trim()) problems.push('关闭时必须填写有效性验证结论');
      data.effectivenessNote = dto.note;
      data.verifiedById = actor.id;
      data.closedAt = new Date();
    }
    if (problems.length) throw new BadRequestException({ code: 'NC_INCOMPLETE', message: problems.join('；'), problems });

    const updated = await this.audit.tx(
      actor,
      { action: `nonconformity.${to.toLowerCase()}`, entity: 'Nonconformity', entityId: () => id, before: { status: from }, after: (n) => ({ status: n.status }) },
      (tx) => tx.nonconformity.update({ where: { id }, data }),
    );
    if (to === NcStatus.ACTION && from === NcStatus.ANALYSIS) {
      await this.notifications.notify(ctx.tenantId, [nc.actionOwnerId], { kind: 'NC_ACTION', title: `请执行纠正措施 ${nc.code}：${nc.title}`, body: nc.correctiveAction ?? '', link: `/projects/${projectId}` }, actor.id);
    }
    return updated;
  }

  private async findNc(ctx: ProjectCtx, id: string) {
    const nc = await this.prisma.nonconformity.findFirst({ where: { id, projectId: ctx.project.id, tenantId: ctx.tenantId } });
    if (!nc) throw new NotFoundException('Nonconformity not found');
    return nc;
  }

  private async checkRefs(ctx: ProjectCtx, phaseId?: string, wpId?: string) {
    if (phaseId && !(await this.prisma.phase.findFirst({ where: { id: phaseId, projectId: ctx.project.id, tenantId: ctx.tenantId } }))) {
      throw new BadRequestException('Phase not found in this project');
    }
    if (wpId && !(await this.prisma.workPackage.findFirst({ where: { id: wpId, projectId: ctx.project.id, tenantId: ctx.tenantId } }))) {
      throw new BadRequestException('Work package not found in this project');
    }
  }
}
