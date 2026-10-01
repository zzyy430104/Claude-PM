// 改造第二步：立项申请 → 审批生成项目和计划草稿 → 按角色指定责任人 → 计划对照项目要求检查、提交、批准 → 项目要求变更 → 模板与审批角色
import { launch, step, loginAs, openProject, tab, WEB } from './lib.mjs';
import { seedTenant, call } from './seed.mjs';

const u = await seedTenant('in-' + Date.now().toString(36));
await call('PATCH', '/tenant-settings', u.admin.access, { allowDirectProject: false });
const code = 'ZY-' + Date.now().toString(36).slice(-4).toUpperCase();
const { b, p, errors } = await launch();
p.on('dialog', (d) => d.accept(d.type() === 'prompt' ? '同意' : undefined));

// 项目经理默认是立项申请人；没开“小项目免立项”时项目页没有直接建项目的表单
await loginAs(p, u.pm);
await p.waitForSelector('mat-sidenav a:text-is("立项管理")');
await p.click('mat-sidenav a:text-is("项目")');
await p.waitForSelector('a:has-text("+ 新建立项申请")');
if (await p.locator('input[formcontrolname=code]').count()) throw new Error('未开免立项时不应出现直接建项目的表单');
step('未开“小项目免立项”：项目页只能新建立项申请');

await p.click('a:has-text("+ 新建立项申请")');
await p.fill('input[aria-label=项目名称]', '动车组座椅骨架');
await p.dispatchEvent('input[aria-label=项目名称]', 'change');
await p.click('.typecards button:has-text("B 类")');
await p.fill('input[aria-label=项目编号]', code); await p.dispatchEvent('input[aria-label=项目编号]', 'change');
await p.fill('input[aria-label=计划开始日期]', '2026-11-02'); await p.dispatchEvent('input[aria-label=计划开始日期]', 'change');
await p.fill('input[aria-label=客户]', '华南城轨'); await p.dispatchEvent('input[aria-label=客户]', 'change');
await p.fill('input[aria-label=全部交付日期]', '2028-06-30'); await p.dispatchEvent('input[aria-label=全部交付日期]', 'change');
await p.click('button:has-text("+ 添加交付物")');
const dl = p.locator('app-requirements-editor .listed .line').filter({ has: p.locator('select') }).first();
await dl.locator('input').nth(0).fill('座椅骨架总成'); await dl.locator('input').nth(0).dispatchEvent('change');
await dl.locator('input').nth(1).fill('1200 套'); await dl.locator('input').nth(1).dispatchEvent('change');
await p.fill('input[aria-label=成本上限]', '3000000'); await p.dispatchEvent('input[aria-label=成本上限]', 'change');
await p.click('button:has-text("+ 添加风险或机会")');
const rk = p.locator('app-requirements-editor .listed .line:has(option[value=OPPORTUNITY])').first();
await rk.locator('input').fill('焊接产能紧张'); await rk.locator('input').dispatchEvent('change');
const bad = await p.locator('.checks li.no').allInnerTexts();
if (bad.length) throw new Error('提交前检查还有未通过项：' + bad.join('、'));
step('填写立项申请：B 类、客户、交期、交付物、成本上限、初步风险；提交前检查全部通过');
await p.click('button:has-text("提交审批")');
await p.waitForURL((x) => x.pathname === '/initiations');
await p.waitForSelector('tr:has-text("动车组座椅骨架") .pill:text-is("待审批")');
step('提交后进入待审批');

// 最高管理层默认是立项批准人
await loginAs(p, u.top);
await p.click('mat-sidenav a:text-is("立项管理")');
await p.click('a:text-is("动车组座椅骨架")');
await p.click('button:has-text("批准立项")');
await p.waitForSelector(`.meta:has-text("编号 ${code}")`);
await p.waitForSelector('.meta .pill:text-is("B 类")');
step('批准立项：生成项目并打开');
await tab(p, '阶段');
const phases = await p.locator('app-project-phases .phase').count();
if (phases !== 6) throw new Error('B 类应生成 6 个阶段，实际 ' + phases);
await tab(p, '需求');
await p.waitForSelector('h2:has-text("项目要求 v1")');
await p.waitForSelector('app-requirements-view td:has-text("座椅骨架总成")');
step('项目要求 v1 来自立项，B 类 6 个阶段');

// 项目经理：按角色指定责任人，计划对照项目要求检查后提交
await loginAs(p, u.pm);
await openProject(p, code);
await tab(p, '计划批准');
await p.waitForSelector('.checks li.no:has-text("责任人")');
if (!(await p.locator('button:has-text("提交计划批准")').isDisabled())) throw new Error('检查未通过时不能提交');
step('计划批准：责任人未指定时检查不通过，不能提交');
await tab(p, 'WBS');
await p.waitForSelector('.banner:has-text("按客户交期 2028-06-30 倒排")');
await p.click('button:has-text("按角色指定责任人")');
await p.waitForSelector('.pcard:has-text("按职能角色指定责任人") select');
for (const sel of await p.locator('.pcard:has-text("按职能角色指定责任人") select').all()) {
  await sel.selectOption({ index: 1 });
}
await p.click('.pcard:has-text("按职能角色指定责任人") button:has-text("确定")');
await p.waitForSelector('.pcard:has-text("按职能角色指定责任人")', { state: 'detached' });
step('WBS：交期倒排提示；按职能角色一次指定责任人');
await p.selectOption('select[aria-label=从可选工作包库添加]', { label: '型式试验（20 天）' });
await p.click('.tools button:has-text("添加")');
await p.waitForSelector('td:has-text("型式试验")');
step('从可选工作包库添加“型式试验”');
await p.reload(); await p.waitForSelector('.gtabs');
await tab(p, '计划批准');
// 新加的工作包还没有责任人
await p.waitForSelector('.checks li.no:has-text("责任人")');
await tab(p, 'WBS');
await p.click('button:has-text("按角色指定责任人")');
await p.waitForSelector('.pcard:has-text("按职能角色指定责任人") select');
for (const sel of await p.locator('.pcard:has-text("按职能角色指定责任人") select').all()) await sel.selectOption({ index: 1 });
await p.click('.pcard:has-text("按职能角色指定责任人") button:has-text("确定")');
await p.waitForSelector('.pcard:has-text("按职能角色指定责任人")', { state: 'detached' });
// 加了可选库的工作包后人工合计超过人工科目预算：在成本策划里按工作包合计重设科目预算
await tab(p, '成本策划');
await p.waitForSelector('app-project-cost-plan .checks li.no:has-text("人工")');
await p.click('button:has-text("按工作包合计设定科目预算")');
await p.waitForFunction(() => document.querySelectorAll('app-project-cost-plan .checks li.no').length === 0);
await tab(p, '计划批准');
await p.waitForFunction(() => document.querySelectorAll('.checks li.no').length === 0, null, { timeout: 5000 }).catch(async () => {
  throw new Error('仍有未通过的检查：' + (await p.locator('.checks li.no').allInnerTexts()).join('；'));
});
await p.click('button:has-text("提交计划批准")');
await p.waitForSelector('text=等待批准');
step('检查全部通过后提交计划批准');

await loginAs(p, u.top);
await openProject(p, code);
await tab(p, '计划批准');
await p.click('button:has-text("批准计划")');
await p.waitForSelector('.banner:has-text("计划已批准")');
await p.waitForSelector('td:text-is("计划 v1")');
await p.waitForSelector('.meta .pill:text-is("执行中")');
step('管理层批准计划：保存计划 v1，项目进入执行');

// 项目要求变更：项目经理发起，立项批准人批准；计划待重新批准
await loginAs(p, u.pm);
await openProject(p, code);
await tab(p, '需求');
await p.click('button:has-text("发起项目要求变更")');
await p.fill('input[aria-label=变更原因]', '客户补充协议：交期提前'); await p.dispatchEvent('input[aria-label=变更原因]', 'change');
await p.fill('input[aria-label=全部交付日期]', '2028-03-31'); await p.dispatchEvent('input[aria-label=全部交付日期]', 'change');
await p.click('.pcard:has-text("项目要求变更") button:has-text("提交审批")');
await p.waitForSelector('td .pill:text-is("待审批")');
step('项目经理发起项目要求变更并提交');

await loginAs(p, u.top);
await p.click('mat-sidenav a:text-is("立项管理")');
await p.click('.stabs [role=tab]:has-text("项目要求变更")');
await p.click('tr:has-text("客户补充协议") button:has-text("查看")');
await p.waitForSelector('tr.changed:has-text("2028-03-31")');
await p.click('button:has-text("批准变更")');
await p.waitForSelector('tr:has-text("客户补充协议") .pill:text-is("已批准")');
step('立项批准人对比变更前后并批准');
await openProject(p, code);
await p.waitForSelector('.meta .pill:text-is("计划待重新批准")');
await tab(p, '需求');
await p.waitForSelector('h2:has-text("项目要求 v2")');
await p.waitForSelector('tr.changed:has-text("2028-03-31")');
step('项目要求 v2 生效，与 v1 对比；计划待重新批准');

// 管理员：模板、可选库、立项与审批角色、立项设置
await loginAs(p, u.admin);
await p.click('mat-sidenav a:text-is("模板")');
await p.waitForSelector('app-plan-type-templates td:has-text("设计输入评审"), app-plan-type-templates tr.grp');
await p.click('app-plan-type-templates .seg button:has-text("C 类")');
await p.waitForSelector('app-plan-type-templates h3:has-text("C 类")');
await p.click('.stabs [role=tab]:text-is("可选工作包库")');
await p.waitForSelector('app-optional-library input[aria-label="名称 型式试验"]');
step('模板：A/B/C 类型模板、可选工作包库');
await p.click('mat-sidenav a:text-is("用户与角色")');
await p.click('.stabs [role=tab]:text-is("立项与审批角色")');
await p.click('section[data-kind=COSIGNER] button:has-text("+ 添加人员")');
await p.locator('section[data-kind=COSIGNER] select').first().selectOption({ label: '赵质量' });
await p.click('section[data-kind=COSIGNER] button:has-text("保存会签人")');
await p.waitForSelector('section[data-kind=COSIGNER] .ok');
await p.click('mat-sidenav a:text-is("企业设置")');
await p.click('mat-checkbox:has-text("立项需要会签") input');
await p.click('button:has-text("保存")');
await p.waitForSelector('text=已保存');
step('指定会签人，开启立项会签');

// 会签：申请提交后先会签，再批准
const ini = await call('POST', '/initiations', u.pm.access, {
  name: '制动闸片备货', type: 'C', projectCode: code + 'C', proposedPmId: u.pm.id, startDate: '2026-11-02',
  requirements: { milestones: [], deliverables: [], stockLines: [{ product: '制动闸片 ZP-220', quantity: 4000, date: '2027-03-31' }], risks: [], longLead: false,
    quality: { standards: [], special: '', acceptance: '', fai: false, faiReason: '工艺未变更', customerWitness: false, drawingApproval: false, rams: false }, cost: { cap: 500000 } },
});
await call('POST', `/initiations/${ini.id}/submit`, u.pm.access);
await loginAs(p, u.pqm);
await p.click('mat-sidenav a:text-is("立项管理")');
await p.click('a:text-is("制动闸片备货")');
await p.waitForSelector('.steps li.now:has-text("会签")');
await p.fill('textarea[aria-label=会签意见]', '同意，首批加严检验');
await p.getByRole('button', { name: '同意', exact: true }).click();
await p.waitForSelector('.opinion:has-text("首批加严检验")');
await p.waitForSelector('.meta .pill:text-is("待审批")');
step('会签人给出会签意见后进入待审批');

if (errors.length) throw new Error(errors.join('\n'));
await b.close();
console.log('initiation 全部通过');
