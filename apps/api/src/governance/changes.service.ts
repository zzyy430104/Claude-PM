import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { ChangeStatus, ChangeType } from '../generated/prisma/enums.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthUser } from '../common/auth.types.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ProjectAccess, ProjectCtx } from '../projects/access.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { PlanVersionsService } from '../projects/plan-versions.service.js';
import { ChangeNoteDto, CreateChangeDto, CustomerContactDto, RequiredNoteDto, UpdateChangeDto } from './dto.js';

type Proposed = { budget?: number; customerDeliveryDate?: string; startDate?: string; endDate?: string };

/** 变更控制（8.1.4.2）：申请 → 原因与影响分析 → CCB 审批 → 实施 → 有效性验证 → 关闭，全程留痕 */
@Injectable()
export class ChangesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: ProjectAccess,
    private readonly notifications: NotificationsService,
    private readonly planVersions: PlanVersionsService,
  ) {}

  async list(actor: AuthUser, projectId: string) {
    const ctx = await this.access.load(actor, projectId);
    return this.prisma.changeRequest.findMany({
      where: { projectId, tenantId: ctx.tenantId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async history(actor: AuthUser, projectId: string, id: string) {
    const ctx = await this.access.load(actor, projectId);
    await this.find(ctx, id);
    return this.prisma.auditLog.findMany({
      where: { tenantId: ctx.tenantId, entity: 'ChangeRequest', entityId: id },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
  }

  async create(actor: AuthUser, projectId: string, dto: CreateChangeDto) {
    const ctx = await this.access.load(actor, projectId);
    this.access.requireOpen(ctx);
    if (!ctx.member && !ctx.isManager) throw new ForbiddenException('Project members only');
    const count = await this.prisma.changeRequest.count({ where: { projectId } });
    const code = `CR-${String(count + 1).padStart(3, '0')}`;
    try {
      return await this.audit.tx(
        actor,
        {
          action: 'changeRequest.create',
          entity: 'ChangeRequest',
          entityId: (c) => c.id,
          after: (c) => ({ code: c.code, type: c.type, title: c.title }),
        },
        (tx) =>
          tx.changeRequest.create({
            data: {
              tenantId: ctx.tenantId,
              projectId,
              code,
              type: dto.type,
              title: dto.title,
              description: dto.description,
              reason: dto.reason,
              triggeredByFailure: dto.triggeredByFailure ?? false,
              causeAnalysis: dto.causeAnalysis,
              impactAnalysis: dto.impactAnalysis,
              verificationPlan: dto.verificationPlan,
              technicalImpact: dto.technicalImpact as unknown as Prisma.InputJsonValue,
              proposed: dto.proposed as unknown as Prisma.InputJsonValue,
              requestedById: actor.id,
            },
          }),
      );
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('Please retry: change request number collision');
      }
      throw e;
    }
  }

  async update(actor: AuthUser, projectId: string, id: string, dto: UpdateChangeDto) {
    const ctx = await this.access.load(actor, projectId);
    this.access.requireOpen(ctx);
    const cr = await this.find(ctx, id);
    if (cr.requestedById !== actor.id && !ctx.isManager) throw new ForbiddenException('Only the requester or project manager can edit');
    if (cr.status !== ChangeStatus.DRAFT) throw new ConflictException('Only drafts can be edited');
    return this.audit.tx(
      actor,
      { action: 'changeRequest.update', entity: 'ChangeRequest', entityId: () => id },
      (tx) =>
        tx.changeRequest.update({
          where: { id },
          data: {
            ...dto,
            technicalImpact: dto.technicalImpact as unknown as Prisma.InputJsonValue | undefined,
            proposed: dto.proposed as unknown as Prisma.InputJsonValue | undefined,
          },
        }),
    );
  }

  async submit(actor: AuthUser, projectId: string, id: string) {
    const ctx = await this.access.load(actor, projectId);
    this.access.requireOpen(ctx);
    const cr = await this.find(ctx, id);
    if (cr.requestedById !== actor.id && !ctx.isManager) throw new ForbiddenException('Only the requester or project manager can submit');
    if (cr.status !== ChangeStatus.DRAFT) throw new ConflictException('Only drafts can be submitted');

    const problems: string[] = [];
    if (!cr.impactAnalysis?.trim()) problems.push('影响分析（含风险与机会）必填');
    if (cr.triggeredByFailure && !cr.causeAnalysis?.trim()) problems.push('由故障引起的变更必须包含原因分析');
    if (cr.type === ChangeType.TECHNICAL && !cr.technicalImpact) problems.push('技术变更必须分析对已交付部件、客户规格与配置、相关文件、技术要求和再验证的影响');
    const p = (cr.proposed ?? {}) as Proposed;
    if (cr.type === ChangeType.BUDGET && p.budget === undefined) problems.push('预算变更必须给出新的预算金额');
    if (cr.type === ChangeType.DELIVERY_DATE && !p.customerDeliveryDate) problems.push('交期变更必须给出新的客户交期');
    if (cr.type === ChangeType.SCHEDULE && !p.startDate && !p.endDate) problems.push('进度变更必须给出新的开始或结束日期');
    if (problems.length) throw new BadRequestException({ code: 'CHANGE_INCOMPLETE', message: problems.join('；'), problems });

    const submitted = await this.transition(actor, cr.id, 'changeRequest.submit', { status: ChangeStatus.SUBMITTED, submittedAt: new Date() });
    const ccb = await this.notifications.projectUsers(ctx.tenantId, projectId, { isCcb: true });
    const tops = await this.notifications.tenantUsersWithRole(ctx.tenantId, 'TOP_MANAGEMENT');
    await this.notifications.notify(ctx.tenantId, [...ccb, ...tops], {
      kind: 'CHANGE_SUBMITTED', title: `待审批变更 ${cr.code}：${cr.title}`, body: `${ctx.project.code} ${ctx.project.name}`, link: `/projects/${projectId}`,
    }, cr.requestedById);
    return submitted;
  }

  /** 记录已向客户发出变更申请 / 客户已同意（涉及客户要求的变更，8.1.4.2 f） */
  async customerContact(actor: AuthUser, projectId: string, id: string, dto: CustomerContactDto) {
    const ctx = await this.access.load(actor, projectId);
    this.access.requireManager(ctx);
    const cr = await this.find(ctx, id);
    if (cr.status !== ChangeStatus.SUBMITTED && cr.status !== ChangeStatus.APPROVED) {
      throw new ConflictException('Customer contact can be recorded on submitted or approved requests');
    }
    const when = dto.date ? new Date(dto.date) : new Date();
    return this.transition(actor, id, 'changeRequest.customerContact', {
      customerNotifiedAt: cr.customerNotifiedAt ?? when,
      ...(dto.agreed ? { customerAgreedAt: when } : {}),
    });
  }

  async approve(actor: AuthUser, projectId: string, id: string, dto: ChangeNoteDto) {
    const ctx = await this.access.load(actor, projectId);
    const cr = await this.find(ctx, id);
    this.requireApprover(ctx, cr.requestedById);
    if (cr.status !== ChangeStatus.SUBMITTED) throw new ConflictException('Only submitted requests can be approved');
    if (cr.type === ChangeType.DELIVERY_DATE && !cr.customerNotifiedAt) {
      throw new ConflictException({ code: 'CUSTOMER_NOT_NOTIFIED', message: 'The customer must be notified before a delivery date change is approved' });
    }
    const p = (cr.proposed ?? {}) as Proposed;
    if (cr.type === ChangeType.BUDGET && p.budget !== undefined) {
      const current = ctx.project.budget ? Number(ctx.project.budget) : 0;
      if (p.budget > current && !ctx.isTopManagement) {
        throw new ForbiddenException({ code: 'TOP_MANAGEMENT_REQUIRED', message: 'Budget increases must be approved by top management' });
      }
    }
    const approved = await this.transition(actor, id, 'changeRequest.approve', {
      status: ChangeStatus.APPROVED, decidedById: actor.id, decidedAt: new Date(), decisionNote: dto.note,
    });
    await this.notifications.notify(ctx.tenantId, [cr.requestedById], { kind: 'CHANGE_DECIDED', title: `变更 ${cr.code} 已批准`, body: dto.note ?? '', link: `/projects/${projectId}` });
    return approved;
  }

  async reject(actor: AuthUser, projectId: string, id: string, dto: RequiredNoteDto) {
    const ctx = await this.access.load(actor, projectId);
    const cr = await this.find(ctx, id);
    this.requireApprover(ctx, cr.requestedById);
    if (cr.status !== ChangeStatus.SUBMITTED) throw new ConflictException('Only submitted requests can be rejected');
    const rejected = await this.transition(actor, id, 'changeRequest.reject', {
      status: ChangeStatus.REJECTED, decidedById: actor.id, decidedAt: new Date(), decisionNote: dto.note,
    });
    await this.notifications.notify(ctx.tenantId, [cr.requestedById], { kind: 'CHANGE_DECIDED', title: `变更 ${cr.code} 被驳回`, body: dto.note, link: `/projects/${projectId}` });
    return rejected;
  }

  /** 实施：只有已批准的变更才能实施（R6），并把拟变更内容写入项目 */
  async implement(actor: AuthUser, projectId: string, id: string) {
    const ctx = await this.access.load(actor, projectId);
    this.access.requireManager(ctx);
    this.access.requireOpen(ctx);
    const cr = await this.find(ctx, id);
    if (cr.status !== ChangeStatus.APPROVED) throw new ConflictException('Only approved requests can be implemented');
    if (cr.type === ChangeType.DELIVERY_DATE && !cr.customerAgreedAt) {
      throw new ConflictException({ code: 'CUSTOMER_AGREEMENT_REQUIRED', message: 'The customer must agree before the delivery date is changed' });
    }
    const p = (cr.proposed ?? {}) as Proposed;
    const result = await this.audit.tx(
      actor,
      { action: 'changeRequest.implement', entity: 'ChangeRequest', entityId: () => id, after: () => ({ applied: p as Prisma.InputJsonValue }) },
      async (tx) => {
        if (cr.type === ChangeType.BUDGET || cr.type === ChangeType.DELIVERY_DATE || cr.type === ChangeType.SCHEDULE) {
          const start = p.startDate ? new Date(p.startDate) : ctx.project.startDate;
          const end = p.endDate ? new Date(p.endDate) : ctx.project.endDate;
          if (end < start) throw new BadRequestException('endDate must not be before startDate');
          await tx.project.update({
            where: { id: projectId },
            data: {
              budget: p.budget,
              customerDeliveryDate: p.customerDeliveryDate ? new Date(p.customerDeliveryDate) : undefined,
              startDate: p.startDate ? start : undefined,
              endDate: p.endDate ? end : undefined,
            },
          });
        }
        return tx.changeRequest.update({
          where: { id },
          data: { status: ChangeStatus.IMPLEMENTED, implementedById: actor.id, implementedAt: new Date() },
        });
      },
    );
    // 范围、进度、预算、交期变更实施后保存新一版计划，供计划与实际对比
    const planChanging: ChangeType[] = [ChangeType.SCOPE, ChangeType.SCHEDULE, ChangeType.BUDGET, ChangeType.DELIVERY_DATE];
    if (ctx.project.baselined && planChanging.includes(cr.type)) {
      await this.planVersions.capture(actor, projectId, `实施变更 ${cr.code} ${cr.title}`, cr.id);
    }
    return result;
  }

  /** 有效性验证：验证人不能是实施人本人 */
  async verify(actor: AuthUser, projectId: string, id: string, dto: RequiredNoteDto) {
    const ctx = await this.access.load(actor, projectId);
    this.access.requireManagerOrQuality(ctx);
    const cr = await this.find(ctx, id);
    if (cr.status !== ChangeStatus.IMPLEMENTED) throw new ConflictException('Only implemented requests can be verified');
    if (cr.implementedById === actor.id) throw new ForbiddenException('The implementer cannot verify their own change');
    return this.transition(actor, id, 'changeRequest.verify', {
      status: ChangeStatus.VERIFIED, verifiedById: actor.id, verifiedAt: new Date(), effectivenessNote: dto.note,
    });
  }

  async close(actor: AuthUser, projectId: string, id: string) {
    const ctx = await this.access.load(actor, projectId);
    this.access.requireManager(ctx);
    const cr = await this.find(ctx, id);
    if (cr.status !== ChangeStatus.VERIFIED) throw new ConflictException('Only verified requests can be closed');
    return this.transition(actor, id, 'changeRequest.close', { status: ChangeStatus.CLOSED, closedAt: new Date() });
  }

  /** 变更委员会成员或最高管理层可审批，申请人不能审批自己的申请 */
  private requireApprover(ctx: ProjectCtx, requestedById: string) {
    if (!ctx.isCcb && !ctx.isTopManagement) throw new ForbiddenException('Change control board member or top management required');
    if (requestedById === ctx.actor.id) throw new ForbiddenException('Requesters cannot approve their own change request');
  }

  private transition(actor: AuthUser, id: string, action: string, data: Prisma.ChangeRequestUpdateInput) {
    return this.audit.tx(
      actor,
      { action, entity: 'ChangeRequest', entityId: () => id, after: (c) => ({ status: c.status }) },
      (tx) => tx.changeRequest.update({ where: { id }, data }),
    );
  }

  private async find(ctx: ProjectCtx, id: string) {
    const cr = await this.prisma.changeRequest.findFirst({ where: { id, projectId: ctx.project.id, tenantId: ctx.tenantId } });
    if (!cr) throw new NotFoundException('Change request not found');
    return cr;
  }
}
