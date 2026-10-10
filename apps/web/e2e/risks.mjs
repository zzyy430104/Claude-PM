// 第三步 5B：项目目标、风险与机会（识别 → 评价 → 应对 → 预警 → 复评与关闭）、升级、企业风险、风险管理设置
import { launch, step, loginAs, openProject, tab, WEB } from './lib.mjs';
import { seedTenant, call } from './seed.mjs';

const u = await seedTenant('rk-' + Date.now().toString(36));
const code = 'RK-' + Date.now().toString(36).slice(-4).toUpperCase();
const ini = await call('POST', '/initiations', u.pm.access, { name: '地铁转向架牵引拉杆', type: 'B', projectCode: code, customer: '华南城轨', proposedPmId: u.pm.id, startDate: '2026-11-02',
  requirements: { deliveryDate: '2027-09-30', milestones: [], deliverables: [{ name: '牵引拉杆总成', quantity: '1200 件', kind: 'PRODUCT' }], stockLines: [], risks: [{ kind: 'RISK', text: '铸件供应商产能不足' }], longLead: false,
    quality: { standards: ['ISO/TS 22163'], special: '', acceptance: '出厂检验', fai: true, faiReason: '', customerWitness: false, drawingApproval: false, rams: false }, cost: { cap: 3000000, target: 2850000 } } });
await call('POST', `/initiations/${ini.id}/submit`, u.pm.access);
const pid = (await call('POST', `/initiations/${ini.id}/approve`, u.top.access, {})).projectId;
await call('POST', `/projects/${pid}/members`, u.pm.access, { userId: u.member.id, projectRole: 'MEMBER' }).catch(() => {});

const { b, p, errors } = await launch();
const answers = { '目标维度': '客户', '目标名称': '客户满意度', '目标值': '≥ 90 分', '升级为项目级': '影响多个工作包', '升级为企业级': '多个项目共用该供应商' };
p.on('dialog', (d) => d.accept(Object.entries(answers).find(([k]) => d.message().includes(k))?.[1] ?? ''));

// 1. 项目目标：由项目要求生成，补充自定义目标
await loginAs(p, u.pm);
await openProject(p, code);
await tab(p, '目标与风险');
await p.waitForSelector('.obj[data-name="全部交付"]:has-text("不晚于 2027-09-30")');
await p.waitForSelector('.obj[data-name="完工成本"]:has-text("285 万")');
await p.waitForSelector('.obj[data-name="FAI 首件鉴定"]');
await p.click('button:has-text("+ 自定义目标")');
await p.waitForSelector('.obj[data-name="客户满意度"]:has-text("（自定义）")');
await p.selectOption('.obj[data-name="客户满意度"] select[aria-label=目标状态]', 'GREEN');
await p.waitForSelector('.obj[data-name="客户满意度"] .pill:text-is("正常")');
step('项目目标：交期、成本、FAI 由项目要求自动生成；可加自定义目标并手工评状态');

// 2. 立项时的初步风险：评价、关联目标、策划应对、加措施
await p.waitForSelector('tr[data-risk="铸件供应商产能不足"]');
await p.click('tr[data-risk="铸件供应商产能不足"] a');
await p.selectOption('select[aria-label=影响的项目目标]', { label: '交期 · 全部交付' });
await p.click('[role=tab]:has-text("2 评价")');
await p.click('button[aria-label="可能性 高 影响 高"]');
await p.waitForSelector('.win dd .pill:text-is("高")');
await p.waitForSelector('.win footer:has-text("项目级 · 高：应对由项目经理审批")');
await p.click('[role=tab]:has-text("3 应对")');
await p.click('.win .chip:text-is("减弱")');
await p.click('.win footer button:has-text("保存")');
await p.waitForSelector('.win .error:has-text("成本收益分析")');
await p.fill('textarea[aria-label=成本收益分析]', '开发第二供应商，费用小于延期损失');
await p.click('.win footer button:has-text("保存")');
await p.waitForSelector('.win', { state: 'detached' });
await p.waitForSelector('tr[data-risk="铸件供应商产能不足"]:has-text("减弱")');
await p.waitForSelector('.obj[data-name="全部交付"] .pill:text-is("关注")');
step('评价矩阵定重要度；选策略必须写成本收益分析；关联高风险的目标显示“关注”');

await p.click('tr[data-risk="铸件供应商产能不足"] a');
await p.click('[role=tab]:has-text("3 应对")');
await p.fill('input[aria-label=措施内容]', '开发第二铸件供应商');
await p.selectOption('select[aria-label=措施责任人]', { label: '李经理' });
await p.fill('input[aria-label=措施期限]', '2020-01-31');
await p.click('.win button:has-text("+ 添加措施")');
await p.waitForSelector('.win td:has-text("开发第二铸件供应商")');
await p.waitForSelector('.win .pill:text-is("逾期")');
step('添加措施（生成行动项）');

// 3. 预警
await p.click('[role=tab]:has-text("4 预警")');
await p.fill('input[aria-label=预警条件]', '供应商周产能低于 200 件');
await p.click('.win button:has-text("预警条件已触发")');
await p.waitForSelector('.win .banner.red:has-text("预警条件已于")');
await p.click('.win button[aria-label=关闭]');
await tab(p, '风险与机会');
await p.waitForSelector('.kpi:has-text("打开的风险") .v:text-is("1")');
await p.waitForSelector('.w.red:has-text("措施逾期")');
await p.waitForSelector('.w.red:has-text("预警条件已触发：供应商周产能低于 200 件")');
step('控制 → 风险与机会：指标、措施逾期和预警条件触发');

// 4. 措施完成 → 待复评 → 复评并关闭
await p.click('.w:has-text("措施逾期") a');
await p.click('[role=tab]:has-text("5 复评与关闭")');
if (await p.isEnabled('.win button:has-text("复评并关闭")')) throw new Error('措施未完成时不能关闭');
await p.click('.win button[aria-label=关闭]');
const actions = await call('GET', `/projects/${pid}/issues`, u.pm.access);
const act = actions.find((a) => a.title === '开发第二铸件供应商');
await call('PATCH', `/projects/${pid}/issues/${act.id}`, u.pm.access, { status: 'CLOSED', closureNote: '已签约' });
await p.reload();
await p.waitForSelector('.w.amber:has-text("等待复评")');
await p.click('.w:has-text("等待复评") a');
await p.waitForSelector('.win [role=tab][aria-selected=true]:has-text("5 复评与关闭")');
await p.click('button[aria-label="剩余 可能性 低 影响 中"]');
await p.fill('textarea[aria-label=关闭说明]', '第二供应商已批量供货');
await p.click('.win button:has-text("复评并关闭")');
await p.waitForSelector('.win .banner.ok:has-text("已关闭：第二供应商已批量供货")');
await p.click('.win button[aria-label=关闭]');
await p.waitForSelector('tr[data-risk="铸件供应商产能不足"]', { state: 'detached' });
step('措施全部完成后待复评；评剩余风险并关闭');

// 5. 工作包级风险：选“接受”须写理由；逐级升级到企业级
await p.click('button:has-text("+ 新增")');
await p.fill('input[aria-label=风险描述]', '涂料批次色差');
await p.selectOption('select[aria-label=层级]', 'WORK_PACKAGE');
await p.selectOption('select[aria-label=关联工作包]', { index: 1 });
await p.click('[role=tab]:has-text("3 应对")');
await p.click('.win .chip:text-is("接受")');
await p.fill('textarea[aria-label=成本收益分析]', '影响小，应对不划算');
await p.click('.win footer button:has-text("登记")');
await p.waitForSelector('.win .error:has-text("理由")');
await p.fill('textarea[aria-label=接受的理由]', '外观件，客户可接受轻微色差');
await p.click('.win footer button:has-text("登记")');
await p.waitForSelector('.win', { state: 'detached' });
await p.waitForSelector('tr[data-risk="涂料批次色差"]:has-text("工作包级")');
await p.click('tr[data-risk="涂料批次色差"] a');
await p.click('.win button:has-text("升级为项目级")');
await p.waitForSelector('.win button:has-text("升级为企业级")');
await p.click('.win button:has-text("升级为企业级")');
await p.waitForSelector('.win .muted:has-text("风险 · 企业级")');
await p.click('.win button[aria-label=关闭]');
await p.waitForSelector('tr[data-risk="涂料批次色差"]:has-text("企业级")');
step('工作包级风险：选“接受”须写理由；升级为项目级，再升级为企业级（管理层接手，项目里仍可见）');

// 6. 企业风险：所有人可见；管理层登记、措施、关闭
await loginAs(p, u.member);
await p.click('mat-sidenav a:text-is("企业风险")');
await p.waitForSelector(`tr[data-risk="涂料批次色差"]:has-text("${code}")`);
if (await p.locator('button:has-text("+ 新增")').count()) throw new Error('普通成员不能登记企业风险');
step('企业风险对所有人公开可见（普通成员只读）');

await loginAs(p, u.top);
await p.click('mat-sidenav a:text-is("企业风险")');
await p.click('button:has-text("+ 新增")');
await p.fill('input[aria-label=风险描述]', 'EN 15085 持证焊工不足');
await p.click(`.win .chip:has-text("${code}")`);
await p.click('[role=tab]:has-text("2 评价")');
await p.click('button[aria-label="可能性 中 影响 高"]');
await p.click('.win footer button:has-text("登记")');
await p.waitForSelector('.win', { state: 'detached' });
await p.waitForSelector(`tr[data-risk="EN 15085 持证焊工不足"]:has-text("${code}")`);
await p.click('tr[data-risk="EN 15085 持证焊工不足"] a');
await p.click('[role=tab]:has-text("3 应对")');
await p.fill('input[aria-label=措施内容]', '送 4 名焊工外培取证');
await p.fill('input[aria-label=措施费用]', '48000');
await p.click('.win button:has-text("+ 添加措施")');
await p.waitForSelector('.win td:has-text("48,000")');
await p.click('.win td button:has-text("完成")');
await p.waitForSelector('.win .pill:text-is("完成")');
await p.click('[role=tab]:has-text("5 复评与关闭")');
await p.fill('textarea[aria-label=关闭说明]', '已取证');
await p.click('.win button:has-text("复评并关闭")');
await p.waitForSelector('.win .banner.ok:has-text("已关闭：已取证")');
await p.click('.win button[aria-label=关闭]');
await p.waitForSelector('tr[data-risk="EN 15085 持证焊工不足"]', { state: 'detached' });
step('管理层登记企业风险（挂到受影响的项目）、措施带费用、完成并关闭');

// 7. 企业设置 → 风险管理
await loginAs(p, u.admin);
await p.goto(`${WEB}/settings`);
await p.waitForSelector('app-risk-settings h4:text-is("评价矩阵")');
await p.selectOption('select[aria-label=分级]', '5');
await p.waitForSelector('button[aria-label="矩阵 5 5"]');
await p.click('button[aria-label="矩阵 1 1"]');
await p.fill('tr[data-rule="PROJECT:HIGH"] input[aria-label=复查周期]', '7'); await p.dispatchEvent('tr[data-rule="PROJECT:HIGH"] input[aria-label=复查周期]', 'change');
await p.click('button:has-text("保存风险管理设置")');
await p.waitForSelector('app-risk-settings .ok:text-is("已保存")');
await p.reload();
await p.waitForSelector('button[aria-label="矩阵 5 5"]');
if (await p.textContent('button[aria-label="矩阵 1 1"]') !== '中') throw new Error('矩阵未保存');
if (await p.inputValue('tr[data-rule="PROJECT:HIGH"] input[aria-label=复查周期]') !== '7') throw new Error('规则未保存');
step('风险管理设置：5 × 5 矩阵、改格子、改规则，保存后生效');

// 两次 400 是故意触发的校验（未写成本收益分析、未写接受理由）
const real = errors.filter((e) => !e.includes('400 (Bad Request)'));
if (real.length) throw new Error(real.join('\n'));
await b.close();
console.log('risks: all passed');
