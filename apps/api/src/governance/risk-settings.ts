import type { PrismaService } from '../prisma/prisma.service.js';
import type { Prisma } from '../generated/prisma/client.js';

export type Importance = 'LOW' | 'MEDIUM' | 'HIGH';
export type LevelKey = 'ENTERPRISE' | 'PROJECT' | 'WORK_PACKAGE';
export type Who = 'OWNER' | 'PM' | 'MANAGEMENT';
export type AcceptNeed = 'REASON' | 'REASON_PLAN' | 'REASON_PLAN_APPROVAL';
export interface Rule { approve: Who; close: Who; accept: AcceptNeed; notify: Who[]; reviewDays: number }
export interface RiskSettings {
  scale: 3 | 5;
  matrix: number[][];
  criteria: Record<string, string[]>;
  strategies: { RISK: string[]; OPPORTUNITY: string[] };
  rules: Record<string, Rule>;
}

export const IMPORTANCE: Importance[] = ['LOW', 'MEDIUM', 'HIGH'];
export const MATRIX_3 = [[0, 0, 1], [0, 1, 2], [1, 2, 2]];
export const MATRIX_5 = [[0, 0, 0, 0, 0], [0, 0, 1, 1, 1], [0, 1, 1, 1, 2], [0, 1, 1, 2, 2], [0, 1, 2, 2, 2]];
export const DEFAULT_CRITERIA: Record<string, string[]> = {
  交期: ['≤ 3 个工作日', '4–10 个工作日', '> 10 个工作日或影响里程碑'],
  成本: ['≤ 1 万', '1–5 万', '> 5 万或超目标成本'],
  质量: ['可返工', '需让步接收', '影响 FAI、客户投诉或安全'],
  客户: ['内部可消化', '需通知客户', '需客户批准'],
};
export const DEFAULT_STRATEGIES = { RISK: ['消除', '转移', '减弱', '接受'], OPPORTUNITY: ['利用', '分享', '提高', '接受'] };
/** 接受类策略（选它时按规则要求理由、应急预案、批准） */
export const ACCEPT = '接受';

const r = (approve: Who, close: Who, accept: AcceptNeed, notify: Who[], reviewDays: number): Rule => ({ approve, close, accept, notify, reviewDays });
/** 按“层级 × 重要度”的默认规则 */
export const DEFAULT_RULES: Record<string, Rule> = {
  'ENTERPRISE:HIGH': r('MANAGEMENT', 'MANAGEMENT', 'REASON_PLAN_APPROVAL', ['OWNER', 'MANAGEMENT'], 14),
  'ENTERPRISE:MEDIUM': r('MANAGEMENT', 'MANAGEMENT', 'REASON', ['OWNER', 'MANAGEMENT'], 30),
  'ENTERPRISE:LOW': r('MANAGEMENT', 'MANAGEMENT', 'REASON', ['OWNER', 'MANAGEMENT'], 30),
  'PROJECT:HIGH': r('PM', 'PM', 'REASON_PLAN_APPROVAL', ['OWNER', 'PM', 'MANAGEMENT'], 14),
  'PROJECT:MEDIUM': r('PM', 'PM', 'REASON', ['OWNER', 'PM'], 30),
  'PROJECT:LOW': r('PM', 'PM', 'REASON', ['OWNER', 'PM'], 30),
  'WORK_PACKAGE:HIGH': r('PM', 'PM', 'REASON_PLAN', ['OWNER', 'PM'], 14),
  'WORK_PACKAGE:MEDIUM': r('OWNER', 'OWNER', 'REASON', ['OWNER'], 30),
  'WORK_PACKAGE:LOW': r('OWNER', 'OWNER', 'REASON', ['OWNER'], 90),
};

export async function loadRiskSettings(prisma: PrismaService | Prisma.TransactionClient, tenantId: string): Promise<RiskSettings> {
  const t = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { riskScale: true, riskMatrix: true, riskCriteria: true, riskStrategies: true, riskRules: true } });
  const scale = t.riskScale === 5 ? 5 : 3;
  const m = t.riskMatrix as number[][] | null;
  const matrix = Array.isArray(m) && m.length === scale && m.every((row) => Array.isArray(row) && row.length === scale) ? m : scale === 5 ? MATRIX_5 : MATRIX_3;
  const crit = (t.riskCriteria ?? {}) as Record<string, string[]>;
  const strat = (t.riskStrategies ?? {}) as Partial<RiskSettings['strategies']>;
  const rules = (t.riskRules ?? {}) as Record<string, Partial<Rule>>;
  return {
    scale, matrix,
    criteria: Object.keys(crit).length ? crit : DEFAULT_CRITERIA,
    strategies: { RISK: strat.RISK?.length ? strat.RISK : DEFAULT_STRATEGIES.RISK, OPPORTUNITY: strat.OPPORTUNITY?.length ? strat.OPPORTUNITY : DEFAULT_STRATEGIES.OPPORTUNITY },
    rules: Object.fromEntries(Object.entries(DEFAULT_RULES).map(([k, v]) => [k, { ...v, ...rules[k] }])),
  };
}

export function importanceOf(s: Pick<RiskSettings, 'scale' | 'matrix'>, probability: number, impact: number): Importance {
  const p = Math.min(Math.max(probability, 1), s.scale) - 1;
  const i = Math.min(Math.max(impact, 1), s.scale) - 1;
  return IMPORTANCE[s.matrix[p]?.[i] ?? 0];
}

export function ruleOf(s: RiskSettings, level: LevelKey, imp: Importance): Rule {
  return s.rules[`${level}:${imp}`] ?? DEFAULT_RULES[`${level}:${imp}`];
}
