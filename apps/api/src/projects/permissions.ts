import type { PrismaService } from '../prisma/prisma.service.js';
import { requestMemo, withBypass } from '../prisma/tenant-context.js';

/**
 * 项目权限表（企业设置 → 项目权限）：项目里各项内容，除项目经理外还有哪些人可以编辑。
 * 列：项目质量经理（PQM）和企业的各职能角色（按用户在「用户与角色」里设的职能角色）。
 * 前提都是该项目的成员；项目经理（和企业管理员）始终可以编辑全部内容。
 *
 * 不放进表里、保持固定的（ISO 22163 职责分离）：立项审批、计划批准、变更审批、关口评审结论、
 * 项目关闭、项目成员调整、项目基本信息和计划基线、偏离通报。工作包进度由负责人本人或项目经理更新。
 */
export const PERM_KEYS = ['REQUIREMENTS', 'WBS', 'DELIVERABLES', 'PURCHASE', 'COST_PLAN', 'COST_ACTUAL', 'QUALITY', 'INSPECTION', 'NC', 'RISK', 'COMM', 'HANDOVER'] as const;
export type PermKey = (typeof PERM_KEYS)[number];

export const PERM_LABELS: Record<PermKey, string> = {
  REQUIREMENTS: '项目要求、需求细化',
  WBS: 'WBS 结构、工期、依赖（含导入、模板、按角色指定责任人）',
  DELIVERABLES: '交付物、配置项',
  PURCHASE: '采购计划、下单、到货',
  COST_PLAN: '成本策划（成本科目、工作包预算）',
  COST_ACTUAL: '实际成本、承诺成本记账',
  QUALITY: '质量策划',
  INSPECTION: '检验记录、FAI、工作包验证',
  NC: '不符合项处理与关闭',
  RISK: '风险与机会的评价、应对（含 SWOT）',
  COMM: '会议、公告、沟通计划、干系人',
  HANDOVER: '售后交接',
};

/** 列：PQM = 项目质量经理；其余为职能角色 id */
export const PQM = 'PQM';
export interface PermConfig { grants: Record<PermKey, string[]> }

/** 默认：项目质量经理沿用原来的权限并加上会议公告、售后交接；职能角色按名称匹配常见分工 */
const DEFAULT_PQM: PermKey[] = ['REQUIREMENTS', 'DELIVERABLES', 'QUALITY', 'INSPECTION', 'NC', 'RISK', 'COMM', 'HANDOVER'];
const DEFAULT_BY_NAME: [RegExp, PermKey[]][] = [
  [/采购|供应/, ['PURCHASE', 'COST_ACTUAL']],
  [/设计|技术|研发|工程/, ['REQUIREMENTS', 'DELIVERABLES', 'RISK']],
  [/制造|生产|工艺/, ['DELIVERABLES', 'INSPECTION']],
  [/质量|检验/, ['INSPECTION']],
];

export function defaultPermConfig(roles: { id: string; name: string }[]): PermConfig {
  const grants = Object.fromEntries(PERM_KEYS.map((k) => [k, DEFAULT_PQM.includes(k) ? [PQM] : []])) as Record<PermKey, string[]>;
  for (const r of roles) {
    const keys = DEFAULT_BY_NAME.find(([re]) => re.test(r.name))?.[1] ?? [];
    for (const k of keys) grants[k].push(r.id);
  }
  return { grants };
}

/** 企业的权限表（没保存过时按职能角色名称生成默认值）；同一请求内只读一次 */
export function loadPermConfig(prisma: PrismaService, tenantId: string): Promise<PermConfig> {
  return requestMemo(`perm:${tenantId}`, async () => {
    const [t, roles] = await withBypass(() => Promise.all([
      prisma.tenant.findUnique({ where: { id: tenantId }, select: { permConfig: true } }),
      prisma.functionalRole.findMany({ where: { tenantId, active: true }, select: { id: true, name: true }, orderBy: { sortOrder: 'asc' } }),
    ]));
    const saved = (t?.permConfig ?? {}) as Partial<PermConfig>;
    if (!saved.grants) return defaultPermConfig(roles);
    const grants = Object.fromEntries(PERM_KEYS.map((k) => [k, Array.isArray(saved.grants![k]) ? saved.grants![k] : []])) as Record<PermKey, string[]>;
    return { grants };
  });
}

/** 某人在项目里可以编辑哪些内容 */
export function resolvePerms(cfg: PermConfig, who: { isManager: boolean; isQuality: boolean; isMember: boolean; functionalRoleId: string | null }): Record<PermKey, boolean> {
  return Object.fromEntries(PERM_KEYS.map((k) => {
    if (who.isManager) return [k, true];
    if (!who.isMember) return [k, false];
    const g = cfg.grants[k];
    return [k, (who.isQuality && g.includes(PQM)) || (!!who.functionalRoleId && g.includes(who.functionalRoleId))];
  })) as Record<PermKey, boolean>;
}
