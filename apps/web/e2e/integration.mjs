// 改进方案第一步“整合”：需求、工作包四要素、计划批准与版本、按变更增删范围、草稿编辑、组织图、成本记到工作包
import { launch, step, loginAs, openProject, tab, pick } from './lib.mjs';
import { seedTenant, seedProject, call } from './seed.mjs';
const slug = 'in-' + Date.now().toString(36);
const u = await seedTenant(slug);
const proj = await seedProject(u, {}, false);
const pid = proj.id;
const phases = await call('GET', `/projects/${pid}/phases`, u.pm.access);
await call('POST', `/projects/${pid}/deliverables`, u.pm.access, { name: '型式试验报告', kind: 'CUSTOMER_APPROVAL' });
await call('POST', `/projects/${pid}/cost/accounts`, u.pm.access, { code: 'CA1', name: '外购件', budget: 200000 });
const { b, p, errors } = await launch();

await loginAs(p, u.pm); await openProject(p, proj.code);

// 需求
await tab(p, '需求');
await p.fill('input[formcontrolname=code]', 'R-001');
await p.fill('input[formcontrolname=title]', '最高运行速度 160 km/h');
await p.fill('input[formcontrolname=source]', '技术规格书 3.1');
await p.fill('input[formcontrolname=verificationMethod]', '型式试验');
await p.click('button:has-text("添加需求")');
await p.waitForSelector('td:has-text("最高运行速度 160 km/h")');
await p.waitForSelector('.stat.red:has-text("未关联交付物")'); step('登记需求，未关联交付物时有提示');
await p.click('tr:has-text("R-001") mat-select >> nth=0');
await p.click('mat-option:has-text("型式试验报告")');
await p.waitForSelector('.stat:not(.red):has-text("未关联交付物")'); step('需求关联交付物');

// 工作包四要素
await tab(p, 'WBS');
await p.click('button:has-text("+ 新增工作包")');
await p.fill('app-modal input[formcontrolname=code]', '1');
await p.fill('app-modal input[formcontrolname=name]', '构架采购');
await p.fill('app-modal input[formcontrolname=durationDays]', '30');
await pick(p, 'app-modal select[formcontrolname=phaseId]', phases[1].name);
await pick(p, 'app-modal select[formcontrolname=deliverableId]', '型式试验报告');
await pick(p, 'app-modal select[formcontrolname=costAccountId]', 'CA1');
await p.fill('app-modal input[formcontrolname=budget]', '80000');
await p.fill('app-modal input[formcontrolname=resourceDays]', '12');
await p.fill('app-modal input[formcontrolname=externalProvider]', '某铸造厂');
await p.check('app-modal input[formcontrolname=longLead]');
await p.click('app-modal button:has-text("添加工作包")');
await p.waitForSelector('.tag:has-text("外部供方：某铸造厂")');
await p.waitForSelector('.tag:has-text("长周期")');
await p.waitForSelector(`.tag:has-text("${phases[1].name}")`); step('新增工作包：阶段、交付物、成本科目、预算、资源、外部供方、长周期');
await p.click('tr:has-text("构架采购") button:has-text("编辑")');
await pick(p, 'app-modal select[formcontrolname=phaseId]', phases[0].name);
await p.click('app-modal button:has-text("保存修改")');
await p.waitForSelector(`.tag:has-text("${phases[0].name}")`); step('编辑工作包，改归属阶段');

// 组织图
await tab(p, '概览');
await p.click('tr:has-text("王成员") mat-select');
await p.click('mat-option:has-text("李经理")');
await p.click('button:has-text("保存计划")');
await p.waitForSelector('text=已保存');
await p.waitForSelector('.org li:has-text("李经理") ul li:has-text("王成员")'); step('组织图按汇报关系显示');

// 批准计划
await p.click('button:has-text("批准计划并启动项目")');
await p.click('button:has-text("确认批准")');
await p.waitForSelector('td:has-text("第 1 版")'); step('批准计划，保存第 1 版');

// 草稿编辑与范围变更
await tab(p, '变更控制');
await p.fill('input[formcontrolname=title]', '增加构架探伤');
await p.fill('textarea[formcontrolname=description]', '增加一个工作包');
await p.fill('textarea[formcontrolname=reason]', '客户要求');
await p.click('button:has-text("保存为草稿")');
await p.waitForSelector('h3:has-text("增加构架探伤")');
await p.click('.cr:has-text("增加构架探伤") button:has-text("编辑")');
await p.waitForSelector('h2:has-text("编辑草稿")');
await p.fill('textarea[formcontrolname=impactAnalysis]', '增加工期 5 天，费用可控');
await p.click('button:has-text("保存草稿")');
await p.waitForSelector('text=影响分析：增加工期 5 天，费用可控'); step('编辑变更草稿');
const crs = await call('GET', `/projects/${pid}/changes`, u.pm.access);
const cr = crs.find((c) => c.title === '增加构架探伤');
await call('POST', `/projects/${pid}/changes/${cr.id}/submit`, u.pm.access);
await call('POST', `/projects/${pid}/changes/${cr.id}/approve`, u.top.access, { note: '同意' });

await tab(p, '概览'); await tab(p, 'WBS');
await p.click('button:has-text("+ 新增工作包")');
await p.fill('app-modal input[formcontrolname=code]', '2');
await p.fill('app-modal input[formcontrolname=name]', '构架探伤');
await p.click('app-modal button:has-text("添加工作包")');
await p.waitForSelector('app-modal .error:has-text("需要引用一项已批准的变更申请")'); step('未引用变更时新增被拦截（弹窗内提示）');
await pick(p, 'app-modal select[aria-label=依据的范围变更]', '增加构架探伤');
await p.click('app-modal button:has-text("添加工作包")');
await p.waitForSelector('td:has-text("构架探伤")'); step('引用已批准的范围变更后新增工作包');

// 成本记到工作包
await tab(p, '成本');
await p.click('mat-select[formcontrolname=accountId]'); await p.click('mat-option:has-text("CA1")');
await p.click('mat-select[formcontrolname=workPackageId]'); await p.click('mat-option:has-text("构架采购")');
await p.fill('input[formcontrolname=amount]', '20000');
await p.fill('input[formcontrolname=description]', '预付款');
await p.click('button:has-text("记录成本")');
await p.waitForSelector('tr:has-text("预付款"):has-text("1 构架采购")'); step('成本记录到工作包');

await p.screenshot({ path: `${process.env.SHOT_DIR ?? '/tmp'}/integration.png`, fullPage: true });
console.log('浏览器错误:', errors.length ? errors : '无');
await b.close();
