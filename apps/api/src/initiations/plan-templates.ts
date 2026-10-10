import { BadRequestException } from '@nestjs/common';
import { ProjectType } from '../generated/prisma/enums.js';
import type { Requirements } from './requirements.js';

/**
 * A / B / C 三类项目的通用计划模板（见《通用项目计划模板（A/B/C 简化版）》）。
 * 一级是阶段或工作线（采购没有阶段，贯穿全程），二级是工作包；工期为工作日，◆ 里程碑工期为 0。
 * condition：立项时没选上的条件，生成计划草稿时去掉该工作包，并把依赖它的工作包改接到它的前置上。
 */
export type Condition = 'drawingApproval' | 'customerWitness' | 'rams' | 'longLead';
export interface TemplateGroup { code: string; name: string; group: true; phase: string | null }
export interface TemplateItem {
  code: string; name: string; durationDays: number; predecessors: string[]; role: string; deliverable: string;
  milestone?: boolean; condition?: Condition;
}
export type TemplateRow = TemplateGroup | TemplateItem;
export const isGroup = (r: TemplateRow): r is TemplateGroup => (r as TemplateGroup).group === true;

const g = (code: string, name: string, phase: string | null = name): TemplateGroup => ({ code, name, group: true, phase });
const w = (code: string, name: string, durationDays: number, predecessors: string[], role: string, deliverable = '', condition?: Condition): TemplateItem =>
  ({ code, name, durationDays, predecessors, role, deliverable, ...(condition ? { condition } : {}) });
const m = (code: string, name: string, predecessors: string[], role: string, deliverable = ''): TemplateItem =>
  ({ code, name, durationDays: 0, predecessors, role, deliverable, milestone: true });

const planning = (contract: boolean): TemplateRow[] => [
  g('1', '项目策划'),
  w('1.1', contract ? '项目启动会' : '计划下达与启动', 1, [], '项目经理', contract ? '启动会纪要' : '启动记录'),
  ...(contract
    ? [w('1.2', '项目要求分解与需求清单', 5, ['1.1'], '项目经理', '需求清单'), w('1.3', '编制项目计划', 5, ['1.2'], '项目经理', '项目计划'),
       w('1.4', '风险与机会识别', 3, ['1.2'], '项目经理', '风险登记册'), m('1.5', '计划批准', ['1.3', '1.4'], '项目经理', '计划批准记录')]
    : [w('1.2', '编制项目计划', 3, ['1.1'], '项目经理', '项目计划'), w('1.3', '风险识别', 1, ['1.1'], '项目经理', '风险登记册'),
       m('1.4', '计划批准', ['1.2', '1.3'], '项目经理', '计划批准记录')]),
];

export const DEFAULT_TEMPLATES: Record<ProjectType, TemplateRow[]> = {
  A: [
    ...planning(true),
    g('2', '产品设计开发'),
    w('2.1', '设计输入确认', 5, ['1.5'], '设计', '设计输入清单'),
    w('2.2', '方案设计', 15, ['2.1'], '设计', '方案设计说明'),
    m('2.3', '方案设计评审', ['2.2'], '设计', '评审记录'),
    w('2.4', '详细设计（图纸、BOM）', 25, ['2.3'], '设计', '图纸、BOM'),
    w('2.5', '设计计算与 RAMS 分析', 10, ['2.3'], '设计', '计算与分析报告', 'rams'),
    m('2.6', '详细设计评审', ['2.4', '2.5'], '设计', '评审记录'),
    w('2.7', '客户图纸审批', 10, ['2.6'], '设计', '客户批准记录', 'drawingApproval'),
    w('2.8', '样件试制与设计验证试验', 20, ['2.6', '6.2'], '设计', '试验报告'),
    m('2.9', '设计冻结', ['2.7', '2.8'], '设计', '设计冻结记录'),
    g('3', '工艺设计开发'),
    w('3.1', '工艺方案与过程流程图', 5, ['2.6'], '工艺', '过程流程图'),
    w('3.2', 'PFMEA', 5, ['3.1'], '工艺', 'PFMEA'),
    w('3.3', '工艺文件与作业指导书', 10, ['3.2', '2.9'], '工艺', '工艺文件'),
    w('3.4', '工装、检具设计与制造', 20, ['3.1'], '工艺', '工装检具验收记录'),
    w('3.5', '检验规范与控制计划', 5, ['3.2'], '质量', '控制计划、检验规范'),
    m('3.6', '工艺评审', ['3.3', '3.4', '3.5'], '工艺', '评审记录'),
    g('4', 'FAI 首件鉴定'),
    w('4.1', '首件生产', 5, ['3.6', '6.4'], '生产', '生产记录'),
    w('4.2', '首件检验与 FAI 报告', 5, ['4.1'], '质量', 'FAI 报告'),
    w('4.3', '客户见证或批准', 5, ['4.2'], '质量', '客户确认记录', 'customerWitness'),
    m('4.4', 'FAI 完成', ['4.3'], '质量', 'FAI 结论'),
    g('5', '量产'),
    m('5.1', '量产准备评审', ['4.4', '6.6'], '项目经理', '评审记录'),
    w('5.2', '批量生产', 30, ['5.1'], '生产', '生产记录'),
    w('5.3', '出厂检验', 5, ['5.2'], '质量', '检验记录'),
    g('6', '采购', null),
    w('6.1', '供应商寻源与确认', 10, ['1.5'], '采购', '合格供应商清单'),
    w('6.2', '样件采购', 15, ['6.1', '2.6'], '采购', '到货记录'),
    w('6.3', '长周期物料提前订货', 5, ['2.6'], '采购', '订单', 'longLead'),
    w('6.4', '首件物料采购到货', 20, ['2.9'], '采购', '来料检验记录'),
    w('6.5', '批量采购计划批准与下单', 5, ['2.9'], '采购', '采购计划、订单'),
    w('6.6', '批量物料到货', 25, ['6.5'], '采购', '来料检验记录'),
    g('7', '交付'),
    w('7.1', '交付文件准备（合格证、质量文件包）', 5, ['5.3'], '质量', '交付文件'),
    w('7.2', '包装与发运', 3, ['5.3'], '物流', '发运单'),
    m('7.3', '交付客户验收', ['7.1', '7.2'], '项目经理', '客户验收记录'),
    g('8', '项目总结'),
    w('8.1', '项目总结与经验教训', 5, ['7.3'], '项目经理', '项目总结报告'),
    w('8.2', '售后交接', 2, ['8.1'], '项目经理', '交接记录'),
    m('8.3', '项目关闭', ['8.2'], '项目经理'),
  ],
  B: [
    ...planning(true),
    g('2', '技术准备'),
    w('2.1', '客户图纸与技术文件接收、评审', 5, ['1.5'], '技术', '技术文件评审记录'),
    w('2.2', '技术要求转化（BOM、工艺路线）', 5, ['2.1'], '工艺', 'BOM、工艺路线'),
    w('2.3', 'PFMEA 与控制计划', 5, ['2.2'], '工艺', 'PFMEA、控制计划'),
    w('2.4', '工艺文件与作业指导书', 10, ['2.3'], '工艺', '工艺文件'),
    w('2.5', '工装、检具准备', 15, ['2.2'], '工艺', '工装检具验收记录'),
    m('2.6', '技术准备评审', ['2.4', '2.5'], '工艺', '评审记录'),
    g('3', 'FAI 首件鉴定'),
    w('3.1', '首件生产', 5, ['2.6', '5.3'], '生产', '生产记录'),
    w('3.2', '首件检验与 FAI 报告', 5, ['3.1'], '质量', 'FAI 报告'),
    w('3.3', '客户见证或批准', 5, ['3.2'], '质量', '客户确认记录', 'customerWitness'),
    m('3.4', 'FAI 完成', ['3.3'], '质量', 'FAI 结论'),
    g('4', '量产'),
    m('4.1', '量产准备评审', ['3.4', '5.5'], '项目经理', '评审记录'),
    w('4.2', '批量生产', 30, ['4.1'], '生产', '生产记录'),
    w('4.3', '出厂检验', 5, ['4.2'], '质量', '检验记录'),
    g('5', '采购', null),
    w('5.1', '供应商确认', 5, ['1.5'], '采购', '合格供应商清单'),
    w('5.2', '长周期物料提前订货', 5, ['2.2', '5.1'], '采购', '订单', 'longLead'),
    w('5.3', '首件物料采购到货', 15, ['2.2', '5.1'], '采购', '来料检验记录'),
    w('5.4', '批量采购计划批准与下单', 5, ['2.6'], '采购', '采购计划、订单'),
    w('5.5', '批量物料到货', 20, ['5.4'], '采购', '来料检验记录'),
    g('6', '交付'),
    w('6.1', '交付文件准备（合格证、质量文件包）', 5, ['4.3'], '质量', '交付文件'),
    w('6.2', '包装与发运', 3, ['4.3'], '物流', '发运单'),
    m('6.3', '交付客户验收', ['6.1', '6.2'], '项目经理', '客户验收记录'),
    g('7', '项目总结'),
    w('7.1', '项目总结与经验教训', 5, ['6.3'], '项目经理', '项目总结报告'),
    w('7.2', '售后交接', 2, ['7.1'], '项目经理', '交接记录'),
    m('7.3', '项目关闭', ['7.2'], '项目经理'),
  ],
  C: [
    ...planning(false),
    g('2', '技术准备'),
    w('2.1', '技术文件有效性确认（图纸、工艺、检验文件为现行版本）', 3, ['1.4'], '工艺', '确认记录'),
    w('2.2', '工装、检具状态确认', 3, ['1.4'], '工艺', '确认记录'),
    m('2.3', '技术准备确认', ['2.1', '2.2'], '工艺', '确认记录'),
    g('3', 'FAI 首件鉴定'),
    w('3.1', '首件生产', 3, ['2.3', '5.2'], '生产', '生产记录'),
    w('3.2', '首件检验与 FAI 报告', 3, ['3.1'], '质量', 'FAI 报告'),
    m('3.3', 'FAI 完成', ['3.2'], '质量', 'FAI 结论'),
    g('4', '生产'),
    m('4.1', '生产准备确认（含物料到位）', ['3.3', '5.3'], '项目经理', '确认记录'),
    w('4.2', '批量生产', 20, ['4.1'], '生产', '生产记录'),
    w('4.3', '出厂检验', 3, ['4.2'], '质量', '检验记录'),
    g('5', '采购', null),
    w('5.1', '物料需求计算与采购计划', 3, ['1.4'], '计划', '采购计划'),
    w('5.2', '首件物料到货', 10, ['5.1'], '采购', '来料检验记录'),
    w('5.3', '批量物料到货', 20, ['5.1'], '采购', '来料检验记录'),
    g('6', '入库'),
    w('6.1', '入库检验与文件归档', 2, ['4.3'], '质量', '入库检验记录'),
    m('6.2', '入库完成', ['6.1'], '仓库', '入库单'),
    g('7', '项目总结'),
    w('7.1', '项目总结', 2, ['6.2'], '项目经理', '项目总结报告'),
    m('7.2', '项目关闭', ['7.1'], '项目经理'),
  ],
};

/** 交付（C 类为入库）里程碑：项目要求的交付日期挂在它上面 */
export const DELIVERY_MILESTONE: Record<ProjectType, string> = { A: '7.3', B: '6.3', C: '6.2' };

/** 各阶段的评审清单和必选参与者 */
const PHASE_RULES: Record<string, { checklist: string[]; mandatoryRoles: string[] }> = {
  项目策划: { checklist: ['项目要求已分解为需求清单', '计划已批准', '风险与机会已识别'], mandatoryRoles: ['PROJECT_MANAGER'] },
  产品设计开发: { checklist: ['设计输入已确认', '设计评审已完成', '设计已冻结'], mandatoryRoles: ['PROJECT_MANAGER', 'PROJECT_QUALITY_MANAGER'] },
  工艺设计开发: { checklist: ['PFMEA 与控制计划已完成', '工艺文件与工装检具已就绪'], mandatoryRoles: ['PROJECT_MANAGER', 'PROJECT_QUALITY_MANAGER'] },
  技术准备: { checklist: ['客户图纸与技术文件已评审', 'PFMEA 与控制计划已完成', '工艺文件与工装检具已就绪'], mandatoryRoles: ['PROJECT_MANAGER', 'PROJECT_QUALITY_MANAGER'] },
  'FAI 首件鉴定': { checklist: ['首件检验已完成', 'FAI 报告已出具', '遗留问题已关闭或已有计划'], mandatoryRoles: ['PROJECT_MANAGER', 'PROJECT_QUALITY_MANAGER'] },
  量产: { checklist: ['采购计划已批准', '长周期物料已下单', '批量生产与出厂检验已完成'], mandatoryRoles: ['PROJECT_MANAGER', 'PROJECT_QUALITY_MANAGER'] },
  生产: { checklist: ['物料已到位', '批量生产与出厂检验已完成'], mandatoryRoles: ['PROJECT_MANAGER', 'PROJECT_QUALITY_MANAGER'] },
  交付: { checklist: ['交付文件已准备', '客户已验收'], mandatoryRoles: ['PROJECT_MANAGER', 'PROJECT_QUALITY_MANAGER'] },
  入库: { checklist: ['入库检验已完成', '已入库'], mandatoryRoles: ['PROJECT_MANAGER'] },
  项目总结: { checklist: ['项目要求达成情况已评价', '经验教训已登记'], mandatoryRoles: ['PROJECT_MANAGER'] },
};
export function phaseRule(name: string) {
  return PHASE_RULES[name] ?? { checklist: [], mandatoryRoles: ['PROJECT_MANAGER'] };
}

export interface GeneratedItem extends TemplateItem { parentCode: string; phase: string | null; purchase: boolean }
export interface GeneratedPlan {
  phases: string[];
  items: GeneratedItem[];
  removed: { code: string; name: string; reason: string }[];
}

const CONDITION_REASON: Record<Condition, string> = {
  drawingApproval: '立项时未要求客户图纸审批',
  customerWitness: '立项时未要求客户见证或批准首件',
  rams: '立项时未要求 RAMS 分析',
  longLead: '立项时选择“无长周期物料”',
};

/** 按项目要求取舍模板：去掉没选上的条件项（B/C 类不做 FAI 时去掉整个 FAI 阶段），被去掉的前置改接到它自己的前置 */
export function generatePlan(type: ProjectType, rows: TemplateRow[], req: Requirements): GeneratedPlan {
  const groups = rows.filter(isGroup);
  const items = rows.filter((r): r is TemplateItem => !isGroup(r));
  const groupOf = (code: string) => groups.find((x) => x.code === code.split('.')[0]);
  const dropFai = type !== ProjectType.A && !req.quality.fai;
  const removed: GeneratedPlan['removed'] = [];
  const keep = new Set<string>();
  for (const it of items) {
    const grp = groupOf(it.code);
    if (dropFai && grp?.name.startsWith('FAI')) { removed.push({ code: it.code, name: it.name, reason: `不做 FAI：${req.quality.faiReason || '立项时选择不做'}` }); continue; }
    const met = !it.condition || (it.condition === 'longLead' ? req.longLead : req.quality[it.condition]);
    if (!met) {
      removed.push({ code: it.code, name: it.name, reason: CONDITION_REASON[it.condition!] });
      continue;
    }
    keep.add(it.code);
  }
  const byCode = new Map(items.map((i) => [i.code, i]));
  const expand = (codes: string[], seen = new Set<string>()): string[] =>
    codes.flatMap((c) => {
      if (keep.has(c)) return [c];
      if (seen.has(c) || !byCode.has(c)) return [];
      seen.add(c);
      return expand(byCode.get(c)!.predecessors, seen);
    });
  const out: GeneratedItem[] = items.filter((i) => keep.has(i.code)).map((i) => {
    const grp = groupOf(i.code);
    return { ...i, predecessors: [...new Set(expand(i.predecessors))], parentCode: grp?.code ?? '', phase: grp?.phase ?? null, purchase: grp?.phase === null };
  });
  const usedGroups = new Set(out.map((i) => i.parentCode));
  const phases = groups.filter((x) => x.phase && usedGroups.has(x.code)).map((x) => x.phase!);
  return { phases, items: out, removed };
}

/** 按类型取得阶段名称（用于类型变更时补阶段） */
export function phasesOf(type: ProjectType, rows: TemplateRow[], req: Requirements) {
  return generatePlan(type, rows, req).phases;
}

/** 新企业默认的可选工作包库 */
export const DEFAULT_LIBRARY: { name: string; durationDays: number; suggestedPhase: string; roleName: string; deliverable: string; types: ProjectType[] }[] = [
  { name: '软件开发与验证', durationDays: 40, suggestedPhase: '产品设计开发', roleName: '技术', deliverable: '软件版本及测试报告', types: ['A'] },
  { name: 'EMC / 环境试验', durationDays: 15, suggestedPhase: '产品设计开发', roleName: '质量', deliverable: '试验报告', types: ['A'] },
  { name: '型式试验', durationDays: 20, suggestedPhase: '设计冻结或 FAI 之后', roleName: '质量', deliverable: '型式试验报告', types: ['A', 'B'] },
  { name: '第三方认证（如 CRCC、防火 EN 45545）', durationDays: 40, suggestedPhase: '量产前', roleName: '质量', deliverable: '认证证书', types: ['A', 'B'] },
  { name: '特殊过程确认（焊接、涂装、粘接等）', durationDays: 10, suggestedPhase: '工艺设计开发 / 技术准备', roleName: '工艺', deliverable: '过程确认记录', types: ['A', 'B', 'C'] },
  { name: '包装方案设计与验证', durationDays: 5, suggestedPhase: '工艺设计开发 / 技术准备', roleName: '物流', deliverable: '包装规范', types: ['A', 'B'] },
  { name: '使用维护手册编写', durationDays: 10, suggestedPhase: '设计冻结 / 技术准备之后', roleName: '技术', deliverable: '手册', types: ['A', 'B'] },
  { name: '客户监造或驻厂检验', durationDays: 20, suggestedPhase: '量产', roleName: '质量', deliverable: '监造记录', types: ['A', 'B'] },
  { name: '备品备件供货', durationDays: 15, suggestedPhase: '量产', roleName: '采购', deliverable: '备件清单', types: ['A', 'B'] },
  { name: '现场安装调试', durationDays: 10, suggestedPhase: '交付', roleName: '售后', deliverable: '调试报告', types: ['A', 'B'] },
  { name: '用户培训', durationDays: 3, suggestedPhase: '交付', roleName: '技术', deliverable: '培训记录', types: ['A', 'B'] },
];

/** 把接口收到的模板整理成规范的结构（字段类型、长度），非法时抛错由调用方转成 400 */
export function normalizeRows(input: unknown): TemplateRow[] {
  if (!Array.isArray(input) || input.length === 0 || input.length > 300) throw new BadRequestException('items must be a non-empty array (max 300)');
  const str = (v: unknown, max: number) => {
    if (typeof v !== 'string' || v.length > max) throw new BadRequestException('invalid text field');
    return v.trim();
  };
  return input.map((r: Record<string, unknown>) => {
    if (r?.group === true) return { code: str(r.code, 20), name: str(r.name, 100), group: true, phase: r.phase === null ? null : str(r.phase, 100) };
    const d = Number(r?.durationDays);
    if (!Number.isInteger(d) || d < 0 || d > 3650) throw new BadRequestException('invalid durationDays');
    if (!Array.isArray(r.predecessors)) throw new BadRequestException('predecessors must be an array');
    const cond = r.condition === undefined ? undefined : (str(r.condition, 30) as Condition);
    if (cond && !['drawingApproval', 'customerWitness', 'rams', 'longLead'].includes(cond)) throw new BadRequestException('invalid condition');
    return {
      code: str(r.code, 20), name: str(r.name, 200), durationDays: d, predecessors: r.predecessors.map((p) => str(p, 20)),
      role: str(r.role ?? '', 30), deliverable: str(r.deliverable ?? '', 200), ...(r.milestone ? { milestone: true } : {}), ...(cond ? { condition: cond } : {}),
    };
  });
}
