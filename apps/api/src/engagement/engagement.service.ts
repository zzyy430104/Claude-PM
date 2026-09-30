import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ChangeStatus, IssueStatus } from '../generated/prisma/enums.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthUser } from '../common/auth.types.js';
import { PerformanceService } from '../governance/performance.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ProjectAccess, ProjectCtx } from '../projects/access.service.js';
import { WbsService } from '../projects/wbs.service.js';
import { CreateDeviationDto, CreateSwotDto, StakeholderDto } from './engagement.dto.js';

const DAY = 86_400_000;

/** SWOT 评审（8.1.3.1.2 b）、偏离通报（8.1.3.8、8.1.3.11）、干系人登记册、项目周报 */
@Injectable()
export class EngagementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: ProjectAccess,
    private readonly performance: PerformanceService,
    private readonly wbs: WbsService,
  ) {}

  private where(ctx: ProjectCtx) {
    return { projectId: ctx.project.id, tenantId: ctx.tenantId };
  }

  async listSwot(actor: AuthUser, projectId: string) {
    const ctx = await this.access.load(actor, projectId);
    return this.prisma.swotReview.findMany({ where: this.where(ctx), orderBy: { reviewDate: 'desc' } });
  }
  async createSwot(actor: AuthUser, projectId: string, dto: CreateSwotDto) {
    const ctx = await this.access.load(actor, projectId);
    this.access.requireManagerOrQuality(ctx);
    this.access.requireOpen(ctx);
    return this.audit.tx(actor, { action: 'swot.create', entity: 'SwotReview', entityId: (r) => r.id }, (tx) =>
      tx.swotReview.create({ data: { ...dto, reviewDate: new Date(dto.reviewDate), ...this.where(ctx), createdById: actor.id } }));
  }

  async listDeviations(actor: AuthUser, projectId: string) {
    const ctx = await this.access.load(actor, projectId);
    return this.prisma.deviationNotice.findMany({ where: this.where(ctx), orderBy: { noticeDate: 'desc' } });
  }
  async createDeviation(actor: AuthUser, projectId: string, dto: CreateDeviationDto) {
    const ctx = await this.access.load(actor, projectId);
    this.access.requireManager(ctx);
    this.access.requireOpen(ctx);
    return this.audit.tx(
      actor,
      { action: 'deviation.notify', entity: 'DeviationNotice', entityId: (r) => r.id, after: () => ({ dimension: dto.dimension, audience: dto.audience }) },
      (tx) => tx.deviationNotice.create({ data: { ...dto, noticeDate: new Date(dto.noticeDate), ...this.where(ctx), createdById: actor.id } }),
    );
  }

  async listStakeholders(actor: AuthUser, projectId: string) {
    const ctx = await this.access.load(actor, projectId);
    return this.prisma.stakeholder.findMany({ where: this.where(ctx), orderBy: { createdAt: 'asc' } });
  }
  async createStakeholder(actor: AuthUser, projectId: string, dto: StakeholderDto) {
    const ctx = await this.access.load(actor, projectId);
    this.requireEditor(ctx);
    return this.audit.tx(actor, { action: 'stakeholder.create', entity: 'Stakeholder', entityId: (r) => r.id }, (tx) =>
      tx.stakeholder.create({ data: { ...dto, ...this.where(ctx) } }));
  }
  async updateStakeholder(actor: AuthUser, projectId: string, id: string, dto: Partial<StakeholderDto>) {
    const ctx = await this.access.load(actor, projectId);
    this.requireEditor(ctx);
    await this.findStakeholder(ctx, id);
    return this.audit.tx(actor, { action: 'stakeholder.update', entity: 'Stakeholder', entityId: () => id }, (tx) =>
      tx.stakeholder.update({ where: { id }, data: dto }));
  }
  async deleteStakeholder(actor: AuthUser, projectId: string, id: string) {
    const ctx = await this.access.load(actor, projectId);
    this.requireEditor(ctx);
    await this.findStakeholder(ctx, id);
    await this.audit.tx(actor, { action: 'stakeholder.delete', entity: 'Stakeholder', entityId: () => id }, (tx) =>
      tx.stakeholder.delete({ where: { id } }));
  }

  /** 项目周报：本周期的质量 / 进度 / 成本状态、完成与即将开始的工作包、新增与关闭的问题、变更、风险 */
  async weeklyReport(actor: AuthUser, projectId: string, days = 7) {
    const ctx = await this.access.load(actor, projectId);
    const w = this.where(ctx);
    const now = new Date();
    const since = new Date(now.getTime() - days * DAY);
    const nextUntil = new Date(now.getTime() + 14 * DAY).toISOString().slice(0, 10);
    const [perf, done, issuesNew, issuesClosed, openIssues, changes, risks, deviations] = await Promise.all([
      this.performance.compute(ctx, now),
      this.prisma.workPackage.findMany({ where: { ...w, status: { in: ['DONE', 'VERIFIED'] }, updatedAt: { gte: since } }, select: { code: true, name: true, status: true } }),
      this.prisma.issue.findMany({ where: { ...w, createdAt: { gte: since } }, select: { kind: true, title: true, dueDate: true } }),
      this.prisma.issue.findMany({ where: { ...w, status: IssueStatus.CLOSED, closedAt: { gte: since } }, select: { kind: true, title: true } }),
      this.prisma.issue.count({ where: { ...w, status: IssueStatus.OPEN } }),
      this.prisma.changeRequest.findMany({
        where: { ...w, OR: [{ createdAt: { gte: since } }, { decidedAt: { gte: since } }, { implementedAt: { gte: since } }, { verifiedAt: { gte: since } }] },
        select: { code: true, title: true, status: true },
      }),
      this.prisma.risk.findMany({ where: { ...w, status: { not: 'CLOSED' } }, select: { kind: true, title: true, probability: true, impact: true } }),
      this.prisma.deviationNotice.findMany({ where: { ...w, noticeDate: { gte: since } }, select: { dimension: true, audience: true, impact: true, countermeasures: true, noticeDate: true } }),
    ]);
    const { items } = await this.wbs.get(actor, projectId);
    const upcoming = items
      .filter((i) => i.isLeaf && i.status === 'NOT_STARTED' && i.scheduledStart <= nextUntil)
      .map((i) => ({ code: i.code, name: i.name, start: i.scheduledStart }));
    return {
      project: { code: ctx.project.code, name: ctx.project.name },
      period: { from: since.toISOString().slice(0, 10), to: now.toISOString().slice(0, 10) },
      performance: { triangle: perf.triangle, evm: perf.evm, schedule: { projectedEnd: perf.schedule.projectedEnd, customerDate: perf.schedule.customerDate, slipDays: perf.schedule.slipDays } },
      completed: done, upcoming, issuesNew, issuesClosed, openIssues,
      changes: changes.map((c) => ({ ...c, status: c.status as ChangeStatus })),
      topRisks: risks.map((r) => ({ ...r, score: r.probability * r.impact })).sort((a, b) => b.score - a.score).slice(0, 5),
      deviations,
    };
  }

  private requireEditor(ctx: ProjectCtx) {
    if (!ctx.isManager && !ctx.isQuality) throw new ForbiddenException('Project manager or quality manager required');
    this.access.requireOpen(ctx);
  }
  private async findStakeholder(ctx: ProjectCtx, id: string) {
    const s = await this.prisma.stakeholder.findFirst({ where: { id, ...this.where(ctx) } });
    if (!s) throw new NotFoundException('Stakeholder not found');
    return s;
  }
}
