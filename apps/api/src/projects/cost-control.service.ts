import { Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { ProjectRole, Role } from '../generated/prisma/enums.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

type Tx = Prisma.TransactionClient;
const money = (n: number) => Math.round(n * 100) / 100;

/** 默认成本科目：人工由工作包 人天 × 费率 自动归集，其余按工作包费用行归集 */
export const DEFAULT_ACCOUNTS: { code: string; name: string; isLabor?: boolean }[] = [
  { code: '01', name: '人工', isLabor: true }, { code: '02', name: '材料' }, { code: '03', name: '外协' }, { code: '04', name: '工装' },
  { code: '05', name: '试验' }, { code: '06', name: '差旅' }, { code: '07', name: '其他' },
];

/** 计划批准时的成本检查：工作包合计 ≤ 科目预算，科目合计 ≤ 目标成本 ≤ 成本上限，每个工作包都有预算 */
export function costChecks(cap: number | null, target: number | null, accSum: number, wpSum: number, accounts: { name: string; budget: number; wpTotal: number }[], wps: { isMilestone: boolean; budget: number; code: string }[]) {
  const out: { key: string; ok: boolean; message: string }[] = [];
  const wan = (n: number) => `${(n / 10000).toLocaleString('zh-CN', { maximumFractionDigits: 2 })} 万`;
  const short = accounts.filter((a) => a.wpTotal > a.budget);
  out.push({ key: 'costAccounts', ok: short.length === 0, message: short.length ? `成本科目：${short.map((a) => a.name).join('、')} 的工作包合计超出科目预算` : `工作包合计 ${wan(wpSum)} ≤ 科目合计 ${wan(accSum)}` });
  if (target !== null) out.push({ key: 'costTarget', ok: accSum <= target, message: `科目合计 ${wan(accSum)} ≤ 目标成本 ${wan(target)}` });
  else out.push({ key: 'costTarget', ok: false, message: '目标成本（项目预算）还没有设定' });
  if (cap !== null && target !== null) out.push({ key: 'costCap', ok: target <= cap, message: `目标成本 ${wan(target)} ≤ 成本上限 ${wan(cap)}` });
  const none = wps.filter((w) => !w.isMilestone && !(w.budget > 0));
  out.push({ key: 'costWp', ok: none.length === 0, message: none.length ? `还有 ${none.length} 个工作包没有预算（${none.slice(0, 5).map((w) => w.code).join('、')}${none.length > 5 ? ' 等' : ''}）` : '每个工作包都有预算' });
  return out;
}

export type CostState = '' | 'AMBER' | 'RED';
export interface WpCost {
  id: string; code: string; name: string; ownerId: string | null; percentComplete: number; isMilestone: boolean;
  role: { id: string; name: string; rate: number } | null;
  personDays: number; rate: number; rateOverride: number | null; rateReason: string | null; labor: number;
  lines: { id: string; accountId: string; description: string; amount: number }[];
  budget: number; actual: number; commitment: number; etc: number; etcManual: boolean; eac: number; state: CostState;
}

/**
 * 成本的策划、执行与控制（第 5A 章）：
 * - 工作包预算 = 人工（人天 × 职能角色标准费率，可手工改并写原因）+ 材料、外协等费用行；
 * - 执行时看实际成本、承诺成本（已下单未结算）和负责人估计的尚需成本，得出工作包预计完工成本；
 * - 工作包预计超支：提醒项目经理和负责人（超 10% 以内为黄、以上为红）；项目完工估算超出目标成本：报警到管理层。
 */
@Injectable()
export class CostControlService {
  constructor(private readonly prisma: PrismaService, private readonly notifications: NotificationsService) {}

  /** 项目没有成本科目时建默认科目（预算为 0，由项目经理分配） */
  async ensureAccounts(tx: Tx | PrismaService, tenantId: string, projectId: string) {
    const have = await tx.costAccount.findMany({ where: { projectId, tenantId } });
    if (have.length) return have;
    await tx.costAccount.createMany({ data: DEFAULT_ACCOUNTS.map((a) => ({ tenantId, projectId, code: a.code, name: a.name, budget: 0, isLabor: !!a.isLabor })) });
    return tx.costAccount.findMany({ where: { projectId, tenantId } });
  }

  /** 计划批准检查用：成本链条 */
  async planChecks(tenantId: string, projectId: string, cap: number | null) {
    const [project, accounts, wps] = await Promise.all([
      this.prisma.project.findUniqueOrThrow({ where: { id: projectId }, select: { budget: true } }),
      this.prisma.costAccount.findMany({ where: { projectId, tenantId } }),
      this.wpCosts(tenantId, projectId),
    ]);
    const labor = accounts.find((a) => a.isLabor);
    const totals = new Map<string, number>();
    for (const w of wps) {
      if (labor) totals.set(labor.id, (totals.get(labor.id) ?? 0) + w.labor);
      for (const l of w.lines) totals.set(l.accountId, (totals.get(l.accountId) ?? 0) + l.amount);
    }
    const rows = accounts.map((a) => ({ name: a.name, budget: Number(a.budget), wpTotal: money(totals.get(a.id) ?? 0) }));
    return costChecks(cap, project.budget !== null ? Number(project.budget) : null, money(rows.reduce((n, a) => n + a.budget, 0)), money(wps.reduce((n, w) => n + w.budget, 0)), rows, wps);
  }

  labor(personDays: number, rate: number) {
    return money(personDays * rate);
  }

  /** 重新计算工作包预算（人工 + 费用行），写回 budget */
  async recomputeBudget(tx: Tx, wpId: string) {
    const wp = await tx.workPackage.findUniqueOrThrow({ where: { id: wpId }, include: { costLines: true } });
    const role = wp.functionalRoleId ? await tx.functionalRole.findUnique({ where: { id: wp.functionalRoleId } }) : null;
    const rate = wp.laborRate !== null ? Number(wp.laborRate) : Number(role?.rate ?? 0);
    const budget = this.labor(Number(wp.resourceDays ?? 0), rate) + wp.costLines.reduce((n, l) => n + Number(l.amount), 0);
    await tx.workPackage.update({ where: { id: wpId }, data: { budget: money(budget) } });
    return money(budget);
  }

  /** 末级工作包的成本视图 */
  async wpCosts(tenantId: string, projectId: string): Promise<WpCost[]> {
    const [wps, roles, actuals, commits] = await Promise.all([
      this.prisma.workPackage.findMany({ where: { projectId, tenantId }, include: { costLines: { orderBy: { createdAt: 'asc' } } }, orderBy: { code: 'asc' } }),
      this.prisma.functionalRole.findMany({ where: { tenantId } }),
      this.prisma.costEntry.groupBy({ by: ['workPackageId'], where: { projectId, tenantId, workPackageId: { not: null } }, _sum: { amount: true } }),
      this.prisma.costCommitment.groupBy({ by: ['workPackageId'], where: { projectId, tenantId, workPackageId: { not: null } }, _sum: { amount: true } }),
    ]);
    const parents = new Set(wps.map((w) => w.parentId).filter(Boolean));
    const actualBy = new Map(actuals.map((a) => [a.workPackageId, Number(a._sum.amount ?? 0)]));
    const commitBy = new Map(commits.map((a) => [a.workPackageId, Number(a._sum.amount ?? 0)]));
    return wps.filter((w) => !parents.has(w.id)).sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true })).map((w) => {
      const role = roles.find((r) => r.id === w.functionalRoleId) ?? null;
      const rateOverride = w.laborRate !== null ? Number(w.laborRate) : null;
      const rate = rateOverride ?? Number(role?.rate ?? 0);
      const personDays = Number(w.resourceDays ?? 0);
      const labor = this.labor(personDays, rate);
      const lines = w.costLines.map((l) => ({ id: l.id, accountId: l.accountId, description: l.description, amount: Number(l.amount) }));
      const budget = w.budget !== null ? Number(w.budget) : money(labor + lines.reduce((n, l) => n + l.amount, 0));
      const actual = money(actualBy.get(w.id) ?? 0);
      const commitment = money(commitBy.get(w.id) ?? 0);
      const etcManual = w.estimateToComplete !== null;
      const etc = etcManual ? Number(w.estimateToComplete) : money(Math.max(0, budget * (1 - w.percentComplete / 100) - commitment));
      const eac = money(actual + commitment + etc);
      return {
        id: w.id, code: w.code, name: w.name, ownerId: w.ownerId, percentComplete: w.percentComplete, isMilestone: w.isMilestone,
        role: role ? { id: role.id, name: role.name, rate: Number(role.rate) } : null,
        personDays, rate, rateOverride, rateReason: w.laborRateReason, labor, lines,
        budget, actual, commitment, etc, etcManual, eac, state: this.state(budget, eac, actual + commitment),
      };
    });
  }

  /** 预计完工超出预算：10% 以内为黄，以上为红；还没有发生成本时不判断 */
  state(budget: number, eac: number, spent: number): CostState {
    if (spent <= 0) return '';
    if (budget <= 0) return eac > 0 ? 'RED' : '';
    const r = eac / budget;
    return r > 1.1 ? 'RED' : r > 1 ? 'AMBER' : '';
  }

  /**
   * 检查超支并提醒：工作包级 → 项目经理和负责人；项目级（完工估算超出目标成本）→ 管理层。
   * 同一级别只提醒一次，恢复正常后清除。
   */
  async evaluate(tenantId: string, projectId: string) {
    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project) return;
    const costs = await this.wpCosts(tenantId, projectId);
    const pms = (await this.prisma.projectMember.findMany({ where: { projectId, projectRole: ProjectRole.PROJECT_MANAGER, active: true }, select: { userId: true } })).map((m) => m.userId);
    const stored = new Map((await this.prisma.workPackage.findMany({ where: { projectId, tenantId }, select: { id: true, costAlert: true } })).map((w) => [w.id, w.costAlert]));
    for (const c of costs) {
      const prev = stored.get(c.id) ?? null;
      const now = c.state || null;
      if (prev === now) continue;
      await this.prisma.workPackage.update({ where: { id: c.id }, data: { costAlert: now } });
      if (now && (prev === null || (prev === 'AMBER' && now === 'RED'))) {
        await this.notifications.notify(tenantId, [...pms, c.ownerId], {
          kind: 'WP_COST_OVERRUN',
          title: `工作包预计超支：${project.name} ${c.code} ${c.name}`,
          body: `预算 ${c.budget.toLocaleString()} 元，预计完工 ${c.eac.toLocaleString()} 元（超 ${Math.round((c.eac / Math.max(c.budget, 1) - 1) * 100)}%）`,
          link: `/projects/${projectId}?g=ctrl&s=cost`,
        });
      }
    }
    const target = project.budget !== null ? Number(project.budget) : null;
    const eac = money(costs.reduce((n, c) => n + c.eac, 0));
    const spent = costs.reduce((n, c) => n + c.actual + c.commitment, 0);
    // 挣值：EV = 工作包预算 × 完成比例，AC = 实际成本；CPI 低于企业告警线也报警
    const ev = costs.reduce((n, c) => n + c.budget * c.percentComplete / 100, 0);
    const ac = costs.reduce((n, c) => n + c.actual, 0);
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { evmRed: true } });
    const cpi = ac > 0 ? ev / ac : null;
    const cpiLow = cpi !== null && cpi < Number(tenant?.evmRed ?? 0.9);
    const alarm = spent > 0 && ((target !== null && eac > target) || cpiLow) ? 'RED' : null;
    if (alarm !== project.costAlert) {
      await this.prisma.project.update({ where: { id: projectId }, data: { costAlert: alarm } });
      if (alarm) {
        const mgmt = (await this.prisma.user.findMany({ where: { tenantId, active: true, role: Role.TOP_MANAGEMENT }, select: { id: true } })).map((u) => u.id);
        await this.notifications.notify(tenantId, [...mgmt, ...pms], {
          kind: 'PROJECT_COST_ALARM',
          title: `项目总预算异常：${project.name}`,
          body: target !== null && eac > target ? `完工估算 ${eac.toLocaleString()} 元，超过目标成本 ${target.toLocaleString()} 元` : `成本绩效指数 CPI ${cpi!.toFixed(2)}，低于告警线`,
          link: `/projects/${projectId}?g=ctrl&s=cost`,
        });
      }
    }
    return { eac, target, alarm, cpi: cpi === null ? null : Math.round(cpi * 100) / 100 };
  }
}
