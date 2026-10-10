// 多个标签页同时刷新（同时恢复登录）不会被登出
import { launch, step, signup } from './lib.mjs';
const WEB = process.env.WEB_URL ?? 'http://localhost:4200';
const { b, p } = await launch();
const slug = 'mt' + Date.now().toString(36);
await p.goto(WEB + '/');
await p.waitForURL('**/login');
await signup(p, slug);
step('注册企业并登录');
// 用登录后的 Cookie 开一个新的浏览器窗口（同一窗口内的标签页共享 Cookie）
const ctx = await b.newContext({ storageState: await p.context().storageState(), viewport: { width: 1360, height: 900 } });
const tabs = [await ctx.newPage(), await ctx.newPage(), await ctx.newPage(), await ctx.newPage()];
// 所有标签页同时打开：每个都会用同一个刷新令牌 Cookie 去换访问令牌
await Promise.all(tabs.map((t) => t.goto(WEB + '/')));
await Promise.all(tabs.map((t) => t.waitForLoadState('networkidle')));
for (const t of tabs) {
  if (new URL(t.url()).pathname.startsWith('/login')) throw new Error('有标签页被登出：' + t.url());
}
step('4 个标签页同时打开，全部保持登录');
// 再一起刷新一次，确认最后留下的 Cookie 仍然有效
await Promise.all(tabs.map((t) => t.reload()));
await Promise.all(tabs.map((t) => t.waitForLoadState('networkidle')));
for (const t of tabs) {
  if (new URL(t.url()).pathname.startsWith('/login')) throw new Error('第二轮刷新后有标签页被登出：' + t.url());
}
step('4 个标签页同时刷新，全部保持登录');
await b.close();
console.log('multitab: all passed');
