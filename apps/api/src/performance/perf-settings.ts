import type { Prisma } from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';

/** 自动计分的方面：时间、质量、成本；其他自定义方面由管理层打分 */
export type AutoAspect = 'TIME' | 'QUALITY' | 'COST';
export interface PerfAspect { key: string; name: string; weight: number }
export interface PerfRules {
  /** 每晚 1 个工作日扣分 */
  latePerDay: number;
  /** FAI 没有一次通过扣分 */
  faiNotFirstPass: number;
  /** 每个重大 / 严重不符合项扣分 */
  majorNc: number;
  criticalNc: number;
  /** 每个客户投诉（来源为客户的不符合项）扣分 */
  customerNc: number;
  /** 一次合格率目标（%），每低 1 个百分点扣分 */
  fpyTarget: number;
  fpyPerPct: number;
  /** 超目标成本：到成本上限时得分；没有上限时每超 1% 扣分；超过上限后每超 1% 再扣分 */
  capScore: number;
  overTargetPerPct: number;
  overCapPerPct: number;
}
export interface PerfGrades { excellent: number; good: number; pass: number }
export interface PerfVisibility {
  /** 被评价人提交后能看到自己的评价 */
  memberSelf: boolean;
  /** 所在部门负责人 */
  deptHead: boolean;
  /** 人事 */
  hr: boolean;
}
export interface PerfConfig { aspects: PerfAspect[]; rules: PerfRules; memberDims: string[]; grades: PerfGrades; visibility: PerfVisibility }

export const AUTO_ASPECTS: AutoAspect[] = ['TIME', 'QUALITY', 'COST'];
export const DEFAULT_PERF: PerfConfig = {
  aspects: [{ key: 'TIME', name: '时间', weight: 40 }, { key: 'QUALITY', name: '质量', weight: 30 }, { key: 'COST', name: '成本', weight: 30 }],
  rules: { latePerDay: 5, faiNotFirstPass: 20, majorNc: 10, criticalNc: 20, customerNc: 15, fpyTarget: 98, fpyPerPct: 2, capScore: 60, overTargetPerPct: 5, overCapPerPct: 10 },
  memberDims: ['工作质量', '按时完成', '协作配合', '主动性'],
  grades: { excellent: 90, good: 75, pass: 60 },
  visibility: { memberSelf: true, deptHead: true, hr: true },
};

export async function loadPerfConfig(prisma: PrismaService | Prisma.TransactionClient, tenantId: string): Promise<PerfConfig> {
  const t = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { perfConfig: true } });
  const c = (t.perfConfig ?? {}) as Partial<PerfConfig>;
  return {
    aspects: c.aspects?.length ? c.aspects : DEFAULT_PERF.aspects,
    rules: { ...DEFAULT_PERF.rules, ...c.rules },
    memberDims: c.memberDims?.length ? c.memberDims : DEFAULT_PERF.memberDims,
    grades: { ...DEFAULT_PERF.grades, ...c.grades },
    visibility: { ...DEFAULT_PERF.visibility, ...c.visibility },
  };
}

export const GRADE_LABELS = { EXCELLENT: '优秀', GOOD: '良好', PASS: '合格', IMPROVE: '待改进' } as const;
export function gradeOf(g: PerfGrades, score: number): keyof typeof GRADE_LABELS {
  return score >= g.excellent ? 'EXCELLENT' : score >= g.good ? 'GOOD' : score >= g.pass ? 'PASS' : 'IMPROVE';
}

/** 校验评价方面：key 唯一、名称非空、权重 0–100 且合计 100 */
export function checkAspects(aspects: unknown): string | null {
  if (!Array.isArray(aspects) || !aspects.length || aspects.length > 10) return 'aspects must be 1–10 items';
  const keys = new Set<string>();
  let sum = 0;
  for (const a of aspects as PerfAspect[]) {
    if (!a || typeof a.key !== 'string' || !/^[A-Z0-9_]{1,30}$/.test(a.key) || keys.has(a.key)) return 'invalid aspect key';
    if (typeof a.name !== 'string' || !a.name.trim() || a.name.length > 20) return 'invalid aspect name';
    if (!Number.isInteger(a.weight) || a.weight < 0 || a.weight > 100) return 'weight must be an integer 0–100';
    keys.add(a.key); sum += a.weight;
  }
  return sum === 100 ? null : 'weights must add up to 100';
}
