import { Injectable } from '@nestjs/common';
import type { PlanVersion, Project, WorkPackage, WpDependency } from '../generated/prisma/client.js';
import { WpStatus } from '../generated/prisma/enums.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { PlanSnapshot } from '../projects/plan-versions.service.js';
import { computeSchedule } from '../projects/schedule.js';
import { CalendarService } from '../projects/calendar.service.js';

const iso = (d: Date) => d.toISOString().slice(0, 10);
const round2 = (n: number) => Math.round(n * 100) / 100;
const ratio = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) / 100 : null);

export type Health = 'RED' | 'AMBER' | 'GREEN';

type Num = { toString(): string } | number;
/** 计算项目绩效所需的数据（单个项目现查，或由 preload 批量查好） */
export interface PerfInput {
  tenant: { evmAmber: Num; evmRed: Num } | null;
  version: PlanVersion | null;
  wps: WorkPackage[];
  deps: WpDependency[];
  costSum: number;
  accounts: { budget: Num; estimateToComplete: Num | null; actual: number }[];
  deliverables: { id: string; name: string; status: string; dueDate: Date | null }[];
  requirements: { status: string; deliverableId: string | null }[];
  ncs: { severity: string }[];
}
export interface Dimension { health: Health; reasons: string[] }

/**
 * 项目绩效（改进方案第二步“对比”）：以最近一版计划批准快照为基准，
 * 计算挣值（PV、EV、AC、SPI、CPI、EAC）、进度偏差，并给出质量、进度、成本三方面的红黄绿（8.1.3.5 c、8.1.3.11 a、b）。
 *
 * 规则：
 * - 每个末级工作包的预算（BAC）取快照里的预算；快照里所有末级工作包都没有预算时，按工期把项目预算分摊下去。
 * - PV：按快照里的计划起止日期线性累计到今天；EV：BAC × 当前完成百分比；AC：已记录的全部实际成本。
 * - EAC = 项目预算 ÷ CPI（CPI 可算时），否则取成本科目的完工估算之和。
 */
@Injectable()
export class PerformanceService {
  constructor(private readonly prisma: PrismaService, private readonly calendars: CalendarService) {}

  private async load(projectId: string, tenantId: string): Promise<PerfInput> {
    const where = { projectId, tenantId };
    const [tenant, version, wps, deps, costSum, accounts, deliverables, requirements, ncs] = await Promise.all([
      this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { evmAmber: true, evmRed: true } }),
      this.prisma.planVersion.findFirst({ where, orderBy: { version: 'desc' } }),
      this.prisma.workPackage.findMany({ where }),
      this.prisma.wpDependency.findMany({ where }),
      this.prisma.costEntry.aggregate({ where, _sum: { amount: true } }),
      this.prisma.costAccount.findMany({ where, include: { entries: { select: { amount: true } } } }),
      this.prisma.deliverable.findMany({ where, select: { id: true, name: true, status: true, dueDate: true } }),
      this.prisma.requirement.findMany({ where, select: { status: true, deliverableId: true } }),
      this.prisma.nonconformity.findMany({ where: { ...where, status: { not: 'CLOSED' } }, select: { severity: true } }),
    ]);
    return { tenant, version, wps, deps, costSum: Number(costSum._sum.amount ?? 0), accounts: accounts.map((a) => ({ budget: a.budget, estimateToComplete: a.estimateToComplete, actual: a.entries.reduce((m, e) => m + Number(e.amount), 0) })), deliverables, requirements, ncs };
  }

  /** 一次查出多个项目的计算数据（每类数据一条查询），按项目返回 */
  async preload(projectIds: string[], tenantId: string): Promise<Map<string, PerfInput>> {
    const where = { projectId: { in: projectIds }, tenantId };
    const latest = await this.prisma.planVersion.groupBy({ by: ['projectId'], where, _max: { version: true } });
    const [tenant, versions, wps, deps, costSums, accounts, accountSums, deliverables, requirements, ncs] = await Promise.all([
      this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { evmAmber: true, evmRed: true } }),
      latest.length ? this.prisma.planVersion.findMany({ where: { tenantId, OR: latest.map((l) => ({ projectId: l.projectId, version: l._max.version! })) } }) : Promise.resolve([]),
      this.prisma.workPackage.findMany({ where }),
      this.prisma.wpDependency.findMany({ where }),
      this.prisma.costEntry.groupBy({ by: ['projectId'], where, _sum: { amount: true } }),
      this.prisma.costAccount.findMany({ where, select: { id: true, projectId: true, budget: true, estimateToComplete: true } }),
      this.prisma.costEntry.groupBy({ by: ['accountId'], where, _sum: { amount: true } }),
      this.prisma.deliverable.findMany({ where, select: { id: true, name: true, status: true, dueDate: true, projectId: true } }),
      this.prisma.requirement.findMany({ where, select: { status: true, deliverableId: true, projectId: true } }),
      this.prisma.nonconformity.findMany({ where: { ...where, status: { not: 'CLOSED' } }, select: { severity: true, projectId: true } }),
    ]);
    const by = <T extends { projectId: string }>(rows: T[], id: string) => rows.filter((r) => r.projectId === id);
    const actualBy = new Map(accountSums.map((s) => [s.accountId, Number(s._sum.amount ?? 0)]));
    return new Map(projectIds.map((id) => [id, {
      tenant,
      version: versions.find((v) => v.projectId === id) ?? null,
      wps: by(wps, id), deps: by(deps, id),
      costSum: Number(costSums.find((c) => c.projectId === id)?._sum.amount ?? 0),
      accounts: by(accounts, id).map((a) => ({ budget: a.budget, estimateToComplete: a.estimateToComplete, actual: actualBy.get(a.id) ?? 0 })),
      deliverables: by(deliverables, id), requirements: by(requirements, id), ncs: by(ncs, id),
    }]));
  }

  /** 一次查好多个项目的数据（工作台用），见 preload() */
  async compute(ctx: { project: Project; tenantId: string }, today = new Date(), pre?: PerfInput) {
    const { project, tenantId } = ctx;
    const { tenant, version, wps, deps, costSum, accounts, deliverables, requirements, ncs } = pre ?? await this.load(project.id, tenantId);
    const amberAt = Number(tenant?.evmAmber ?? 0.95);
    const redAt = Number(tenant?.evmRed ?? 0.9);
    const todayIso = iso(today);

    // 当前排程
    const parents = new Set(wps.map((w) => w.parentId).filter(Boolean));
    const leaves = wps.filter((w) => !parents.has(w.id));
    const sched = computeSchedule(leaves.map((w) => ({ id: w.id, durationDays: w.durationDays })), deps);
    const cur = new Map(sched.items.map((s) => [s.id, s]));
    const cal = await this.calendars.forTenant(tenantId);
    const curEnd = (id: string) => { const s = cur.get(id); return s ? cal.span(project.startDate, s.earlyStart, s.earlyFinish).end : null; };
    const projectedEnd = sched.projectDurationDays > 0 ? cal.dateAt(project.startDate, sched.projectDurationDays - 1) : iso(project.startDate);

    // 基准：最近一版计划批准快照
    const snap = version?.snapshot as PlanSnapshot | undefined;
    const baseLeaves = snap ? snap.workPackages.filter((w) => w.isLeaf) : [];
    const budget = project.budget ? Number(project.budget) : 0;
    const hasWpBudgets = baseLeaves.some((w) => w.budget && Number(w.budget) > 0);
    const totalDur = baseLeaves.reduce((n, w) => n + w.durationDays, 0);
    const bacOf = (w: PlanSnapshot['workPackages'][number]) =>
      hasWpBudgets ? Number(w.budget ?? 0) : totalDur ? (budget * w.durationDays) / totalDur : 0;
    const pctById = new Map(wps.map((w) => [w.id, w.percentComplete]));

    let bac = 0, pv = 0, ev = 0;
    const slips: { id: string; code: string; name: string; baselineEnd: string; currentEnd: string; slipDays: number; critical: boolean }[] = [];
    for (const w of baseLeaves) {
      const b = bacOf(w);
      bac += b;
      // 计划值按工作日线性累计；里程碑到期即计入
      const frac = w.durationDays > 0
        ? Math.min(Math.max(cal.workdaysBetween(w.start, todayIso) / w.durationDays, 0), 1)
        : todayIso >= w.start ? 1 : 0;
      pv += b * frac;
      ev += b * ((pctById.get(w.id) ?? 0) / 100);
      const ce = curEnd(w.id);
      if (ce) {
        const slip = cal.workdaysBetween(w.end, ce);
        if (slip !== 0) slips.push({ id: w.id, code: w.code, name: w.name, baselineEnd: w.end, currentEnd: ce, slipDays: slip, critical: !!cur.get(w.id)?.critical });
      }
    }
    const ac = round2(costSum);
    const spi = snap ? ratio(ev, pv) : null;
    const cpi = snap ? ratio(ev, ac) : null;
    const accountEac = accounts.reduce((n, a) => {
      const etc = a.estimateToComplete !== null ? Number(a.estimateToComplete) : Math.max(Number(a.budget) - a.actual, 0);
      return n + a.actual + etc;
    }, 0);
    const eac = cpi && budget ? round2(budget / cpi) : accounts.length ? round2(accountEac) : null;

    const baselineEnd = snap ? (baseLeaves.length ? baseLeaves.map((w) => w.end).sort().at(-1)! : snap.project.endDate) : null;
    const scheduleSlipDays = baselineEnd && leaves.length ? cal.workdaysBetween(baselineEnd, projectedEnd) : 0;
    const customerDate = project.customerDeliveryDate ? iso(project.customerDeliveryDate) : null;

    // 质量
    const reqActive = requirements.filter((r) => r.status !== 'NOT_APPLICABLE');
    const uncovered = reqActive.filter((r) => !r.deliverableId).length;
    const rejected = deliverables.filter((d) => d.status === 'REJECTED').length;
    const overdueDeliverables = deliverables.filter((d) => d.dueDate && iso(d.dueDate) < todayIso && d.status !== 'ACCEPTED').length;
    const critical = ncs.filter((n) => n.severity === 'CRITICAL').length;
    const major = ncs.filter((n) => n.severity === 'MAJOR').length;
    const doneUnverified = leaves.filter((w) => w.status === WpStatus.DONE).length;

    const judge = (red: string[], amber: string[]): Dimension => ({
      health: red.length ? 'RED' : amber.length ? 'AMBER' : 'GREEN', reasons: [...red, ...amber],
    });
    const fmt = (n: number) => n.toFixed(2);

    const qRed: string[] = [], qAmber: string[] = [];
    if (critical) qRed.push(`${critical} 个严重不符合项未关闭`);
    if (rejected) qRed.push(`${rejected} 个交付物被退回`);
    if (major) qAmber.push(`${major} 个重大不符合项未关闭`);
    if (uncovered) qAmber.push(`${uncovered} 条需求未关联交付物`);
    if (overdueDeliverables) qAmber.push(`${overdueDeliverables} 个交付物逾期未接受`);
    if (doneUnverified) qAmber.push(`${doneUnverified} 个已完成的工作包待验证`);

    const sRed: string[] = [], sAmber: string[] = [];
    if (customerDate && leaves.length && projectedEnd > customerDate) sRed.push(`预计完工 ${projectedEnd} 晚于客户交期 ${customerDate}`);
    else if (leaves.length && projectedEnd > iso(project.endDate)) sRed.push(`预计完工 ${projectedEnd} 晚于计划结束 ${iso(project.endDate)}`);
    if (spi !== null && spi < redAt) sRed.push(`进度绩效指数 SPI ${fmt(spi)} 低于 ${fmt(redAt)}`);
    else if (spi !== null && spi < amberAt) sAmber.push(`进度绩效指数 SPI ${fmt(spi)} 低于 ${fmt(amberAt)}`);
    if (scheduleSlipDays > 0) sAmber.push(`比批准的计划晚 ${scheduleSlipDays} 个工作日`);

    const cRed: string[] = [], cAmber: string[] = [];
    if (eac !== null && budget && eac > budget) cRed.push(`完工估算 ${eac.toLocaleString()} 超出预算 ${budget.toLocaleString()}`);
    if (cpi !== null && cpi < redAt) cRed.push(`成本绩效指数 CPI ${fmt(cpi)} 低于 ${fmt(redAt)}`);
    else if (cpi !== null && cpi < amberAt) cAmber.push(`成本绩效指数 CPI ${fmt(cpi)} 低于 ${fmt(amberAt)}`);
    const accountOverruns = accounts.filter((a) => {
      const etc = a.estimateToComplete !== null ? Number(a.estimateToComplete) : Math.max(Number(a.budget) - a.actual, 0);
      return a.actual + etc > Number(a.budget);
    }).length;
    if (accountOverruns) cAmber.push(`${accountOverruns} 个成本科目预计超支`);

    return {
      baselineVersion: version?.version ?? null,
      thresholds: { amber: amberAt, red: redAt },
      evm: {
        basis: hasWpBudgets ? 'WORK_PACKAGE_BUDGET' : 'DURATION',
        bac: round2(bac), pv: round2(pv), ev: round2(ev), ac, spi, cpi, eac, budget: budget || null,
      },
      schedule: {
        baselineEnd, projectedEnd, plannedEnd: iso(project.endDate), customerDate, slipDays: scheduleSlipDays,
        slips: slips.sort((a, b) => b.slipDays - a.slipDays),
      },
      quality: {
        requirements: reqActive.length, uncoveredRequirements: uncovered,
        verifiedRequirements: requirements.filter((r) => r.status === 'VERIFIED').length,
        deliverables: deliverables.length, acceptedDeliverables: deliverables.filter((d) => d.status === 'ACCEPTED').length,
        rejectedDeliverables: rejected, overdueDeliverables,
        openNonconformities: ncs.length, criticalNonconformities: critical, majorNonconformities: major,
      },
      triangle: {
        quality: judge(qRed, qAmber),
        schedule: judge(sRed, sAmber),
        cost: judge(cRed, cAmber),
      },
    };
  }
}
