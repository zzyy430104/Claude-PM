// 修改密码与管理员重置密码
import { launch, step, signup, logout, addUser, changePassword, WEB } from './lib.mjs';
const slug = 'pw-' + Date.now().toString(36);
const { b, p, errors } = await launch();
const loginForm = async (email, password) => {
  await p.goto(`${WEB}/login`);
  await p.fill('input[formcontrolname=tenantSlug]', slug);
  await p.fill('input[formcontrolname=email]', email);
  await p.fill('input[formcontrolname=password]', password);
  await p.click('button:has-text("登录")');
};

await signup(p, slug); step('注册企业');
await addUser(p, '周工', 'zhou@demo.test', 'initial-pass-1', '成员（只读）');
if (!(await p.locator('tr:has-text("周工") >> text=待本人改密').count())) throw new Error('新用户应标记为待本人改密');
step('新用户标记为待本人改密');
await logout(p);

await loginForm('zhou@demo.test', 'initial-pass-1');
await p.waitForURL('**/account');
await p.waitForSelector('text=你的密码是管理员设置的');
await p.goto(`${WEB}/projects`);
await p.waitForURL('**/account'); step('改密前访问其他页面被带回改密页');

await changePassword(p, 'wrong-pass-1', 'zhou-own-pass');
await p.waitForSelector('text=当前密码不正确'); step('当前密码错误有提示');
await p.fill('input[formcontrolname=currentPassword]', 'initial-pass-1');
await p.fill('input[formcontrolname=newPassword]', 'zhou-own-pass');
await p.fill('input[formcontrolname=confirm]', 'zhou-other');
if (!(await p.locator('button:has-text("修改密码")').isDisabled())) throw new Error('两次不一致时应不能提交');
await p.waitForSelector('text=两次输入的新密码不一致'); step('两次输入不一致不能提交');
await changePassword(p, 'initial-pass-1', 'zhou-own-pass');
await p.waitForSelector('text=欢迎，周工'); step('改密后进入首页');
await logout(p);

await loginForm('zhou@demo.test', 'initial-pass-1');
await p.waitForSelector('text=企业标识、邮箱或密码不正确'); step('旧密码失效');

await loginForm('admin@demo.test', 'demo-pass-123');
await p.waitForSelector('text=欢迎，张管理');
await p.click('a:has-text("用户与角色")');
await p.click('tr:has-text("周工") >> button:has-text("重置密码")');
await p.fill('input[aria-label=新的临时密码]', 'temp-pass-99');
await p.click('button:has-text("确认重置")');
await p.waitForSelector('text=已重置 周工 的密码'); step('管理员重置密码');
await logout(p);

await loginForm('zhou@demo.test', 'zhou-own-pass');
await p.waitForSelector('text=企业标识、邮箱或密码不正确');
await loginForm('zhou@demo.test', 'temp-pass-99');
await p.waitForURL('**/account'); step('重置后用临时密码登录，并被要求改密');
await changePassword(p, 'temp-pass-99', 'zhou-new-pass');
await p.waitForSelector('text=欢迎，周工');

await p.click('a.who'); await p.waitForURL('**/account');
await changePassword(p, 'zhou-new-pass', 'zhou-new-pass-2');
await p.waitForSelector('text=密码已修改'); step('从个人设置主动修改密码');

console.log('浏览器错误:', errors.length ? errors : '无');
await b.close();
