import { ProjectType, Requirements } from './models';

/** 项目要求按类别摊平成表格行，供展示和版本对比（key 相同的行逐项比较） */
export interface RequirementRow { key: string; cat: '时间' | '交付物' | '质量' | '成本' | '风险'; label: string; value: string }

const yes = (b: boolean) => (b ? '需要' : '不需要');

export function requirementRows(r: Requirements, type: ProjectType): RequirementRow[] {
  const rows: RequirementRow[] = [];
  if (type === 'C') {
    for (const s of r.stockLines) rows.push({ key: `stock:${s.product}`, cat: '时间', label: `入库：${s.product}`, value: `${s.quantity}，${s.date}` });
  } else {
    rows.push({ key: 'deliveryDate', cat: '时间', label: '全部交付', value: r.deliveryDate ?? '—' });
  }
  for (const m of r.milestones) rows.push({ key: `ms:${m.name}`, cat: '时间', label: m.name, value: m.date });
  if (type !== 'C') {
    for (const d of r.deliverables) rows.push({ key: `dl:${d.name}`, cat: '交付物', label: d.name, value: `${d.quantity}${d.kind === 'DOCUMENT' ? '（文件）' : ''}` });
  }
  const q = r.quality;
  rows.push({ key: 'standards', cat: '质量', label: '适用标准', value: q.standards.join('、') || '—' });
  if (q.acceptance) rows.push({ key: 'acceptance', cat: '质量', label: '验收方式', value: q.acceptance });
  if (q.special) rows.push({ key: 'special', cat: '质量', label: '特殊要求', value: q.special });
  rows.push({ key: 'fai', cat: '质量', label: 'FAI 首件鉴定', value: q.fai ? `需要${q.customerWitness ? '，客户见证' : ''}` : `不做（${q.faiReason || '未说明理由'}）` });
  if (type !== 'C') rows.push({ key: 'drawingApproval', cat: '质量', label: '图纸须客户审批', value: yes(q.drawingApproval) });
  rows.push({ key: 'rams', cat: '质量', label: 'RAMS 分析', value: yes(q.rams) });
  rows.push({ key: 'cap', cat: '成本', label: '成本上限', value: money(r.cost.cap) });
  if (r.cost.target) rows.push({ key: 'target', cat: '成本', label: '目标成本', value: money(r.cost.target) });
  rows.push({ key: 'longLead', cat: '时间', label: '长周期物料提前订货', value: yes(r.longLead) });
  for (const k of r.risks) rows.push({ key: `risk:${k.text}`, cat: '风险', label: k.kind === 'RISK' ? '风险' : '机会', value: k.text });
  return rows;
}

export function money(n: number | null | undefined) {
  if (!n) return '—';
  return n >= 10_000 ? `${(n / 10_000).toLocaleString('zh-CN', { maximumFractionDigits: 2 })} 万元` : `${n.toLocaleString('zh-CN')} 元`;
}

/** 与后端 requirementProblems 一致：提交前检查缺少的项（前端提示用，以后端为准） */
export function requirementProblems(
  i: { type: ProjectType; name: string; projectCode: string; customer: string; proposedPmId: string | null; startDate: string | null },
  r: Requirements,
): string[] {
  const p: string[] = [];
  if (!i.name.trim()) p.push('项目名称');
  if (!i.projectCode.trim()) p.push('项目编号');
  if (!i.proposedPmId) p.push('项目经理');
  if (!i.startDate) p.push('计划开始日期');
  if (i.type === 'C') {
    if (!r.stockLines.length) p.push('库存计划行（产品、数量、要求日期）');
  } else {
    if (!i.customer.trim()) p.push('客户');
    if (!r.deliveryDate) p.push('全部交付日期');
    if (!r.deliverables.some((d) => d.kind === 'PRODUCT')) p.push('产品交付物');
  }
  if (!(r.cost.cap > 0)) p.push('成本上限');
  if (i.type !== 'A' && !r.quality.fai && !r.quality.faiReason.trim()) p.push('不做 FAI 的理由');
  return p;
}
