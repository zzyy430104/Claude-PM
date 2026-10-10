// 第三步 5A：成本策划（工作包预算、科目、检查）、工作包详情（成本 / 质量）、检验记录、工作包超支、企业设置与检验项库
import { launch, step, loginAs, openProject, tab, WEB } from './lib.mjs';
import { seedTenant, call } from './seed.mjs';

const u = await seedTenant('cq-' + Date.now().toString(36));
const code = 'CQ-' + Date.now().toString(36).slice(-4).toUpperCase();
const ini = await call('POST', '/initiations', u.pm.access, { name: '地铁转向架牵引拉杆', type: 'B', projectCode: code, customer: '华南城轨', proposedPmId: u.pm.id, startDate: '2026-11-02',
  requirements: { deliveryDate: '2027-09-30', milestones: [], deliverables: [{ name: '牵引拉杆总成', quantity: '1200 件', kind: 'PRODUCT' }], stockLines: [], risks: [{ kind: 'RISK', text: '铸件供应商产能' }], longLead: false,
    quality: { standards: ['ISO/TS 22163'], special: '', acceptance: '出厂检验', fai: true, faiReason: '', customerWitness: false, drawingApproval: false, rams: false }, cost: { cap: 3000000, target: 2850000 } } });
await call('POST', `/initiations/${ini.id}/submit`, u.pm.access);
const pid = (await call('POST', `/initiations/${ini.id}/approve`, u.top.access, {})).projectId;
const { b, p, errors } = await launch();
p.on('dialog', (d) => d.accept());

await loginAs(p, u.pm);
await openProject(p, code);
await tab(p, '计划'); await p.click('.stabs [role=tab]:text-is("成本策划")');
await p.waitForSelector('app-project-cost-plan .stat:has-text("目标成本")');
await p.waitForSelector('app-project-cost-plan td:has-text("01 人工")');
if (await p.locator('app-project-cost-plan .checks li.no').count()) throw new Error('初始成本检查应全部通过');
step('成本策划：上限 / 目标成本 / 科目 / 工作包四个数，默认科目，人工按费率自动算，检查通过');

await p.click('app-project-cost-plan button.link:has-text("工装、检具准备")');
await p.waitForSelector('app-wp-drawer [role=tab][aria-selected=true]:text-is("成本")');
await p.click('app-wp-drawer button:has-text("+ 材料 / 外协 / 其他费用")');
const line = p.locator('app-wp-drawer tbody tr').nth(1);
await line.locator('select').selectOption({ label: '工装' });
await line.locator('input[aria-label=说明]').fill('焊接夹具 2 套'); await line.locator('input[aria-label=说明]').dispatchEvent('change');
await line.locator('input[aria-label=金额]').fill('150000'); await line.locator('input[aria-label=金额]').dispatchEvent('change');
await Promise.all([p.waitForResponse((r) => r.url().includes('/cost-plan') && r.request().method() === 'GET'), p.click('app-wp-drawer button:has-text("保存预算")')]);
await p.waitForSelector('app-wp-drawer td.num b:text-is("168,000")');
await p.fill('app-wp-drawer input[aria-label=费率]', '1500'); await p.dispatchEvent('app-wp-drawer input[aria-label=费率]', 'change');
await p.click('app-wp-drawer button:has-text("保存预算")');
await p.waitForSelector('app-wp-drawer .error:has-text("原因")', { timeout: 5000 }).catch(async (e) => { await p.screenshot({ path: '/tmp/claude-0/-home-user-angular-auth-qms/c63e90f0-f2b6-5f89-875e-c602cf485a06/scratchpad/cq.png' }); throw e; });
await p.fill('app-wp-drawer input[aria-label=改费率原因]', '外聘工艺专家'); await p.dispatchEvent('app-wp-drawer input[aria-label=改费率原因]', 'change');
await p.click('app-wp-drawer button:has-text("保存预算")');
await p.waitForSelector('app-wp-drawer td.num b:text-is("172,500")');
await p.click('app-wp-drawer button[aria-label=关闭]');
await p.waitForSelector('app-project-cost-plan .checks li.no:has-text("工装")');
await p.click('button:has-text("按工作包合计设定科目预算")');
await p.waitForFunction(() => document.querySelectorAll('app-project-cost-plan .checks li.no').length === 0);
step('工作包详情 · 成本：加工装费用、改费率须写原因；科目不够时检查不通过，按工作包合计设定科目预算后通过');

// WBS：点工作包打开详情 · 质量
await p.click('.stabs [role=tab]:text-is("WBS 与进度")');
await p.click('button.wpname:has-text("工装、检具准备")');
await p.click('app-wp-drawer [role=tab]:text-is("质量")');
await p.waitForSelector('app-wp-drawer .qi');
await p.selectOption('app-wp-drawer select[aria-label=从检验项库添加]', { label: '尺寸检验（产品）' });
await p.waitForSelector('app-wp-drawer .qi[data-name="尺寸检验"]');
const qi = p.locator('app-wp-drawer .qi[data-name="尺寸检验"]');
await qi.locator('select[aria-label=结果]').selectOption('FAIL');
await qi.locator('input[aria-label=记录编号]').fill('QR-101');
await qi.locator('button:has-text("记录")').click();
await qi.locator('button:has-text("开不符合项")').click();
await p.waitForSelector('app-wp-drawer .pill:text-is("已开不符合项")');
await p.click('app-wp-drawer button[aria-label=关闭]');
await p.waitForSelector('button.tag:has-text("检 1/2")');
step('WBS：点工作包打开详情 · 质量；从检验项库加入检验项，记录不合格并开不符合项；WBS 上显示“检 1/2”');

await tab(p, '质量'); await p.click('.stabs [role=tab]:text-is("检验记录")');
await p.waitForSelector('app-project-quality-plan tr:has-text("尺寸检验") .pill:text-is("不合格")');
await p.waitForSelector('app-project-quality-plan .stat.red:has-text("不合格")');
await p.click('.stabs [role=tab]:text-is("不符合项")');
await p.waitForSelector('text=尺寸检验 不合格');
step('质量 → 检验记录：不合格可见；不符合项里有自动生成的记录');

// 工作包超支
const plan = await call('GET', `/projects/${pid}/cost-plan`, u.pm.access);
const w23 = plan.workPackages.find((w) => w.code === '2.3');
const labor = plan.accounts.find((a) => a.isLabor);
await call('PATCH', `/projects/${pid}/wbs/${w23.id}`, u.pm.access, { percentComplete: 100 });
await call('POST', `/projects/${pid}/cost/entries`, u.pm.access, { accountId: labor.id, workPackageId: w23.id, amount: 6600, entryDate: '2026-11-20', description: '工艺工时' });
await tab(p, '控制'); await p.click('.stabs [role=tab]:text-is("成本")');
await p.waitForSelector('app-project-cost-control tr:has-text("PFMEA") .pill:has-text("超 10%")');
await p.waitForSelector('app-project-cost-control .banner:has-text("项目总预算正常")');
await p.fill('app-project-cost-control input[aria-label=承诺金额]', '2000');
await p.fill('app-project-cost-control input[aria-label=承诺说明]', 'PO-0012');
await p.click('app-project-cost-control button:has-text("登记")');
await p.waitForSelector('app-project-cost-control td:text-is("PO-0012")');
step('控制 → 成本：工作包超支清单、总预算状态、登记承诺成本');

// 企业设置与检验项库
await loginAs(p, u.admin);
await p.click('mat-sidenav a:text-is("企业设置")');
await p.fill('app-cost-quality-settings input[aria-label=项目经理费率]', '1800');
await p.dispatchEvent('app-cost-quality-settings input[aria-label=项目经理费率]', 'change');
await p.waitForSelector('app-cost-quality-settings .ok');
await p.fill('app-cost-quality-settings input[aria-label=新类别]', '包装');
await p.click('app-cost-quality-settings button:has-text("添加类别")');
await p.waitForSelector('app-cost-quality-settings .chip:has-text("包装")');
await p.click('mat-sidenav a:text-is("模板")');
await p.click('.stabs [role=tab]:text-is("检验项库")');
await p.fill('app-inspection-library input[aria-label=检验项名称]', '包装防护检查');
await p.selectOption('app-inspection-library select >> nth=0', '包装');
await p.click('app-inspection-library button:has-text("添加到库")');
await p.waitForSelector('app-inspection-library input[aria-label="名称 包装防护检查"]', { state: 'attached' });
step('企业设置：改职能角色费率、增加检验类别；模板 → 检验项库新增');

// 改费率不写原因时的 400 是预期的
const unexpected = errors.filter((e) => !/status of 400/.test(e));
if (unexpected.length) throw new Error(unexpected.join('\n'));
await b.close();
console.log('costquality 全部通过');
