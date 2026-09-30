import { launch, step, loginAs, openProject, tab } from './lib.mjs';
import { seedTenant, seedProject, call } from './seed.mjs';
const u = await seedTenant('f-' + Date.now().toString(36));
const proj = await seedProject(u);
// 造一点数据：高分风险、逾期行动项、一次待审批变更
await call('POST', `/projects/${proj.id}/risks`, u.pm.access, { kind: 'RISK', title: '关键件延期', probability: 5, impact: 4, exposureAmount: 200000, responseCost: 30000, costBenefitAnalysis: '提前下单' });
await call('POST', `/projects/${proj.id}/issues`, u.pm.access, { title: '补充设计评审记录', kind: 'ACTION', ownerId: u.member.id, dueDate: '2020-01-01' });
const cr = await call('POST', `/projects/${proj.id}/changes`, u.member.access, { type: 'OTHER', title: '流程调整', description: 'd', reason: 'r', impactAnalysis: 'i' });
await call('POST', `/projects/${proj.id}/changes/${cr.id}/submit`, u.member.access);

const { b, p, errors } = await launch();
await loginAs(p, u.pm);
await p.waitForSelector('text=项目组合');
await p.waitForSelector('text=待办'); step('首页：项目组合与待办');
const home = await p.locator('.page').innerText();
if (!home.includes('高分风险') && !home.includes('1 个高分风险')) throw new Error('健康度原因缺失: ' + home);
step('健康度原因展示');
await p.screenshot({ path: 'home.png' });
// 通知铃铛：PM 是 CCB，应收到待审批变更通知
await p.click('button:has-text("通知")');
await p.waitForSelector('button[mat-menu-item]:has-text("待审批变更 CR-001")'); step('通知菜单显示待审批变更');
await p.click('button[mat-menu-item]:has-text("待审批变更 CR-001")');
await p.waitForSelector('h1:has-text("评审演示项目")'); step('点击通知跳转到项目');
// 证据包按钮
await tab(p, '概览');
const [dl] = await Promise.all([p.waitForEvent('download'), p.click('button:has-text("导出审核证据包")')]);
const path = await dl.path();
const { statSync } = await import('node:fs');
if (statSync(path).size < 1000) throw new Error('证据包太小');
step(`导出证据包（${statSync(path).size} 字节）`);
await b.close();
