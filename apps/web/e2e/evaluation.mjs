// 第三步 5C：部门与负责人、绩效评价设置、项目经理绩效（自动计分、按项目调整权重、管理层评语与确认）、成员评价（打分、提交、可见范围）、评价单与导出
import { launch, step, loginAs, openProject, tab, WEB } from './lib.mjs';
import { seedTenant, call } from './seed.mjs';

const u = await seedTenant('ev-' + Date.now().toString(36));
const code = 'EV-' + Date.now().toString(36).slice(-4).toUpperCase();
const ini = await call('POST', '/initiations', u.pm.access, { name: '地铁转向架牵引拉杆', type: 'B', projectCode: code, customer: '华南城轨', proposedPmId: u.pm.id, startDate: '2026-11-02',
  requirements: { deliveryDate: '2027-09-30', milestones: [], deliverables: [{ name: '牵引拉杆总成', quantity: '1200 件', kind: 'PRODUCT' }], stockLines: [], risks: [], longLead: false,
    quality: { standards: ['ISO/TS 22163'], special: '', acceptance: '出厂检验', fai: true, faiReason: '', customerWitness: false, drawingApproval: false, rams: false }, cost: { cap: 3000000, target: 2850000 } } });
await call('POST', `/initiations/${ini.id}/submit`, u.pm.access);
const pid = (await call('POST', `/initiations/${ini.id}/approve`, u.top.access, {})).projectId;
await call('POST', `/projects/${pid}/members`, u.pm.access, { userId: u.member.id, projectRole: 'MEMBER' });
await call('PUT', '/approval-roles/HR', u.admin.access, { entries: [{ userId: u.pqm.id, basis: '人事部' }] });

const { b, p, errors } = await launch();
p.on('dialog', (d) => d.accept(d.message().includes('原因') ? '本项目交期是重点' : ''));

// 1. 企业设置：部门与负责人、绩效评价设置
await loginAs(p, u.admin);
await p.goto(`${WEB}/settings`);
await p.waitForSelector('app-perf-settings h3:text-is("部门与负责人")');
await p.fill('input[aria-label=新部门名称]', '工艺部');
await p.selectOption('select[aria-label=新部门负责人]', { label: '钱总' });
await p.click('button:has-text("添加部门")');
await p.waitForSelector('tr[data-dept="工艺部"]');
await p.fill('tr[data-aspect=TIME] input[aria-label=权重]', '50'); await p.dispatchEvent('tr[data-aspect=TIME] input[aria-label=权重]', 'change');
await p.waitForSelector('app-perf-settings .sum.bad:text-is("110%")');
await p.fill('tr[data-aspect=COST] input[aria-label=权重]', '20'); await p.dispatchEvent('tr[data-aspect=COST] input[aria-label=权重]', 'change');
await p.click('button:has-text("保存绩效评价设置")');
await p.waitForSelector('app-perf-settings .ok:text-is("已保存")');
step('企业设置：部门与负责人；项目经理绩效权重改为 时间 50 / 质量 30 / 成本 20（合计须 100%）');

await p.click('mat-sidenav a:text-is("用户与角色")');
await p.waitForSelector('td:has-text("王成员")');
const row = p.locator('tr:has(td:text-is("王成员"))');
await row.locator('mat-select[aria-label=部门]').click({ force: true });
await p.click('mat-option:has-text("工艺部")');
await p.waitForTimeout(500);
step('用户选所属部门');

// 2. 项目经理：自动计分、按项目调整权重、成员评价
await loginAs(p, u.pm);
await openProject(p, code);
await tab(p, '收尾');
await p.waitForSelector('app-project-evaluation tr[data-aspect=TIME]:has-text("要求 2027-09-30")');
await p.waitForSelector('app-project-evaluation tr[data-aspect=TIME] input[aria-label="权重 时间"]');
if (await p.inputValue('tr[data-aspect=TIME] input[aria-label="权重 时间"]') !== '50') throw new Error('应带出企业默认权重');
await p.fill('input[aria-label=实际交付日期]', '2027-10-05'); await p.dispatchEvent('input[aria-label=实际交付日期]', 'change');
await p.waitForSelector('tr[data-aspect=TIME]:has-text("晚 3 个工作日")');
await p.waitForSelector('tr[data-aspect=TIME] td.num:text-is("85")');
step('项目经理绩效：按实际交付日期与要求交期自动计分（晚 3 个工作日 → 85）');

await p.fill('input[aria-label="权重 时间"]', '40'); await p.dispatchEvent('input[aria-label="权重 时间"]', 'change');
await p.fill('input[aria-label="权重 成本"]', '30'); await p.dispatchEvent('input[aria-label="权重 成本"]', 'change');
await p.click('button:has-text("保存本项目权重")');
await p.waitForSelector('app-project-evaluation .muted:has-text("本项目调整原因：本项目交期是重点")');
await p.waitForSelector('[data-total]:has-text("94")');
step('按项目调整权重（须写原因、留记录）：综合 94，优秀');

for (const [dim, v] of [['工作质量', '5'], ['按时完成', '4'], ['协作配合', '4'], ['主动性', '5']]) {
  await p.selectOption(`select[aria-label="王成员 ${dim}"]`, v);
  await p.waitForTimeout(300);
}
await p.fill('input[aria-label="王成员 评语"]', '工艺文件质量高'); await p.dispatchEvent('input[aria-label="王成员 评语"]', 'change');
await p.waitForSelector('tr[data-member="王成员"] .pill:text-is("优秀")');
await p.click('tr[data-member="王成员"] button:has-text("提交")');
await p.waitForSelector('tr[data-member="王成员"] .pill:has-text("已提交")');
if (await p.locator('select[aria-label="王成员 工作质量"]').count()) throw new Error('提交后应锁定');
step('成员评价：四个维度打分、评语，提交后锁定');

// 3. 本人：提交后可以看到自己的评价，看不到项目经理绩效
await loginAs(p, u.member);
await p.click('mat-sidenav a:text-is("绩效评价单")');
await p.waitForSelector('tr[data-sheet="王成员"]:has-text("工艺文件质量高")');
await openProject(p, code);
await tab(p, '收尾');
await p.waitForSelector('app-project-evaluation tr[data-member="王成员"]');
if (await p.locator('app-project-evaluation tr[data-aspect]').count()) throw new Error('成员不应看到项目经理绩效');
step('被评价人提交后看到自己的评价，看不到项目经理绩效');

// 4. 管理层：自定义方面、评语、调整分数（须写理由）、确认
await loginAs(p, u.top);
await openProject(p, code);
await tab(p, '收尾');
await p.waitForSelector('app-project-evaluation tr[data-aspect=TIME]');
await p.fill('textarea[aria-label=管理层评语]', '要求变更下仍基本按期'); await p.dispatchEvent('textarea[aria-label=管理层评语]', 'change');
await p.fill('input[aria-label=调整分数]', '96');
await p.click('button:has-text("保存调整")');
await p.waitForSelector('app-project-evaluation .error:has-text("理由")');
await p.fill('input[aria-label=调整理由]', '客户书面表扬');
await p.click('button:has-text("保存调整")');
await p.waitForSelector('[data-total]:has-text("96")');
await p.click('button:has-text("确认项目经理绩效")');
await p.waitForSelector('app-project-evaluation .muted:has-text("管理层已于")');
step('管理层：评语、调整分数须写理由，确认后冻结');

// 5. 人事：评价单与导出
await loginAs(p, u.pqm);
await p.click('mat-sidenav a:text-is("绩效评价单")');
await p.waitForSelector('tr[data-sheet="王成员"]:has-text("工艺部")');
await p.waitForSelector('tr[data-sheet="李经理"]:has-text("96")');
const [dl] = await Promise.all([p.waitForEvent('download'), p.click('button:has-text("导出 Excel")')]);
if (!dl.suggestedFilename().endsWith('.xlsx')) throw new Error('导出文件名不对');
step('人事：查看项目经理和成员的评价单，导出 Excel');

// 两次 400 是故意触发的校验（调整分数未写理由）
const real = errors.filter((e) => !e.includes('400 (Bad Request)'));
if (real.length) throw new Error(real.join('\n'));
await b.close();
console.log('evaluation: all passed');
