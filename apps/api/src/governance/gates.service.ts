import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { GateDecision, GateStatus, IssueStatus, PhaseStatus, ProjectRole, WpStatus } from '../generated/prisma/enums.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthUser } from '../common/auth.types.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { faiSummary, purchaseChecks } from '../delivery/checks.js';
import { ProjectAccess, ProjectCtx } from '../projects/access.service.js';
import { AuthorizeOverrideDto, GateDecisionDto, UpdateGateDto } from './dto.js';
import { IssuesService } from './issues.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';

/** 阶段检查清单里由系统自动判断的项（文字须与模板一致） */
async function autoGateChecks(prisma: PrismaService, tenantId: string, projectId: string): Promise<Record<string, { ok: boolean; message: string }>> {
  const [pc, fai] = await Promise.all([purchaseChecks(prisma, tenantId, projectId), faiSummary(prisma, projectId)]);
  return {
    采购计划已批准: pc.approved,
    长周期物料已下单: pc.longLead,
    'FAI 报告已出具': { ok: fai.records.some((r) => r.result !== 'FAIL'), message: fai.text },
  };
}

@Injectable()
export class GatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: ProjectAccess,
    private readonly issues: IssuesService,
    private readonly notifications: NotificationsService,
  ) {}

  async list(actor: AuthUser, projectId: string) {
    const ctx = await this.access.load(actor, projectId);
    return this.prisma.gateReview.findMany({
      where: { projectId, tenantId: ctx.tenantId },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** 阶段关口就绪情况：清单、未核验工作包、未被接受的交付物、此前未关闭的评审问题 */
  async readiness(actor: AuthUser, projectId: string, phaseId: string) {
    const ctx = await this.access.load(actor, projectId);
    const phase = await this.findPhase(ctx, phaseId);
    const [ready, all, deliverables] = await Promise.all([
      this.computeReadiness(ctx, phase),
      this.prisma.workPackage.findMany({ where: { projectId, tenantId: ctx.tenantId }, orderBy: { code: 'asc' } }),
      this.prisma.deliverable.findMany({ where: { projectId, tenantId: ctx.tenantId, phaseId }, orderBy: { name: 'asc' } }),
    ]);
    return { ...ready, ...this.wbsSummary(all, phaseId, ctx.project.gateReviewWbsLevel), deliverables: deliverables.map((d) => ({ id: d.id, name: d.name, kind: d.kind, status: d.status })) };
  }

  /**
   * 阶段评审从项目设定的 WBS 层级开始（8.1.3.1.3 c）：列出该层级上与本阶段相关的工作包，
   * 并汇总其下属本阶段末级工作包的完成与验证情况。层级比实际 WBS 更深时，取到末级为止。
   */
  private wbsSummary(all: { id: string; parentId: string | null; code: string; name: string; phaseId: string | null; status: string }[], phaseId: string, level: number) {
    const byId = new Map(all.map((w) => [w.id, w]));
    const kids = new Set(all.map((w) => w.parentId).filter(Boolean));
    const depth = (w: { parentId: string | null }): number => (w.parentId && byId.get(w.parentId) ? depth(byId.get(w.parentId)!) + 1 : 1);
    const ancestorAt = (w: (typeof all)[number]) => {
      let cur = w;
      while (depth(cur) > level && cur.parentId && byId.get(cur.parentId)) cur = byId.get(cur.parentId)!;
      return cur;
    };
    const groups = new Map<string, { id: string; code: string; name: string; leaves: number; done: number; verified: number }>();
    for (const leaf of all.filter((w) => !kids.has(w.id) && w.phaseId === phaseId)) {
      const a = ancestorAt(leaf);
      const g = groups.get(a.id) ?? { id: a.id, code: a.code, name: a.name, leaves: 0, done: 0, verified: 0 };
      g.leaves += 1;
      if (leaf.status === 'DONE' || leaf.status === 'VERIFIED') g.done += 1;
      if (leaf.status === 'VERIFIED') g.verified += 1;
      groups.set(a.id, g);
    }
    const wbsGroups = [...groups.values()].sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));
    return { wbsLevel: level, wbsGroups };
  }

  async create(actor: AuthUser, projectId: string, phaseId: string) {
    const ctx = await this.access.load(actor, projectId);
    this.access.requireManager(ctx);
    this.access.requireOpen(ctx);
    const phase = await this.findPhase(ctx, phaseId);
    if (phase.status !== PhaseStatus.ACTIVE) throw new ConflictException('Only the active phase can be reviewed');
    const open = await this.prisma.gateReview.count({ where: { phaseId, status: GateStatus.OPEN } });
    if (open > 0) throw new ConflictException('An open review already exists for this phase');
    const items = (phase.checklist as string[]) ?? [];
    return this.audit.tx(
      actor,
      { action: 'gateReview.create', entity: 'GateReview', entityId: (g) => g.id, after: () => ({ phase: phase.name }) },
      (tx) =>
        tx.gateReview.create({
          data: {
            tenantId: ctx.tenantId,
            projectId,
            phaseId,
            checklistResults: items.map((item) => ({ item, passed: false })),
            createdById: actor.id,
          },
        }),
    );
  }

  async update(actor: AuthUser, projectId: string, id: string, dto: UpdateGateDto) {
    const ctx = await this.access.load(actor, projectId);
    this.access.requireOpen(ctx);
    this.access.requireManagerOrQuality(ctx);
    const review = await this.findReview(ctx, id);
    if (review.status !== GateStatus.OPEN) throw new ConflictException('Review is already decided');
    if (dto.attendees) await this.requireMembers(ctx, dto.attendees);
    return this.audit.tx(
      actor,
      { action: 'gateReview.update', entity: 'GateReview', entityId: () => id, after: () => ({ attendees: dto.attendees?.length }) },
      (tx) =>
        tx.gateReview.update({
          where: { id },
          data: {
            checklistResults: dto.checklistResults as unknown as Prisma.InputJsonValue | undefined,
            attendees: dto.attendees as unknown as Prisma.InputJsonValue | undefined,
            notes: dto.notes,
          },
        }),
    );
  }

  /** 最高管理层授权：带着此前未关闭的问题也可以通过本次评审 */
  async authorizeOverride(actor: AuthUser, projectId: string, id: string, dto: AuthorizeOverrideDto) {
    const ctx = await this.access.load(actor, projectId);
    if (!ctx.isTopManagement) throw new ForbiddenException('Top management authorization required');
    const review = await this.findReview(ctx, id);
    if (review.status !== GateStatus.OPEN) throw new ConflictException('Review is already decided');
    return this.audit.tx(
      actor,
      { action: 'gateReview.authorizeOverride', entity: 'GateReview', entityId: () => id, after: () => ({ reason: dto.reason }) },
      (tx) =>
        tx.gateReview.update({
          where: { id },
          data: { overrideAuthorizedById: actor.id, overrideReason: dto.reason },
        }),
    );
  }

  async decide(actor: AuthUser, projectId: string, id: string, dto: GateDecisionDto) {
    const ctx = await this.access.load(actor, projectId);
    this.access.requireManager(ctx);
    this.access.requireOpen(ctx);
    const review = await this.findReview(ctx, id);
    if (review.status !== GateStatus.OPEN) throw new ConflictException('Review is already decided');
    const phase = await this.findPhase(ctx, review.phaseId);
    if (phase.status !== PhaseStatus.ACTIVE) throw new ConflictException('Phase is not active');

    // R2：必选参与者必须到场
    const attendeeIds = (review.attendees as string[]) ?? [];
    const attending = await this.prisma.projectMember.findMany({
      where: { projectId, tenantId: ctx.tenantId, active: true, userId: { in: attendeeIds } },
    });
    const present = new Set(attending.map((m) => m.projectRole as string));
    const missing = ((phase.mandatoryRoles as string[]) ?? []).filter((r) => !present.has(r));
    if (missing.length) {
      throw new ConflictException({ code: 'MANDATORY_PARTICIPANTS_MISSING', message: 'Mandatory participants are missing', missing });
    }

    const ready = await this.computeReadiness(ctx, phase, review.checklistResults as unknown as { item: string; passed: boolean }[]);
    const advancing = dto.decision !== GateDecision.REJECTED;
    if (dto.decision === GateDecision.APPROVED) {
      const blockers = {
        checklist: ready.checklistFailed,
        workPackages: ready.pendingWorkPackages.map((w) => w.code),
        deliverables: ready.pendingDeliverables.map((d) => d.name),
        nonconformities: ready.openNonconformities.map((n) => n.code),
      };
      if (blockers.checklist.length || blockers.workPackages.length || blockers.deliverables.length || blockers.nonconformities.length) {
        throw new ConflictException({ code: 'GATE_CRITERIA_NOT_MET', message: 'Gate criteria not met: use conditional acceptance with an action plan', blockers });
      }
    }
    if (dto.decision === GateDecision.CONDITIONAL && !(dto.actions && dto.actions.length)) {
      throw new BadRequestException('Conditional acceptance requires an action plan');
    }
    // R1：此前评审遗留的问题未关闭，只有最高管理层授权后才能通过
    if (advancing && ready.priorOpenIssues.length && !review.overrideAuthorizedById) {
      throw new ConflictException({
        code: 'OPEN_ISSUES',
        message: 'Open issues from prior phase reviews must be closed, or top management must authorize',
        issues: ready.priorOpenIssues.map((i) => ({ id: i.id, title: i.title })),
      });
    }
    for (const a of dto.actions ?? []) await this.issues.checkOwner(ctx.tenantId, projectId, a.ownerId);

    const decided = await this.audit.tx(
      actor,
      {
        action: 'gateReview.decide',
        entity: 'GateReview',
        entityId: () => id,
        after: () => ({ decision: dto.decision, phase: phase.name, override: !!review.overrideAuthorizedById }),
      },
      async (tx) => {
        const updated = await tx.gateReview.update({
          where: { id },
          data: {
            status: GateStatus.DECIDED,
            decision: dto.decision,
            decisionNote: dto.note,
            decidedById: actor.id,
            decidedAt: new Date(),
            escalated: dto.decision === GateDecision.REJECTED,
          },
        });
        for (const a of dto.actions ?? []) {
          await this.issues.insert(tx, ctx.tenantId, projectId, actor.id, {
            kind: 'ACTION', title: a.title, ownerId: a.ownerId, dueDate: a.dueDate,
            source: 'GATE', gateReviewId: id, phaseId: phase.id,
          });
        }
        if (dto.decision === GateDecision.REJECTED) {
          // 评审被拒：登记升级事项，由项目经理跟进（8.1.3.1.2 a）
          const pm = await tx.projectMember.findFirst({ where: { projectId, projectRole: ProjectRole.PROJECT_MANAGER, active: true } });
          await this.issues.insert(tx, ctx.tenantId, projectId, actor.id, {
            kind: 'ISSUE', title: `阶段评审被拒，需升级处理：${phase.name}`, description: dto.note,
            ownerId: pm?.userId, source: 'GATE', gateReviewId: id, phaseId: phase.id,
          });
        }
        if (advancing) {
          await tx.phase.update({ where: { id: phase.id }, data: { status: PhaseStatus.CLOSED, closedAt: new Date() } });
          const next = await tx.phase.findFirst({ where: { projectId, order: phase.order + 1 } });
          if (next) await tx.phase.update({ where: { id: next.id }, data: { status: PhaseStatus.ACTIVE, startedAt: new Date() } });
        }
        return updated;
      },
    );
    const members = await this.notifications.projectUsers(ctx.tenantId, projectId);
    await this.notifications.notify(ctx.tenantId, members, {
      kind: 'GATE_DECIDED', title: `阶段评审结论：${phase.name} — ${dto.decision}`, body: dto.note, link: `/projects/${projectId}?g=exec&s=phases`,
    }, actor.id);
    for (const a of dto.actions ?? []) {
      await this.notifications.notify(ctx.tenantId, [a.ownerId], { kind: 'ACTION_ASSIGNED', title: `新行动项：${a.title}`, body: `${ctx.project.code} 关口评审`, link: `/projects/${projectId}?g=exec&s=phases` }, actor.id);
    }
    return decided;
  }

  private async computeReadiness(
    ctx: ProjectCtx,
    phase: { id: string; order: number; checklist: unknown },
    results?: { item: string; passed: boolean }[],
  ) {
    const projectId = ctx.project.id;
    const [wps, deliverables, earlier] = await Promise.all([
      this.prisma.workPackage.findMany({ where: { projectId, tenantId: ctx.tenantId, phaseId: phase.id } }),
      this.prisma.deliverable.findMany({ where: { projectId, tenantId: ctx.tenantId, phaseId: phase.id } }),
      this.prisma.phase.findMany({ where: { projectId, tenantId: ctx.tenantId, order: { lt: phase.order } }, select: { id: true } }),
    ]);
    const parents = new Set(
      (await this.prisma.workPackage.findMany({ where: { projectId, parentId: { not: null } }, select: { parentId: true } })).map((w) => w.parentId),
    );
    const openNonconformities = await this.prisma.nonconformity.findMany({
      where: { projectId, tenantId: ctx.tenantId, status: { not: 'CLOSED' }, severity: { in: ['MAJOR', 'CRITICAL'] } },
      select: { id: true, code: true, title: true, severity: true },
    });
    const priorOpenIssues = await this.prisma.issue.findMany({
      where: { projectId, tenantId: ctx.tenantId, status: IssueStatus.OPEN, source: 'GATE', phaseId: { in: earlier.map((p) => p.id) } },
    });
    const raw = results ?? ((phase.checklist as string[]) ?? []).map((item) => ({ item, passed: false }));
    // 部分检查项由系统按采购计划、FAI 记录自动判断
    const auto = await autoGateChecks(this.prisma, ctx.tenantId, projectId);
    const items = raw.map((c) => (auto[c.item] ? { item: c.item, passed: auto[c.item].ok, auto: true, detail: auto[c.item].message } : c));
    return {
      checklist: items,
      checklistFailed: items.filter((c) => !c.passed).map((c) => c.item),
      pendingWorkPackages: wps.filter((w) => !parents.has(w.id) && w.status !== WpStatus.VERIFIED).map((w) => ({ id: w.id, code: w.code, name: w.name, status: w.status })),
      pendingDeliverables: deliverables.filter((d) => d.status !== 'ACCEPTED').map((d) => ({ id: d.id, name: d.name, status: d.status })),
      priorOpenIssues,
      openNonconformities,
    };
  }

  private async findPhase(ctx: ProjectCtx, phaseId: string) {
    const phase = await this.prisma.phase.findFirst({ where: { id: phaseId, projectId: ctx.project.id, tenantId: ctx.tenantId } });
    if (!phase) throw new NotFoundException('Phase not found');
    return phase;
  }

  private async findReview(ctx: ProjectCtx, id: string) {
    const r = await this.prisma.gateReview.findFirst({ where: { id, projectId: ctx.project.id, tenantId: ctx.tenantId } });
    if (!r) throw new NotFoundException('Gate review not found');
    return r;
  }

  private async requireMembers(ctx: ProjectCtx, userIds: string[]) {
    const n = await this.prisma.projectMember.count({
      where: { projectId: ctx.project.id, tenantId: ctx.tenantId, active: true, userId: { in: userIds } },
    });
    if (n !== new Set(userIds).size) throw new BadRequestException('Attendees must be active project members');
  }
}
