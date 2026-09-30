// 改进方案第二步“对比”：三方面红黄绿、挣值、甘特图基准对比、项目评审带数、关口评审汇总、企业阈值设置
import { launch, step, loginAs, openProject, tab } from './lib.mjs';
import { seedTenant, seedProject, call } from './seed.mjs';
const slug = 'cp-' + Date.now().toString(36);
const u = await seedTenant(slug);
const proj = await seedProject(u, {}, false);
const pid = proj.id;
const ph = await call('GET', `/projects/${pid}/phases`, u.pm.access);
const d = await call('POST', `/projects/${pid}/deliverables`, u.pm.access, { name: '设计图纸', kind: 'INTERNAL', phaseId: ph[0].id });
const w1 = await call('POST', `/projects/${pid}/wbs`, u.pm.access, { code: '1', name: '方案设计', durationDays: 10, budget: 1000, phaseId: ph[0].id, deliverableId: d.id });
await call('POST', `/projects/${pid}/wbs`, u.pm.access, { code: '2', name: '详细设计', durationDays: 10, budget: 1000, phaseId: ph[0].id });
await call('POST', `/projects/${pid}/baseline`, u.pm.access);
await call('PATCH', `/projects/${pid}/wbs/${w1.id}`, u.pm.access, { percentComplete: 100, durationDays: 14 });
const acct = await call('POST', `/projects/${pid}/cost/accounts`, u.pm.access, { code: 'A', name: '人工', budget: 5000 });
await call('POST', `/projects/${pid}/cost/entries`, u.pm.access, { accountId: acct.id, workPackageId: w1.id, amount: 1500, entryDate: '2026-03-10', description: '设计人工' });
const { b, p, errors } = await launch();

await loginAs(p, u.pm);
await p.waitForSelector('text=SPI 0.5');
await p.waitForSelector('tr:has-text("评审演示项目") .dot3.RED'); step('首页显示质量、进度、成本三方面状态和 SPI / CPI');
await openProject(p, proj.code);
await p.waitForSelector('app-triangle .card.RED:has-text("进度")');
await p.waitForSelector('app-triangle li:has-text("SPI 0.50 低于 0.90")');
await p.waitForSelector('app-triangle li:has-text("比批准的计划晚 4 个工作日")'); step('项目概览显示三方面状态与原因');

await tab(p, '成本');
await p.waitForSelector('.evm:has-text("计划值 PV")');
await p.waitForSelector('.evm .RED:has-text("0.50")');
await p.waitForSelector('.evm .RED:has-text("0.67")'); step('成本页显示挣值分析（PV、EV、AC、SPI、CPI、EAC）');

await tab(p, 'WBS');
await p.waitForSelector('.tag.late:has-text("比批准计划晚 4 个工作日")');
await p.click('mat-button-toggle:has-text("甘特图")');
await p.waitForSelector('svg[aria-label=甘特图] title:has-text("批准的计划")', { state: 'attached' }); step('WBS 标出延误，甘特图显示批准计划的对比条');

await tab(p, '项目评审');
await p.waitForSelector('app-triangle .card:has-text("成本")');
await p.click('mat-select[formcontrolname=attendees]'); await p.click('mat-option:has-text("李经理")'); await p.keyboard.press('Escape');
await p.click('button:has-text("记录项目评审")');
await p.waitForSelector('.tri-line:has-text("SPI 0.5")'); step('项目评审自动记录三方面状态和 SPI / CPI');

await tab(p, '关口评审');
await p.waitForSelector('text=从第 1 级 WBS 起汇总');
await p.waitForSelector('tr:has-text("1 方案设计")');
await p.waitForSelector('tr:has-text("设计图纸")'); step('关口评审汇总本阶段工作包和交付物');

await loginAs(p, u.admin);
await p.click('a:has-text("企业设置")');
await p.fill('input[formcontrolname=evmAmber]', '0.8');
await p.fill('input[formcontrolname=evmRed]', '0.6');
await p.click('button:has-text("保存")');
await p.waitForSelector('text=已保存'); step('企业管理员调整挣值预警阈值');
await openProject(p, proj.code);
await p.waitForSelector('app-triangle li:has-text("SPI 0.50 低于 0.60")'); step('新阈值生效');

await p.screenshot({ path: `${process.env.SHOT_DIR ?? '/tmp'}/compare.png`, fullPage: true });
console.log('浏览器错误:', errors.length ? errors : '无');
await b.close();
