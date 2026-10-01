// 改造第一步“底座调整”：新菜单、项目内 7 组导航（网址保留所在页）、职能角色、系统名称、投标已删除
import { launch, step, loginAs, openProject, tab, WEB } from './lib.mjs';
import { seedTenant, seedProject } from './seed.mjs';

const u = await seedTenant('fd-' + Date.now().toString(36));
const proj = await seedProject(u);
const { b, p, errors } = await launch();

await loginAs(p, u.admin);
const nav = await p.locator('mat-sidenav').innerText();
for (const t of ['我的工作台', '项目', '资源', '知识库', '经验教训', '模板', '管理', '用户与角色', '企业设置', '审计']) if (!nav.includes(t)) throw new Error('菜单缺少 ' + t + '：' + nav);
if (nav.includes('投标')) throw new Error('菜单里不应再有投标');
step('管理员菜单：工作台、项目、资源、知识库、管理');
await p.goto(`${WEB}/tenders`); await p.waitForSelector('mat-toolbar');
if (new URL(p.url()).pathname !== '/') throw new Error('/tenders 应回到首页');
step('投标页面已删除');

// 系统名称
await p.click('mat-sidenav a:text-is("企业设置")');
await p.fill('input[formcontrolname=systemName]', '华东轨道 PMS');
await p.fill('input[formcontrolname=companyName]', '华东轨道装备有限公司');
await p.click('button:has-text("保存")');
await p.waitForSelector('text=已保存');
await p.waitForSelector('mat-toolbar .brand:text-is("华东轨道 PMS")');
await p.waitForSelector('mat-toolbar .company:text-is("华东轨道装备有限公司")');
await p.reload(); await p.waitForSelector('mat-toolbar .brand:text-is("华东轨道 PMS")');
step('修改系统名称和企业名称，顶栏立即更新，刷新后保持');

// 职能角色
await p.click('mat-sidenav a:text-is("用户与角色")');
await p.click('.stabs [role=tab]:text-is("职能角色")');
await p.waitForSelector('input[aria-label="角色名称 技术"]');
await p.fill('input[aria-label="角色名称 技术"]', '技术工程师');
await p.press('input[aria-label="角色名称 技术"]', 'Enter');
await p.locator('input[aria-label="角色名称 技术"]').evaluate((el) => el.blur());
await p.waitForSelector('input[aria-label="角色名称 技术工程师"]');
await p.fill('mat-form-field:has-text("新角色名称") input', '软件');
await p.click('button:has-text("新增角色")');
await p.waitForSelector('input[aria-label="角色名称 软件"]');
step('职能角色改名、新增');
await p.click('.stabs [role=tab]:text-is("用户")');
const row = p.locator('tr:has-text("王成员")');
await row.locator('mat-select[aria-label="职能角色"]').click({ force: true });
await p.click('mat-option:has-text("技术工程师")');
await p.waitForSelector('tr:has-text("王成员") mat-select[aria-label="职能角色"]:has-text("技术工程师")');
await p.reload(); await p.waitForSelector('tr:has-text("王成员") mat-select[aria-label="职能角色"]:has-text("技术工程师")');
step('给用户指定职能角色，刷新后保持');

// 项目内分组导航
await loginAs(p, u.pm);
await openProject(p, proj.code);
const groups = await p.locator('.gtabs [role=tab]').allInnerTexts();
if (groups.join('|') !== '总览|计划|执行|控制|质量|沟通|收尾') throw new Error('分组不对：' + groups.join('|'));
step('项目内 7 组：总览、计划、执行、控制、质量、沟通、收尾');
await tab(p, '风险与机会');
if (!p.url().includes('g=ctrl') || !p.url().includes('s=risks')) throw new Error('网址没有记录所在页：' + p.url());
await p.reload();
await p.waitForFunction(() => [...document.querySelectorAll('.stabs [role=tab]')].some((t) => t.textContent.trim() === '风险与机会' && t.getAttribute('aria-selected') === 'true'));
step('子页记在网址里，刷新后仍在“控制 → 风险与机会”');
await tab(p, '阶段');
await p.waitForSelector('text=关口评审'); step('“执行 → 阶段与评审”同时显示阶段和关口评审');
await tab(p, '文档');
await p.waitForSelector('text=配置项'); step('“质量 → 文档与配置”同时显示文档和配置管理');

console.log('浏览器错误:', errors.length ? errors : '无');
await b.close();
if (errors.length) process.exit(1);
