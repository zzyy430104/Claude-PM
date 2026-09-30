import { Injectable } from '@nestjs/common';
import { ChangeStatus, IssueStatus, ProjectRole, ProjectStatus, Role, WpStatus } from '../generated/prisma/enums.js';
import { requireTenantId } from '../common/auth.types.js';
import type { AuthUser } from '../common/auth.types.js';
import { CostService } from '../cost/cost.service.js';
import { MetricsService } from '../governance/metrics.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

export type Health = 'RED' | 'AMBER' | 'GREEN';

const HIGH_RISK_SCORE = 15;
const DAY = 86_400_000;

/** 项目组合仪表盘与个人待办 */
@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly metrics: MetricsService,
    private readonly cost: CostService,
  ) {}

  private visibleProjects(actor: AuthUser) {
    const tenantId = requireTenantId(actor);
    const seesAll = actor.role === Role.TENANT_ADMIN || actor.role === Role.TOP_MANAGEMENT;
    return this.prisma.project.findMany({
      where: {
        tenantId,
        status: { in: [ProjectStatus.PLANNING, ProjectStatus.ACTIVE] },
        ...(seesAll ? {} : { members: { some: { userId: actor.id, active: true } } }),
      },
      orderBy: { code: 'asc' },
    });
  }

  /**
   * 健康度规则（红 > 黄 > 绿）：
   * 红：预计完工晚于计划、预计成本超预算、存在未关闭的严重不符合项
   * 黄：进度落后超过 5 个百分点、逾期行动项、高分风险、项目评审逾期、成本科目预计超支、存在未关闭的重大不符合项
   */
  async portfolio(actor: AuthUser) {
    const tenantId = requireTenantId(actor);
    const projects = await this.visibleProjects(actor);
    const today = new Date();
    const todayIso = today.toISOString().slice(0, 10);

    const rows = [];
    for (const p of projects) {
      const [progress, issues, risks, ncs, lastReview, pendingChanges, activePhase, cost] = await Promise.all([
        this.metrics.progress({ project: p, tenantId }, today),
        this.prisma.issue.findMany({ where: { projectId: p.id, tenantId, status: IssueStatus.OPEN }, select: { dueDate: true } }),
        this.prisma.risk.findMany({ where: { projectId: p.id, tenantId, status: { not: 'CLOSED' }, kind: 'RISK' }, select: { probability: true, impact: true } }),
        this.prisma.nonconformity.findMany({ where: { projectId: p.id, tenantId, status: { not: 'CLOSED' } }, select: { severity: true } }),
        this.prisma.projectReview.findFirst({ where: { projectId: p.id, tenantId }, orderBy: { reviewDate: 'desc' }, select: { reviewDate: true } }),
        this.prisma.changeRequest.count({ where: { projectId: p.id, tenantId, status: ChangeStatus.SUBMITTED } }),
        this.prisma.phase.findFirst({ where: { projectId: p.id, tenantId, status: 'ACTIVE' }, select: { name: true } }),
        p.budget ? this.cost.summary(actor, p.id) : Promise.resolve(null),
      ]);

      const overdueActions = issues.filter((i) => i.dueDate && i.dueDate.toISOString().slice(0, 10) < todayIso).length;
      const highRisks = risks.filter((r) => r.probability * r.impact >= HIGH_RISK_SCORE).length;
      const critical = ncs.filter((n) => n.severity === 'CRITICAL').length;
      const major = ncs.filter((n) => n.severity === 'MAJOR').length;
      const reference = lastReview ? lastReview.reviewDate : p.startDate;
      const reviewOverdue = p.status === ProjectStatus.ACTIVE && today.getTime() - reference.getTime() > p.reviewIntervalDays * DAY;
      const costOverrun = !!cost && cost.accounts.length > 0 && cost.overrun;
      const accountOverruns = cost ? cost.accounts.filter((a) => a.overrun).length : 0;

      const red: string[] = [];
      const amber: string[] = [];
      if (progress.exceedsPlannedEnd) red.push(`预计完工 ${progress.projectedEnd} 晚于计划 ${progress.plannedEnd}`);
      if (costOverrun) red.push('预计成本超出预算');
      if (critical) red.push(`${critical} 个严重不符合项未关闭`);
      if (progress.plannedPercent - progress.actualPercent > 5) amber.push(`进度落后 ${progress.plannedPercent - progress.actualPercent} 个百分点`);
      if (overdueActions) amber.push(`${overdueActions} 个行动项逾期`);
      if (highRisks) amber.push(`${highRisks} 个高分风险`);
      if (reviewOverdue) amber.push('项目评审逾期');
      if (accountOverruns) amber.push(`${accountOverruns} 个成本科目预计超支`);
      if (major) amber.push(`${major} 个重大不符合项未关闭`);

      rows.push({
        id: p.id, code: p.code, name: p.name, status: p.status, riskLevel: p.riskLevel, activePhase: activePhase?.name ?? null,
        health: (red.length ? 'RED' : amber.length ? 'AMBER' : 'GREEN') as Health,
        reasons: [...red, ...amber],
        progress: { planned: progress.plannedPercent, actual: progress.actualPercent, projectedEnd: progress.projectedEnd, plannedEnd: progress.plannedEnd },
        openIssues: issues.length, overdueActions, highRisks, openNonconformities: ncs.length, pendingChanges,
        cost: cost && cost.accounts.length ? { budget: cost.projectBudget, eac: cost.eac, overrun: cost.overrun } : null,
        lastReviewDate: lastReview?.reviewDate.toISOString().slice(0, 10) ?? null, reviewOverdue,
      });
    }
    return {
      totals: { projects: rows.length, red: rows.filter((r) => r.health === 'RED').length, amber: rows.filter((r) => r.health === 'AMBER').length, green: rows.filter((r) => r.health === 'GREEN').length },
      projects: rows,
    };
  }

  /** 需要我处理的事项 */
  async todos(actor: AuthUser) {
    const tenantId = requireTenantId(actor);
    const projects = await this.visibleProjects(actor);
    const pid = new Map(projects.map((p) => [p.id, p.code]));
    const ids = [...pid.keys()];
    const [members, issues, ncs, trainings, wps, gates, submitted] = await Promise.all([
      this.prisma.projectMember.findMany({ where: { tenantId, userId: actor.id, active: true, projectId: { in: ids } } }),
      this.prisma.issue.findMany({ where: { tenantId, ownerId: actor.id, status: IssueStatus.OPEN, projectId: { in: ids } } }),
      this.prisma.nonconformity.findMany({ where: { tenantId, actionOwnerId: actor.id, status: 'ACTION', projectId: { in: ids } } }),
      this.prisma.training.findMany({ where: { tenantId, userId: actor.id, status: 'PLANNED', projectId: { in: ids } } }),
      this.prisma.workPackage.findMany({ where: { tenantId, ownerId: actor.id, status: { in: [WpStatus.NOT_STARTED, WpStatus.IN_PROGRESS] }, projectId: { in: ids } } }),
      this.prisma.gateReview.findMany({ where: { tenantId, status: 'OPEN', projectId: { in: ids } } }),
      this.prisma.changeRequest.findMany({ where: { tenantId, status: ChangeStatus.SUBMITTED, requestedById: { not: actor.id }, projectId: { in: ids } } }),
    ]);
    const memberOf = new Map(members.map((m) => [m.projectId, m]));
    const link = (projectId: string) => `/projects/${projectId}`;
    const todos: { kind: string; title: string; projectId: string; projectCode: string; link: string; dueDate?: string | null }[] = [];
    const add = (kind: string, title: string, projectId: string, dueDate?: Date | null) =>
      todos.push({ kind, title, projectId, projectCode: pid.get(projectId) ?? '', link: link(projectId), dueDate: dueDate ? dueDate.toISOString().slice(0, 10) : null });

    for (const c of submitted) {
      const m = memberOf.get(c.projectId);
      if (m?.isCcb || actor.role === Role.TOP_MANAGEMENT) add('CHANGE_APPROVAL', `待审批变更 ${c.code}：${c.title}`, c.projectId);
    }
    for (const g of gates) {
      const m = memberOf.get(g.projectId);
      if (m?.projectRole === ProjectRole.PROJECT_MANAGER) add('GATE_REVIEW', '有一个进行中的关口评审待记录结论', g.projectId);
    }
    for (const i of issues) add('ISSUE', `${i.kind === 'ISSUE' ? '问题' : '行动项'}：${i.title}`, i.projectId, i.dueDate);
    for (const n of ncs) add('NONCONFORMITY', `执行纠正措施 ${n.code}：${n.title}`, n.projectId, n.actionDueDate);
    for (const w of wps) add('WORK_PACKAGE', `工作包 ${w.code} ${w.name}（${w.percentComplete}%）`, w.projectId);
    for (const t of trainings) add('TRAINING', `培训：${t.title}`, t.projectId, t.dueDate);
    return todos.sort((a, b) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999'));
  }
}
