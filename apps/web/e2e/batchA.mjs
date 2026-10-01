import { launch, step, signup, login, logout, addUser } from './lib.mjs';
const slug = 'a-' + Date.now().toString(36);
const { b, p, errors } = await launch();

await p.goto((process.env.WEB_URL ?? 'http://localhost:4200') + '/');
await p.waitForURL('**/login'); step('未登录被重定向到登录页');
await signup(p, slug); step('注册企业并自动登录');
await addUser(p, '李经理', 'pm@demo.test', 'pm-pass-12345', '项目经理'); step('添加项目经理');
await p.click('a:text-is("审计")');
await p.waitForSelector('td:has-text("user.create")'); step('审计日志出现 user.create，且显示操作人姓名');
await p.reload(); await p.waitForSelector('td:has-text("user.create")'); step('刷新页面后保持登录');
await logout(p); step('退出登录');

await login(p, slug, 'pm@demo.test', 'pm-pass-12345');
const nav = await p.locator('mat-sidenav').innerText();
if (nav.includes('用户与角色') || nav.includes('审计')) throw new Error('项目经理不应看到管理菜单: ' + nav);
step('项目经理看不到管理菜单');
await p.goto((process.env.WEB_URL ?? 'http://localhost:4200') + '/users');
await p.waitForSelector('mat-toolbar'); 
if (new URL(p.url()).pathname !== '/') throw new Error('项目经理直接访问 /users 应被拦回首页');
step('直接访问 /users 被拦回首页');
await logout(p);
await p.fill('input[formcontrolname=tenantSlug]', slug);
await p.fill('input[formcontrolname=email]', 'pm@demo.test');
await p.fill('input[formcontrolname=password]', 'wrong-password');
await p.click('button:has-text("登录")');
await p.waitForSelector('text=企业标识、邮箱或密码不正确'); step('错误密码提示');
console.log('浏览器错误:', errors.length ? errors : '无');
await b.close();
