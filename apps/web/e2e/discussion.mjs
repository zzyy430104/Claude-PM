// 第 4 步：讨论（工作包、风险、变更上 @ 项目成员）、邮件通知偏好、我的工作台（待我处理、近期会议、我的行动项、我负责的工作包）
import { launch, step, loginAs, openProject, tab, WEB } from './lib.mjs';
import { seedTenant, call } from './seed.mjs';

const u = await seedTenant('ds-' + Date.now().toString(36));
const code = 'DS-' + Date.now().toString(36).slice(-4).toUpperCase();
const ini = await call('POST', '/initiations', u.pm.access, { name: '地铁转向架牵引拉杆', type: 'B', projectCode: code, customer: '华南城轨', proposedPmId: u.pm.id, startDate: '2026-11-02',
  requirements: { deliveryDate: '2027-09-30', milestones: [], deliverables: [{ name: '牵引拉杆总成', quantity: '1200 件', kind: 'PRODUCT' }], stockLines: [], risks: [{ kind: 'RISK', text: '铸件供应商产能不足' }], longLead: false,
    quality: { standards: ['ISO/TS 22163'], special: '', acceptance: '出厂检验', fai: true, faiReason: '', customerWitness: false, drawingApproval: false, rams: false }, cost: { cap: 3000000, target: 2850000 } } });
await call('POST', `/initiations/${ini.id}/submit`, u.pm.access);
const pid = (await call('POST', `/initiations/${ini.id}/approve`, u.top.access, {})).projectId;
await call('POST', `/projects/${pid}/members`, u.pm.access, { userId: u.member.id, projectRole: 'MEMBER' });
const wbs = await call('GET', `/projects/${pid}/wbs`, u.pm.access);
const wp = wbs.items.find((w) => w.isLeaf);
await call('PATCH', `/projects/${pid}/wbs/${wp.id}`, u.pm.access, { ownerId: u.member.id });
const start = new Date(Date.now() + 2 * 86_400_000); start.setHours(9, 30, 0, 0);
const m = await call('POST', `/projects/${pid}/meetings`, u.pm.access, { title: '技术准备评审会', type: 'PHASE_REVIEW', startAt: start.toISOString(), endAt: new Date(start.getTime() + 3_600_000).toISOString(), location: '3 号会议室', attendees: [{ userId: u.member.id }] });
await call('POST', `/projects/${pid}/meetings/${m.id}/notify`, u.pm.access);
await call('POST', `/projects/${pid}/announcements`, u.pm.access, { title: '焊缝检验标准更新', body: '自下周起抽检比例提高到 100%。', requireRead: true });
await call('POST', `/projects/${pid}/issues`, u.pm.access, { kind: 'ACTION', title: '催铸件供应商出排产计划', ownerId: u.member.id, dueDate: '2026-10-09' });

const { b, p, errors } = await launch();
p.on('dialog', (d) => d.accept(d.type() === 'prompt' ? '已拿到排产计划' : undefined));

// 1. 工作包上讨论并 @ 成员
await loginAs(p, u.pm);
await openProject(p, code);
await tab(p, 'WBS');
await p.click(`button:has-text("${wp.name}")`);
await p.click('app-wp-drawer [role=tab]:text-is("讨论")');
await p.click('app-discussion .at button:has-text("王成员")');
await p.waitForFunction(() => document.querySelector('textarea[aria-label=讨论内容]')?.value.includes('@王成员'));
await p.fill('textarea[aria-label=讨论内容]', (await p.inputValue('textarea[aria-label=讨论内容]')) + '夹具图纸请周五前确认');
await p.waitForSelector('app-discussion :text("将通知 王成员")');
await p.click('app-discussion button:has-text("发表")');
await p.waitForSelector('app-discussion .c:has-text("@王成员 夹具图纸请周五前确认")');
await p.click('app-wp-drawer button[aria-label=关闭]');
step('工作包详情 → 讨论：@ 项目成员并发表');

// 2. 风险上讨论
await tab(p, '目标与风险');
await p.click('tr[data-risk="铸件供应商产能不足"] a');
await p.click('.win [role=tab]:text-is("讨论")');
await p.fill('textarea[aria-label=讨论内容]', '第二供应商报价已到，下周比价');
await p.click('app-discussion button:has-text("发表")');
await p.waitForSelector('app-discussion .c:has-text("第二供应商报价已到")');
await p.click('.win button[aria-label=关闭]');
step('风险详情 → 讨论');

// 3. 成员：工作台看到 @、会议、公告、工作包；关闭讨论类邮件
await loginAs(p, u.member);
await p.waitForSelector('[data-box=pending] li:has-text("夹具图纸请周五前确认")');
await p.waitForSelector('[data-box=pending] li:has-text("请阅读并确认：焊缝检验标准更新")');
await p.waitForSelector('[data-box=pending] li:has-text("请确认是否参加：技术准备评审会")');
await p.waitForSelector(`[data-box=wps] li:has-text("${wp.code}"):has-text("计划完成")`);
await p.click('[data-meeting="技术准备评审会"] button:has-text("参加"):not(:has-text("不"))');
await p.waitForSelector('[data-meeting="技术准备评审会"] .pill:text-is("已确认")');
step('工作台：待我处理（@我、待读公告、待确认会议）、近期会议里直接确认参加、我负责的工作包带计划完成日期');
await p.click('[data-box=actions] li:has-text("催铸件供应商出排产计划") button.done');
await p.waitForSelector('[data-box=actions] li:has-text("催铸件供应商出排产计划")', { state: 'detached' });
const closed = (await call('GET', `/projects/${pid}/issues`, u.pm.access)).find((i) => i.title === '催铸件供应商出排产计划');
if (closed.status !== 'CLOSED' || closed.closureNote !== '已拿到排产计划') throw new Error('行动项没有按结论关闭');
step('工作台：行动项直接点“完成”，填写关闭结论后关闭');

await p.click('[data-box=pending] li:has-text("夹具图纸") a');
await p.waitForSelector('.stabs [role=tab][aria-selected=true]:text-is("WBS 与进度")');
step('点“@我”的讨论打开对应页面');

await p.goto(`${WEB}/account`);
await p.waitForSelector('h2:text-is("邮件通知")');
await p.uncheck('input[aria-label="邮件 讨论"]');
await p.waitForSelector('app-email-prefs :text("已保存")');
await Promise.all([p.waitForResponse((r) => r.url().includes('/notifications/email-prefs') && r.request().method() === 'GET'), p.reload()]);
await p.waitForTimeout(300);
if (await p.isChecked('input[aria-label="邮件 讨论"]')) throw new Error('邮件偏好未保存');
step('个人设置：按类别选择是否发邮件');

if (errors.length) throw new Error(errors.join('\n'));
await b.close();
console.log('discussion: all passed');
