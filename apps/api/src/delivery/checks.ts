import type { Prisma, PurchaseItem } from '../generated/prisma/client.js';
import { FaiResult, PurchaseStatus } from '../generated/prisma/enums.js';
import type { PrismaService } from '../prisma/prisma.service.js';

type Tx = Prisma.TransactionClient | PrismaService;
const day = (d: Date) => d.toISOString().slice(0, 10);
export const LIVE: PurchaseStatus[] = [PurchaseStatus.PLANNED, PurchaseStatus.ORDERED, PurchaseStatus.PARTIAL, PurchaseStatus.RECEIVED];

/** 采购相关的检查（量产准备评审自动检查、采购计划页） */
export async function purchaseChecks(prisma: Tx, tenantId: string, projectId: string) {
  const [plan, items] = await Promise.all([
    prisma.purchasePlan.findUnique({ where: { projectId } }),
    prisma.purchaseItem.findMany({ where: { tenantId, projectId, status: { in: LIVE } } }),
  ]);
  const today = day(new Date());
  const longLead = items.filter((i) => i.longLead);
  const longOpen = longLead.filter((i) => i.status === PurchaseStatus.PLANNED);
  const notReceived = items.filter((i) => i.status !== PurchaseStatus.RECEIVED);
  const overdue = items.filter((i) => isOverdue(i, today));
  return {
    approved: { ok: !!plan?.version && !plan.dirty, message: !plan?.version ? '采购计划还没有批准' : plan.dirty ? `采购计划 v${plan.version} 修订后待重新批准` : `采购计划 v${plan.version} 已批准` },
    longLead: { ok: longOpen.length === 0, message: longLead.length ? (longOpen.length ? `长周期物料还有 ${longOpen.length} 项未下单（${longOpen.map((i) => i.code).join('、')}）` : `长周期物料已全部下单（${longLead.length} 项）`) : '没有长周期物料' },
    received: { ok: items.length > 0 && notReceived.length === 0, message: !items.length ? '还没有物料' : notReceived.length ? `还有 ${notReceived.length} 项物料未全部到货` : '物料已全部到货' },
    overdue: { ok: overdue.length === 0, message: overdue.length ? `逾期未下单：${overdue.map((i) => i.code).join('、')}` : '没有逾期未下单的物料' },
  };
}
export function isOverdue(i: PurchaseItem, today: string) {
  const by = i.orderBy ?? i.needDate;
  return i.status === PurchaseStatus.PLANNED && !!by && day(by) < today;
}

/**
 * FAI 结论汇总：每个产品 / 零件按时间先后，第一次的结论决定“是否一次通过”，最近一次决定当前状态。
 * 供项目目标（FAI 目标）和项目经理绩效（质量）使用。
 */
export async function faiSummary(prisma: Tx, projectId: string) {
  const records = await prisma.faiRecord.findMany({ where: { projectId }, orderBy: [{ date: 'asc' }, { createdAt: 'asc' }] });
  const parts = new Map<string, { part: string; first: FaiResult; latest: FaiResult; records: number }>();
  for (const r of records) {
    const p = parts.get(r.part);
    if (p) { p.latest = r.result; p.records += 1; } else parts.set(r.part, { part: r.part, first: r.result, latest: r.result, records: 1 });
  }
  const list = [...parts.values()];
  const firstPass = list.length ? list.every((p) => p.first === FaiResult.PASS) : null;
  const state: 'GREY' | 'GREEN' | 'AMBER' | 'RED' = !list.length ? 'GREY'
    : list.some((p) => p.latest === FaiResult.FAIL) ? 'RED'
      : list.some((p) => p.latest === FaiResult.CONDITIONAL) || !firstPass ? 'AMBER' : 'GREEN';
  const text = !list.length ? '还没有 FAI 记录'
    : list.map((p) => `${p.part}：${p.first === FaiResult.PASS ? '一次通过' : p.latest === FaiResult.PASS ? `第 ${p.records} 次通过` : p.latest === FaiResult.CONDITIONAL ? '有条件通过' : '未通过'}`).join('；');
  return { records, parts: list, firstPass, state, text };
}

