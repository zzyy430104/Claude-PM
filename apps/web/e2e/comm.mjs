// 第 4 步：会议（发起、通知、参会确认、外部人员登记、纪要与行动项、例会下一次带出未关闭行动项）、公告（发布、已读确认、提醒未读）
import { launch, step, loginAs, openProject, tab } from './lib.mjs';
import { seedTenant, call } from './seed.mjs';

const u = await seedTenant('cm-' + Date.now().toString(36));
const code = 'CM-' + Date.now().toString(36).slice(-4).toUpperCase();
const ini = await call('POST', '/initiations', u.pm.access, { name: '地铁转向架牵引拉杆', type: 'B', projectCode: code, customer: '华南城轨', proposedPmId: u.pm.id, startDate: '2026-11-02',
  requirements: { deliveryDate: '2027-09-30', milestones: [], deliverables: [{ name: '牵引拉杆总成', quantity: '1200 件', kind: 'PRODUCT' }], stockLines: [], risks: [], longLead: false,
    quality: { standards: ['ISO/TS 22163'], special: '', acceptance: '出厂检验', fai: true, faiReason: '', customerWitness: false, drawingApproval: false, rams: false }, cost: { cap: 3000000, target: 2850000 } } });
await call('POST', `/initiations/${ini.id}/submit`, u.pm.access);
const pid = (await call('POST', `/initiations/${ini.id}/approve`, u.top.access, {})).projectId;
await call('POST', `/projects/${pid}/members`, u.pm.access, { userId: u.member.id, projectRole: 'MEMBER' });
await call('POST', `/projects/${pid}/stakeholders`, u.pm.access, { name: '陈工', organization: '华南城轨（客户）', email: 'chen@customer.test' });

const { b, p, errors } = await launch();
p.on('dialog', (d) => d.accept());
const yesterday = new Date(Date.now() - 86_400_000);
const ymd = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`;

// 1. 发起例会（含外部人员）并发送通知
await loginAs(p, u.pm);
await openProject(p, code);
await tab(p, '沟通');
await p.waitForSelector('.stabs [role=tab][aria-selected=true]:text-is("会议")');
await p.click('button:has-text("+ 发起会议")');
await p.selectOption('select[aria-label=会议类型]', 'REGULAR');
await p.fill('input[aria-label=会议主题]', '项目周例会');
await p.fill('input[aria-label=会议日期]', ymd);
await p.fill('input[aria-label=地点]', '3 号会议室');
await p.fill('textarea[aria-label=议程]', '上周行动项跟踪\n技术准备进展');
await p.selectOption('select[aria-label=从干系人添加]', { label: '陈工（华南城轨（客户））' });
await p.click('.pcard button:has-text("保存")');
await p.waitForSelector('[data-detail="项目周例会"]');
await p.click('[data-detail] button:has-text("发送通知")');
await p.waitForSelector('[data-detail] .pill:text-is("已通知")');
step('发起例会：类型、时间、地点、议程、项目组和外部干系人；发送通知（日历邀请）');

// 2. 成员确认参加
await loginAs(p, u.member);
await openProject(p, code);
await tab(p, '沟通');
await p.waitForSelector('[data-meeting="项目周例会"] .pill:text-is("待你确认")');
await p.click('[data-meeting="项目周例会"]');
await p.click('[data-detail] button:has-text("参加"):not(:has-text("不"))');
await p.waitForSelector('[data-detail] .pill.green:text-is("参加")');
step('参会人在系统里确认参加');

// 3. 组织者登记外部人员确认方式，写纪要并发布
await loginAs(p, u.pm);
await openProject(p, code);
await tab(p, '沟通');
await p.click('[data-meeting="项目周例会"]');
await p.click('[role=tab]:text-is("参会确认")');
await p.selectOption('tr[data-att="陈工"] select[aria-label=登记确认方式]', 'PHONE');
await p.waitForSelector('tr[data-att="陈工"]:has-text("电话")');
await p.click('[role=tab]:text-is("纪要")');
await p.fill('textarea[aria-label=讨论要点]', 'PFMEA 初稿完成 80%');
await p.fill('textarea[aria-label=决定事项]', '铸件开发第二供应商');
await p.click('button:has-text("+ 添加行动项")');
await p.fill('input[aria-label=行动项内容]', '提交 PFMEA 初稿供质量评审'); await p.dispatchEvent('input[aria-label=行动项内容]', 'change');
await p.selectOption('select[aria-label=行动项责任人]', { label: '王成员' });
await p.fill('input[aria-label=行动项期限]', ymd); await p.dispatchEvent('input[aria-label=行动项期限]', 'change');
await p.click('button:has-text("发布纪要")');

await p.waitForSelector('[data-detail] h4:has-text("已进入「问题与行动」")');
await p.waitForSelector('[data-detail] td:text-is("提交 PFMEA 初稿供质量评审")');
step('登记外部人员电话确认；写要点、决定和行动项，发布纪要');

await p.click('[role=tab]:text-is("通知")');
await p.click('button:has-text("生成下一次")');
await p.waitForSelector('[data-detail="项目周例会 #2"]');
await p.click('[role=tab]:text-is("纪要")');
await p.waitForSelector('.carry:has-text("提交 PFMEA 初稿供质量评审")');
step('例会生成下一次（#2），自动带出上次未关闭的行动项');

await tab(p, '问题与行动');
await p.waitForSelector('td:has-text("提交 PFMEA 初稿供质量评审")');
step('纪要里的行动项进入「问题与行动」');

// 4. 公告
await tab(p, '沟通'); await p.click('.stabs [role=tab]:text-is("公告")');
await p.click('button:has-text("+ 发布公告")');
await p.fill('input[aria-label=公告标题]', '项目要求 v2：首批交期提前到 11-30');
await p.fill('textarea[aria-label=公告内容]', '客户补充协议已签署，首批交付提前到 11-30。');
await p.check('input[aria-label=要求已读确认]');
await p.click('.pcard button:has-text("发布")');
await p.waitForSelector('[data-detail] :text("已读确认 1 / 2")');
await p.waitForSelector('[data-detail] .chip.un:text-is("王成员")');
await p.click('button:has-text("提醒未读人员")');
await p.waitForSelector('[data-detail] :text("上次提醒")');
step('项目经理发布公告，要求已读确认，提醒未读人员');

await loginAs(p, u.member);
await openProject(p, code);
await tab(p, '沟通'); await p.click('.stabs [role=tab]:text-is("公告")');
if (await p.locator('button:has-text("+ 发布公告")').count()) throw new Error('成员不能发布公告');
await p.click('[data-ann="项目要求 v2：首批交期提前到 11-30"]');
await p.click('button:has-text("我已阅读")');
await p.waitForSelector('.pill:text-is("你已确认阅读")');
step('成员阅读并确认公告（成员不能发布公告）');

const real = errors.filter((e) => !e.includes('400 (Bad Request)'));
if (real.length) throw new Error(real.join('\n'));
await b.close();
console.log('comm: all passed');
