import { launch, step, signup, login, logout, addUser } from './lib.mjs';
const slug = 'b-' + Date.now().toString(36);
const { b, p, errors } = await launch();
await signup(p, slug); step('注册企业');
await addUser(p, '李经理', 'pm@demo.test', 'pm-pass-12345', '项目经理');
await addUser(p, '王成员', 'wang@demo.test', 'pm-pass-12345', '成员（只读）');
await logout(p);

await login(p, slug, 'pm@demo.test', 'pm-pass-12345'); step('项目经理登录');
await p.click('a:has-text("项目")');
await p.fill('input[formcontrolname=code]', 'HSR-001');
await p.fill('input[formcontrolname=name]', '高铁转向架项目');
await p.fill('input[formcontrolname=startDate]', '2026-03-02');
await p.fill('input[formcontrolname=endDate]', '2026-12-31');
await p.fill('input[formcontrolname=budget]', '5000000');
await p.click('button:has-text("创建项目")');
await p.waitForSelector('h1:has-text("HSR-001")'); step('创建项目并进入详情');

await p.click('[role=tab]:has-text("阶段")');
await p.waitForSelector('text=1. 投标'); step('阶段页显示 7 个默认阶段');
if (await p.locator('.phase').count() !== 7) throw new Error('阶段数量不对');

await p.click('[role=tab]:has-text("成员")');
await p.click('mat-select[formcontrolname=userId]');
await p.click('mat-option:has-text("王成员")');
await p.click('button:has-text("添加成员")');
await p.waitForSelector('td:has-text("王成员")'); step('添加项目成员');

await p.click('[role=tab]:has-text("WBS")');
async function addWp(code, name, days, parent) {
  await p.fill('input[formcontrolname=code]', code);
  await p.fill('input[formcontrolname=name]', name);
  await p.fill('input[formcontrolname=durationDays]', String(days));
  if (parent) { await p.click('mat-select[formcontrolname=parentId]'); await p.click(`mat-option:has-text("${parent}")`); }
  await p.click('button:has-text("添加工作包")');
  await p.waitForSelector(`td:has-text("${name}")`);
}
await addWp('1', '设计', 1);
await addWp('1.1', '方案设计', 2, '1 设计');
await addWp('1.2', '详细设计', 5, '1 设计');
await addWp('1.3', '设计评审', 2, '1 设计');
await addWp('2', '制造', 3);
step('添加 5 个工作包');
async function addDep(pred, succ) {
  await p.click('mat-select[formcontrolname=predecessorId]'); await p.click(`mat-option:has-text("${pred}")`);
  await p.click('mat-select[formcontrolname=successorId]'); await p.click(`mat-option:has-text("${succ}")`);
  await p.click('button:has-text("添加依赖")');
  await p.waitForTimeout(400);
}
await addDep('1.1 方案设计', '1.2 详细设计');
await addDep('1.1 方案设计', '1.3 设计评审');
await addDep('1.2 详细设计', '2 制造');
await addDep('1.3 设计评审', '2 制造');
await p.waitForSelector('text=总工期 10 天'); step('总工期 = 关键路径 10 天');
const row = await p.locator('tr', { hasText: '详细设计' }).innerText();
if (!row.includes('★')) throw new Error('详细设计应在关键路径上');
const row2 = await p.locator('tr', { hasText: '设计评审' }).innerText();
if (row2.includes('★')) throw new Error('设计评审不应在关键路径上');
step('关键路径标记正确');
await p.click('mat-button-toggle:has-text("甘特图")');
await p.waitForSelector('svg[aria-label=甘特图]');
await p.screenshot({ path: `${process.env.SHOT_DIR ?? '/tmp'}/gantt.png` }); step('甘特图渲染');
await p.click('mat-button-toggle:has-text("看板")');
await p.waitForSelector('.board'); step('看板视图');

await p.click('[role=tab]:has-text("概览")');
await p.fill('textarea >> nth=0', '按期交付合格的转向架');
await p.click('button:has-text("保存计划")');
await p.waitForSelector('text=已保存'); step('保存项目管理计划');
await p.click('button:has-text("建立基线并启动项目")');
await p.waitForSelector('text=已建立基线'); step('建立基线');

await p.click('[role=tab]:has-text("WBS")');
await p.fill('input[formcontrolname=code]', '3');
await p.fill('input[formcontrolname=name]', '新增范围');
await p.click('button:has-text("添加工作包")');
await p.waitForSelector('text=需要先提交并批准变更申请'); step('基线后新增范围被拦截并提示需要变更申请');
await logout(p);

await login(p, slug, 'wang@demo.test', 'pm-pass-12345');
await p.click('a:has-text("项目")');
await p.click('a:has-text("HSR-001")');
await p.waitForSelector('h1:has-text("HSR-001")');
const hasForm = await p.locator('button:has-text("保存计划")').count();
if (hasForm) throw new Error('成员不应看到保存计划按钮');
step('普通成员能看项目但看不到编辑入口');
console.log('浏览器错误:', errors.length ? errors : '无');
await b.close();
