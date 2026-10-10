// 企业设置 → 项目权限：默认按职能角色放开编辑；管理员修改后，项目成员看到的编辑按钮随之变化
import { launch, step, loginAs, openProject, tab, WEB } from './lib.mjs';
import { seedTenant, call } from './seed.mjs';

const u = await seedTenant('pm-' + Date.now().toString(36));
const roles = await call('GET', '/functional-roles', u.admin.access);
const design = roles.find((r) => r.name.includes('设计')) ?? await call('POST', '/functional-roles', u.admin.access, { name: '设计' });
await call('PATCH', `/users/${u.member.id}`, u.admin.access, { functionalRoleId: design.id });
const code = 'PM-' + Date.now().toString(36).slice(-4).toUpperCase();
const ini = await call('POST', '/initiations', u.pm.access, { name: '地铁转向架牵引拉杆', type: 'B', projectCode: code, customer: '华南城轨', proposedPmId: u.pm.id, startDate: '2026-11-02',
  requirements: { deliveryDate: '2027-09-30', milestones: [], deliverables: [{ name: '牵引拉杆总成', quantity: '1200 件', kind: 'PRODUCT' }], stockLines: [], risks: [], longLead: false,
    quality: { standards: [], special: '', acceptance: '出厂检验', fai: true, faiReason: '', customerWitness: false, drawingApproval: false, rams: false }, cost: { cap: 3000000, target: 2850000 } } });
await call('POST', `/initiations/${ini.id}/submit`, u.pm.access);
const pid = (await call('POST', `/initiations/${ini.id}/approve`, u.top.access, {})).projectId;
await call('POST', `/projects/${pid}/members`, u.pm.access, { userId: u.member.id, projectRole: 'MEMBER' });

const { b, p, errors } = await launch();
p.on('dialog', (d) => d.accept());

// 1. 设计人员默认：能写需求，不能改 WBS
await loginAs(p, u.member);
await openProject(p, code);
await p.goto(`${WEB}/projects/${pid}?g=plan&s=requirements`);
await p.waitForSelector('app-project-requirements form');
await tab(p, 'WBS');
await p.waitForSelector('table.wbs tbody tr');
if (await p.$('button:has-text("+ 新增工作包")')) throw new Error('设计人员默认不应能新增工作包');
step('默认：设计人员可以编辑需求，不能改 WBS 结构');

// 2. 企业管理员在企业设置里给“设计”放开 WBS
await loginAs(p, u.admin);
await p.goto(`${WEB}/settings`);
await p.waitForSelector('[data-perm] tr[data-row=REQUIREMENTS]');
if (!(await p.isChecked(`[data-perm] input[aria-label="项目要求、需求细化 ${design.name}"]`))) throw new Error('默认应勾选设计可编辑需求');
await p.check(`[data-perm] tr[data-row=WBS] input[aria-label$=" ${design.name}"]`);
await p.click('[data-perm] button:has-text("保存项目权限")');
await p.waitForSelector('[data-perm] .ok:text-is("已保存")');
step('企业设置 → 项目权限：勾选“设计”可编辑 WBS 并保存');

// 3. 设计人员现在可以新增工作包
await loginAs(p, u.member);
await openProject(p, code);
await tab(p, 'WBS');
await p.click('button:has-text("+ 新增工作包")');
await p.fill('app-modal input[formcontrolname=code]', '9');
await p.fill('app-modal input[formcontrolname=name]', '设计评审准备');
await p.click('app-modal button:has-text("添加工作包")');
await p.waitForSelector('td:has-text("设计评审准备")');
step('设计人员按新权限新增工作包');

const logs = await call('GET', '/audit-logs?limit=20', u.admin.access);
if (!logs.some((l) => l.action === 'tenant.projectPermissions')) throw new Error('权限修改应记入审计日志');
step('权限修改记入审计日志');

if (errors.length) throw new Error(errors.join('\n'));
await b.close();
console.log('permissions: all passed');
