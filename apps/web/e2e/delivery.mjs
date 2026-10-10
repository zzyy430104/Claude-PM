// 第 3 步：采购计划（物料、批准、下单 / 到货 / 结算、承诺成本）、FAI 记录（遗留项生成行动项）、售后交接（接收人确认、关闭前须完成）
import { launch, step, loginAs, openProject, tab, WEB } from './lib.mjs';
import { seedTenant, call } from './seed.mjs';

const u = await seedTenant('dv-' + Date.now().toString(36));
const code = 'DV-' + Date.now().toString(36).slice(-4).toUpperCase();
const ini = await call('POST', '/initiations', u.pm.access, { name: '地铁转向架牵引拉杆', type: 'B', projectCode: code, customer: '华南城轨', proposedPmId: u.pm.id, startDate: '2026-11-02',
  requirements: { deliveryDate: '2027-09-30', milestones: [], deliverables: [{ name: '牵引拉杆总成', quantity: '1200 件', kind: 'PRODUCT' }], stockLines: [], risks: [], longLead: true,
    quality: { standards: ['ISO/TS 22163'], special: '', acceptance: '出厂检验', fai: true, faiReason: '', customerWitness: true, drawingApproval: false, rams: false }, cost: { cap: 3000000, target: 2850000 } } });
await call('POST', `/initiations/${ini.id}/submit`, u.pm.access);
const pid = (await call('POST', `/initiations/${ini.id}/approve`, u.top.access, {})).projectId;
await call('POST', `/projects/${pid}/members`, u.pm.access, { userId: u.member.id, projectRole: 'MEMBER' });

const { b, p, errors } = await launch();
const answers = { '订单号': 'PO-2026-118', '已到货比例': '40', '结算金额': '296000' };
p.on('dialog', (d) => d.accept(Object.entries(answers).find(([k]) => d.message().includes(k))?.[1] ?? ''));

// 1. 采购计划
await loginAs(p, u.pm);
await openProject(p, code);
await tab(p, '计划'); await p.click('.stabs [role=tab]:text-is("采购计划")');
await p.waitForSelector('[data-plan]:has-text("未批准")');
await p.fill('input[aria-label=新物料名称]', '铸件毛坯 QY-12-C');
await p.fill('input[aria-label=新物料供应商]', '某铸造厂');
await p.fill('input[aria-label=新物料数量]', '1,250 件');
await p.fill('input[aria-label=新物料需求日期]', '2026-12-20');
await p.fill('input[aria-label=新物料金额]', '300000');
await p.check('.add input[type=checkbox]');
await p.click('button:has-text("+ 新增物料")');
await p.waitForSelector('tr[data-item="铸件毛坯 QY-12-C"] td.code:text-is("M-01")');
await p.fill('input[aria-label=新物料名称]', '涂料（客户色卡 RAL 7035）');
await p.fill('input[aria-label=新物料需求日期]', '2020-10-25');
await p.click('button:has-text("+ 新增物料")');
await p.waitForSelector('tr[data-item="涂料（客户色卡 RAL 7035）"] .pill:text-is("逾期未下单")');
await p.waitForSelector('.kpi:has-text("需关注") .v:text-is("1")');
await p.click('button:has-text("批准采购计划")');
await p.waitForSelector('[data-plan]:has-text("采购计划 v1")');
step('采购计划：新增物料（长周期、需求日期、金额），逾期未下单提醒，项目经理批准 v1');

await p.click('tr[data-item="铸件毛坯 QY-12-C"] button:has-text("下单")');
await p.waitForSelector('tr[data-item="铸件毛坯 QY-12-C"]:has-text("订单 PO-2026-118")');
await p.waitForSelector('.kpi:has-text("长周期物料") .v:text-is("1 / 1")');
await p.waitForSelector('.kpi:has-text("到货"):has-text("承诺成本 300,000 元")');
await p.click('tr[data-item="铸件毛坯 QY-12-C"] button:has-text("到货")');
await p.waitForSelector('tr[data-item="铸件毛坯 QY-12-C"] .pill:has-text("部分到货 40%")');
await p.click('tr[data-item="铸件毛坯 QY-12-C"] button:has-text("结算")');
await p.waitForSelector('tr[data-item="铸件毛坯 QY-12-C"] .pill:text-is("已结算")');
await p.waitForSelector('ul.check li.ok:has-text("长周期物料已全部下单")');
step('下单生成承诺成本，部分到货，结算转为实际成本；长周期物料已全部下单（量产准备自动检查）');

const sel = 'tr[data-item="涂料（客户色卡 RAL 7035）"] input[aria-label=需求日期]';
await p.fill(sel, '2027-01-10'); await p.dispatchEvent(sel, 'change');
await p.waitForSelector('[data-plan] .pill:has-text("待重新批准")');
await p.click('button:has-text("重新批准")');
await p.waitForSelector('[data-plan]:has-text("采购计划 v2")');
step('批准后修订计划内容需重新批准（v2）');

await tab(p, '控制'); await p.click('.stabs [role=tab]:text-is("成本")');
await p.waitForSelector('text=296,000');
step('结算金额进入实际成本');

// 2. FAI
await tab(p, '执行'); await p.click('.stabs [role=tab]:text-is("FAI")');
await p.waitForSelector('.banner:has-text("需要 FAI，客户见证")');
await p.fill('input[aria-label=报告编号]', 'FAI-2026-031');
await p.fill('input[aria-label="FAI 日期"]', '2026-11-03');
await p.fill('input[aria-label=产品零件号]', 'QY-12 牵引拉杆总成');
await p.selectOption('select[aria-label="FAI 结论"]', 'CONDITIONAL');
await p.fill('input[aria-label=见证人]', '客户代表 张工');
await p.fill('input[aria-label=存放位置]', '质量部共享盘 /FAI/2026/031');
await p.click('button:has-text("保存 FAI 记录")');
await p.waitForSelector('.error:has-text("遗留项")');
await p.fill('textarea[aria-label=遗留项]', '补充焊缝 UT 报告\n更新控制计划第 5 项');
await p.selectOption('select[aria-label=遗留项责任人]', { label: '王成员' });
await p.click('button:has-text("保存 FAI 记录")');
await p.waitForSelector('tr[data-fai="FAI-2026-031"] .pill:text-is("有条件通过")');
await p.waitForSelector('tr[data-fai="FAI-2026-031"]:has-text("补充焊缝 UT 报告")');
await p.waitForSelector('.banner:has-text("有条件通过")');
await tab(p, '问题与行动');
await p.waitForSelector('td:has-text("更新控制计划第 5 项")');
step('FAI：有条件通过须写遗留项，遗留项生成行动项');

// 3. 售后交接
await tab(p, '收尾');
await p.waitForSelector('app-project-handover [data-status]:text-is("未发起")');
await p.click('app-project-handover button:has-text("发起交接")');
await p.waitForSelector('app-project-handover .error:has-text("交接日期")');
await p.fill('input[aria-label=交接日期]', '2027-01-27'); await p.dispatchEvent('input[aria-label=交接日期]', 'change');
await p.waitForTimeout(400);
await p.selectOption('select[aria-label=接收人]', { label: '赵质量' });
await p.waitForTimeout(400);
await p.check('input[aria-label="移交 质量文件包"]');
await p.waitForTimeout(400);
await p.check('input[aria-label="移交 FAI 报告"]');
await p.waitForTimeout(400);
await p.fill('textarea[aria-label=遗留问题]', '客户反馈 2 件涂层轻微色差，已约定随下批更换'); await p.dispatchEvent('textarea[aria-label=遗留问题]', 'change');
await p.waitForTimeout(400);
await p.click('app-project-handover button:has-text("发起交接")');
await p.waitForSelector('app-project-handover [data-status]:has-text("待接收人确认")');
step('售后交接：填写交接日期、接收人、移交文档、遗留问题，发起交接');

await loginAs(p, u.pqm);
await p.goto(`${WEB}/handovers`);
await p.waitForSelector(`h2:has-text("${code}")`);
await p.click('app-project-handover button:has-text("确认接收")');
await p.waitForSelector('app-project-handover [data-status]:text-is("已交接")');
step('接收人在“售后交接”页确认接收（不是项目成员也可以）');

const real = errors.filter((e) => !e.includes('400 (Bad Request)') && !e.includes('409 (Conflict)'));
if (real.length) throw new Error(real.join('\n'));
await b.close();
console.log('delivery: all passed');
