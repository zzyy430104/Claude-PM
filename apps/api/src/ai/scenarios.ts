import type { Scenario } from './ai-config.js';

export interface ChatMessage { role: 'system' | 'user'; content: string }
type Json = Record<string, unknown>;

const BASE = '你是轨道交通装备企业（ISO/TS 22163）的项目管理助手。你只起草，最终由人确认。不要编造原文里没有的信息；拿不准的留空。只输出一个 JSON 对象，不要输出其他文字。';
const str = (v: unknown, max = 2000) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() && Number.isFinite(Number(v.replace(/[,，]/g, ''))) ? Number(v.replace(/[,，]/g, '')) : null);
const date = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v.trim()) ? v.trim() : '');
const arr = (v: unknown) => (Array.isArray(v) ? v : []) as Json[];
const bool = (v: unknown) => (typeof v === 'boolean' ? v : null);

interface Def {
  build(input: Json): ChatMessage[];
  /** 把模型输出整理成固定结构，去掉多余字段 */
  normalize(out: Json): Json;
  /** 测试用：不调用模型时的固定回答 */
  mock(input: Json): Json;
}

export const SCENARIO_DEFS: Record<Scenario, Def> = {
  // 1. 合同 / 技术协议 / 库存计划 → 立项申请的项目要求，每条注明出处
  CONTRACT: {
    build: (i) => [
      { role: 'system', content: `${BASE}
从客户合同、技术协议或库存计划中提取立项申请需要的项目要求。每一项都要给出 source（出处，如“合同第 3.2 条”“技术协议 5.1”“库存计划第 2 行”）。日期用 YYYY-MM-DD，金额换算成元（数字）。
输出 JSON 结构：
{"customer":{"value":"","source":""},"contractNo":{"value":"","source":""},"contractAmount":{"value":null,"source":""},
"deliveryDate":{"value":"","source":""},"milestones":[{"name":"","date":"","source":""}],
"deliverables":[{"name":"","quantity":"","kind":"PRODUCT 或 DOCUMENT","source":""}],
"stockLines":[{"product":"","quantity":"","date":"","source":""}],
"quality":{"standards":{"value":[],"source":""},"acceptance":{"value":"","source":""},"fai":{"value":null,"source":""},"customerWitness":{"value":null,"source":""},"drawingApproval":{"value":null,"source":""},"rams":{"value":null,"source":""},"special":{"value":"","source":""}},
"cost":{"cap":{"value":null,"source":""}},
"risks":[{"text":"","kind":"RISK 或 OPPORTUNITY","source":""}]}
项目类型：${str(i['projectType']) || 'B'}（A 含设计开发；B 基于客户合同；C 按库存计划，C 类把库存计划行放在 stockLines）。` },
      { role: 'user', content: str(i['text'], 200_000) },
    ],
    normalize: (o) => {
      const v = (x: unknown) => { const y = (x ?? {}) as Json; return { value: y['value'] ?? null, source: str(y['source'], 200) }; };
      const q = (o['quality'] ?? {}) as Json;
      return {
        customer: v(o['customer']), contractNo: v(o['contractNo']), contractAmount: { ...v(o['contractAmount']), value: num(((o['contractAmount'] ?? {}) as Json)['value']) },
        deliveryDate: { ...v(o['deliveryDate']), value: date(((o['deliveryDate'] ?? {}) as Json)['value']) },
        milestones: arr(o['milestones']).map((m) => ({ name: str(m['name'], 200), date: date(m['date']), source: str(m['source'], 200) })).filter((m) => m.name && m.date),
        deliverables: arr(o['deliverables']).map((d) => ({ name: str(d['name'], 200), quantity: str(d['quantity'], 100), kind: d['kind'] === 'DOCUMENT' ? 'DOCUMENT' : 'PRODUCT', source: str(d['source'], 200) })).filter((d) => d.name),
        stockLines: arr(o['stockLines']).map((d) => ({ product: str(d['product'], 200), quantity: str(d['quantity'], 100), date: date(d['date']), source: str(d['source'], 200) })).filter((d) => d.product),
        quality: {
          standards: { value: arr((q['standards'] as Json)?.['value']).map((x) => str(x, 100)).filter(Boolean), source: str((q['standards'] as Json)?.['source'], 200) },
          acceptance: v(q['acceptance']), special: v(q['special']),
          fai: { ...v(q['fai']), value: bool((q['fai'] as Json)?.['value']) }, customerWitness: { ...v(q['customerWitness']), value: bool((q['customerWitness'] as Json)?.['value']) },
          drawingApproval: { ...v(q['drawingApproval']), value: bool((q['drawingApproval'] as Json)?.['value']) }, rams: { ...v(q['rams']), value: bool((q['rams'] as Json)?.['value']) },
        },
        cost: { cap: { ...v(((o['cost'] ?? {}) as Json)['cap']), value: num((((o['cost'] ?? {}) as Json)['cap'] as Json)?.['value']) } },
        risks: arr(o['risks']).map((r) => ({ text: str(r['text'], 300), kind: r['kind'] === 'OPPORTUNITY' ? 'OPPORTUNITY' : 'RISK', source: str(r['source'], 200) })).filter((r) => r.text),
      };
    },
    mock: () => ({
      customer: { value: '华南城轨', source: '合同首页' }, contractNo: { value: 'HNCG-2026-0917', source: '合同首页' }, contractAmount: { value: 2680000, source: '合同第 4.1 条' },
      deliveryDate: { value: '2027-01-15', source: '合同第 3.1 条' }, milestones: [{ name: '首批交付', date: '2026-12-10', source: '合同第 3.1 条' }],
      deliverables: [{ name: '牵引拉杆总成 QY-12', quantity: '1200 件', kind: 'PRODUCT', source: '合同附件 1' }], stockLines: [],
      quality: { standards: { value: ['ISO/TS 22163', 'EN 15085-2 CL1'], source: '技术协议 5.1' }, acceptance: { value: '出厂检验 + 客户驻厂验收', source: '技术协议 6.2' }, special: { value: '', source: '' },
        fai: { value: true, source: '合同第 3.2 条' }, customerWitness: { value: true, source: '合同第 3.2 条' }, drawingApproval: { value: true, source: '技术协议 2.3' }, rams: { value: false, source: '' } },
      cost: { cap: { value: null, source: '' } },
      risks: [{ text: '首批交期紧，铸件为长周期物料', kind: 'RISK', source: '合同第 3.1 条' }],
    }),
  },

  // 2. 合同 + 模板 → 计划调整建议
  PLAN: {
    build: (i) => [
      { role: 'system', content: `${BASE}
根据项目要求（以及合同原文，如有）检查下面的 WBS 草稿，给出调整建议：缺少的工作包（ADD）、工期明显不合理的（DURATION）、其他需要注意的（NOTE）。每条写明理由和出处。不要重复已有的工作包。
输出 JSON：{"suggestions":[{"action":"ADD|DURATION|NOTE","code":"相关工作包编号（DURATION 必填）","name":"工作包名称（ADD 必填）","durationDays":数字或 null,"parentCode":"建议放在哪个父级编号下（ADD 用）","reason":"","source":""}]}` },
      { role: 'user', content: JSON.stringify({ 项目要求: i['requirements'], 合同原文: str(i['text'], 100_000) || undefined, WBS: i['wbs'] }) },
    ],
    normalize: (o) => ({
      suggestions: arr(o['suggestions']).map((s) => ({
        action: ['ADD', 'DURATION', 'NOTE'].includes(String(s['action'])) ? String(s['action']) : 'NOTE', code: str(s['code'], 30), name: str(s['name'], 200),
        durationDays: num(s['durationDays']), parentCode: str(s['parentCode'], 30), reason: str(s['reason'], 500), source: str(s['source'], 200),
      })).filter((s) => s.reason || s.name).slice(0, 30),
    }),
    mock: (i) => {
      const wbs = arr(i['wbs']);
      const first = wbs.find((w) => !w['isMilestone']) ?? wbs[0];
      return { suggestions: [
        { action: 'ADD', name: '客户驻厂见证 FAI 准备', durationDays: 3, parentCode: String(wbs[0]?.['code'] ?? '').split('.')[0], reason: '项目要求 FAI 由客户见证，需要提前约定时间和准备见证资料', source: '项目要求 · 质量' },
        ...(first ? [{ action: 'DURATION', code: first['code'], name: first['name'], durationDays: Number(first['durationDays'] ?? 1) + 2, reason: '首批交期提前，需要预留缓冲', source: '项目要求 · 时间' }] : []),
        { action: 'NOTE', reason: '长周期物料应在技术准备阶段开始前下单', source: '项目要求 · 时间' },
      ] };
    },
  },

  // 3. 一句话登记 → 不符合项 / 问题 / 行动项 / 风险 / 变更
  QUICK: {
    build: (i) => [
      { role: 'system', content: `${BASE}
把用户的一句话整理成一条待登记记录。判断类型：NONCONFORMITY（产品或过程不符合要求）、ISSUE（已发生、需要解决的问题）、ACTION（要做的一件事）、RISK（可能发生的不利事件）、OPPORTUNITY（可能的有利机会）、CHANGE（要改变范围、交期、预算、技术方案）。
项目成员：${(i['members'] as string[] | undefined)?.join('、') ?? ''}。今天是 ${str(i['today'])}。
输出 JSON：{"type":"","title":"不超过 40 字","description":"","severity":"MINOR|MAJOR|CRITICAL（不符合项用）","source":"INSPECTION|AUDIT|CUSTOMER|SUPPLIER|OTHER（不符合项来源）","owner":"项目成员姓名或空","dueDate":"YYYY-MM-DD 或空","probability":1-${Number(i['scale'] ?? 3)},"impact":1-${Number(i['scale'] ?? 3)},"changeType":"SCOPE|SCHEDULE|BUDGET|TECHNICAL|DELIVERY_DATE|OTHER（变更用）","reason":"变更原因"}` },
      { role: 'user', content: str(i['text'], 2000) },
    ],
    normalize: (o) => ({
      type: ['NONCONFORMITY', 'ISSUE', 'ACTION', 'RISK', 'OPPORTUNITY', 'CHANGE'].includes(String(o['type'])) ? String(o['type']) : 'ISSUE',
      title: str(o['title'], 200), description: str(o['description'], 2000),
      severity: ['MINOR', 'MAJOR', 'CRITICAL'].includes(String(o['severity'])) ? String(o['severity']) : 'MINOR',
      source: ['INSPECTION', 'AUDIT', 'CUSTOMER', 'SUPPLIER', 'OTHER'].includes(String(o['source'])) ? String(o['source']) : 'OTHER',
      owner: str(o['owner'], 50), dueDate: date(o['dueDate']), probability: num(o['probability']), impact: num(o['impact']),
      changeType: str(o['changeType'], 30), reason: str(o['reason'], 1000),
    }),
    mock: (i) => {
      const t = str(i['text']);
      if (/不合格|超差|缺陷|色差|裂纹/.test(t)) return { type: 'NONCONFORMITY', title: t.slice(0, 40), description: t, severity: 'MAJOR', source: /客户/.test(t) ? 'CUSTOMER' : 'INSPECTION', owner: '', dueDate: '' };
      if (/可能|担心|风险/.test(t)) return { type: 'RISK', title: t.slice(0, 40), description: t, probability: 2, impact: 3 };
      if (/变更|改为|提前|推迟/.test(t)) return { type: 'CHANGE', title: t.slice(0, 40), description: t, changeType: 'SCHEDULE', reason: t };
      return { type: 'ACTION', title: t.slice(0, 40), description: t, owner: (i['members'] as string[] | undefined)?.[0] ?? '', dueDate: '' };
    },
  },

  // 4. 会议记录 → 纪要和行动项
  MINUTES: {
    build: (i) => [
      { role: 'system', content: `${BASE}
把会议记录或录音转写文字整理成纪要：讨论要点（分条）、决定事项（分条）、行动项（内容、责任人、期限）。责任人只能从参会人里选，期限用 YYYY-MM-DD（会议日期 ${str(i['date'])}，“下周五”等按此换算）。
参会人：${(i['attendees'] as string[] | undefined)?.join('、') ?? ''}。议程：${(i['agenda'] as string[] | undefined)?.join('；') ?? ''}。
输出 JSON：{"points":["..."],"decisions":["..."],"actions":[{"title":"","owner":"","dueDate":""}]}` },
      { role: 'user', content: str(i['notes'], 60_000) },
    ],
    normalize: (o) => ({
      points: arr(o['points']).map((x) => str(x, 500)).filter(Boolean),
      decisions: arr(o['decisions']).map((x) => str(x, 500)).filter(Boolean),
      actions: arr(o['actions']).map((a) => ({ title: str(a['title'], 300), owner: str(a['owner'], 50), dueDate: date(a['dueDate']) })).filter((a) => a.title).slice(0, 30),
    }),
    mock: (i) => ({
      points: ['PFMEA 初稿完成 80%', '铸件主供应商产能紧张'],
      decisions: ['开发第二铸件供应商'],
      actions: [{ title: '提交 PFMEA 初稿供质量评审', owner: (i['attendees'] as string[] | undefined)?.[0] ?? '', dueDate: '' }],
    }),
  },

  // 5. 已录入数据 → 原因分析、应对措施、变更影响初稿
  ANALYSIS: {
    build: (i) => {
      const kind = str(i['kind']);
      const shape = kind === 'NONCONFORMITY'
        ? '{"containment":"遏制措施","rootCause":"根本原因（可用 5Why，写清因果链）","correctiveAction":"纠正措施","preventiveAction":"预防措施"}'
        : kind === 'RISK'
          ? '{"cause":"原因","effect":"后果","measures":["应对措施"],"costBenefitAnalysis":"成本收益分析"}'
          : '{"impactAnalysis":"对范围、进度、成本、质量和已交付产品的影响分析"}';
      return [
        { role: 'system', content: `${BASE}\n根据已录入的${kind === 'NONCONFORMITY' ? '不符合项' : kind === 'RISK' ? '风险' : '变更申请'}信息起草分析。输出 JSON：${shape}` },
        { role: 'user', content: JSON.stringify(i['record']) },
      ];
    },
    normalize: (o) => ({
      containment: str(o['containment']), rootCause: str(o['rootCause']), correctiveAction: str(o['correctiveAction']), preventiveAction: str(o['preventiveAction']),
      cause: str(o['cause']), effect: str(o['effect']), measures: arr(o['measures']).map((x) => str(x, 300)).filter(Boolean), costBenefitAnalysis: str(o['costBenefitAnalysis']),
      impactAnalysis: str(o['impactAnalysis'], 5000),
    }),
    mock: (i) => (str(i['kind']) === 'NONCONFORMITY'
      ? { containment: '隔离同批次产品并全检', rootCause: '焊接电流参数未按工艺卡设定 → 首件检验未覆盖该参数', correctiveAction: '按工艺卡重设参数并返工', preventiveAction: '首件检验表增加焊接参数核对项' }
      : str(i['kind']) === 'RISK'
        ? { cause: '主供应商同时承接其他订单', effect: '首件物料晚到，FAI 推迟', measures: ['开发第二供应商', '提前锁定产能'], costBenefitAnalysis: '第二供应商单价高 3%，可避免约 10 天延误' }
        : { impactAnalysis: '进度：首批交付提前 10 天，关键路径需压缩；成本：加班约 2 万元；质量：FAI 时间压缩，需客户确认见证日期' }),
  },

  // 6. 系统数据 → 周报和项目总结初稿
  REPORT: {
    build: (i) => [
      { role: 'system', content: str(i['kind']) === 'SUMMARY'
        ? `${BASE}\n根据项目数据起草项目总结：项目要求达成情况（时间、质量、成本）、主要经验和教训。输出 JSON：{"summary":"总结正文（分段）","lessons":[{"kind":"LESSON 或 GOOD_PRACTICE","title":"","description":"发生了什么","recommendation":"今后怎么做"}]}`
        : `${BASE}\n根据项目数据起草本周项目周报，面向管理层和客户，简洁、具体、有数字。输出 JSON：{"summary":"总体情况（2–3 句）","highlights":["本周完成"],"issues":["问题与风险"],"next":["下周计划"]}` },
      { role: 'user', content: JSON.stringify(i['data']).slice(0, 100_000) },
    ],
    normalize: (o) => ({
      summary: str(o['summary'], 8000), highlights: arr(o['highlights']).map((x) => str(x, 300)).filter(Boolean), issues: arr(o['issues']).map((x) => str(x, 300)).filter(Boolean),
      next: arr(o['next']).map((x) => str(x, 300)).filter(Boolean),
      lessons: arr(o['lessons']).map((l) => ({ kind: l['kind'] === 'GOOD_PRACTICE' ? 'GOOD_PRACTICE' : 'LESSON', title: str(l['title'], 200), description: str(l['description'], 2000), recommendation: str(l['recommendation'], 2000) })).filter((l) => l.title),
    }),
    mock: (i) => (str(i['kind']) === 'SUMMARY'
      ? { summary: '项目按期交付，质量和成本均达成项目要求。', lessons: [{ kind: 'GOOD_PRACTICE', title: '长周期铸件提前下单', description: '技术准备阶段提前下单，抵消了交期提前的影响', recommendation: '在模板中把长周期物料下单放到技术准备开始前' }] }
      : { summary: '本周进度正常，成本在预算内。', highlights: ['完成 PFMEA 初稿'], issues: ['铸件供应商产能紧张'], next: ['工装验收'] }),
  },
};
