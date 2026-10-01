import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import type { Prisma } from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';

/** 六个场景（第 7 章） */
export const SCENARIOS = ['CONTRACT', 'PLAN', 'QUICK', 'MINUTES', 'ANALYSIS', 'REPORT'] as const;
export type Scenario = (typeof SCENARIOS)[number];
export const SCENARIO_LABELS: Record<Scenario, string> = {
  CONTRACT: '合同 / 技术协议 / 库存计划 → 项目要求',
  PLAN: '合同 + 模板 → 计划调整建议',
  QUICK: '一句话登记 → 不符合项 / 问题 / 风险 / 变更',
  MINUTES: '会议记录 → 纪要和行动项',
  ANALYSIS: '已录入数据 → 原因分析、应对措施、变更影响初稿',
  REPORT: '系统数据 → 周报和项目总结初稿',
};

export interface AiConfig {
  enabled: boolean;
  /** OpenAI 兼容接口地址，如 https://api.deepseek.com */
  baseUrl: string;
  model: string;
  scenarios: Record<Scenario, boolean>;
  /** 每人每天调用次数上限、全企业每天上限 */
  perUserDaily: number;
  perTenantDaily: number;
  /** 上传文件大小上限（MB）和送给模型的文字上限 */
  maxFileMb: number;
  maxInputChars: number;
}

export const DEFAULT_AI: AiConfig = {
  enabled: false,
  baseUrl: 'https://api.deepseek.com',
  model: 'deepseek-flash',
  scenarios: Object.fromEntries(SCENARIOS.map((s) => [s, true])) as Record<Scenario, boolean>,
  perUserDaily: 50,
  perTenantDaily: 500,
  maxFileMb: 10,
  maxInputChars: 120_000,
};

export async function loadAiConfig(prisma: PrismaService | Prisma.TransactionClient, tenantId: string) {
  const t = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { aiConfig: true, aiKeyEnc: true } });
  const c = (t.aiConfig ?? {}) as Partial<AiConfig>;
  const config: AiConfig = { ...DEFAULT_AI, ...c, scenarios: { ...DEFAULT_AI.scenarios, ...c.scenarios } };
  return { config, keyEnc: t.aiKeyEnc };
}

// ───── 密钥加密（AES-256-GCM，密钥由服务器的 AI_SECRET 或 JWT_SECRET 派生） ─────
function secret() {
  const s = process.env.AI_SECRET || process.env.JWT_SECRET;
  if (!s) throw new Error('AI_SECRET or JWT_SECRET must be set');
  return createHash('sha256').update(`claude-pm-ai:${s}`).digest();
}
export function encryptKey(plain: string) {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', secret(), iv);
  const enc = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return ['v1', iv.toString('base64'), c.getAuthTag().toString('base64'), enc.toString('base64')].join(':');
}
export function decryptKey(stored: string) {
  const [v, iv, tag, enc] = stored.split(':');
  if (v !== 'v1') throw new Error('Unknown key format');
  const d = createDecipheriv('aes-256-gcm', secret(), Buffer.from(iv, 'base64'));
  d.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(enc, 'base64')), d.final()]).toString('utf8');
}
/** 只显示前后几位 */
export function maskKey(plain: string) { return plain.length > 10 ? `${plain.slice(0, 3)}****${plain.slice(-4)}` : '****'; }
