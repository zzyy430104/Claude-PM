import { chromium } from 'playwright-core';

export const WEB = process.env.WEB_URL ?? 'http://localhost:4200';
export async function launch() {
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--no-sandbox'] });
  const p = await b.newPage({ viewport: { width: 1360, height: 900 }, locale: 'zh-CN' });
  // 轮廓样式的下拉框，中央被浮动标签覆盖；点击标签会由表单字段容器转给下拉框，真实用户可以正常点开，
  // 但 Playwright 的命中检测会认为被遮挡，所以对 mat-select 强制点击
  const click = p.click.bind(p);
  p.click = async (sel, opts) => {
    if (/^mat-select/.test(sel)) {
      await p.waitForSelector('.cdk-overlay-backdrop', { state: 'detached', timeout: 3000 }).catch(() => {});
      return click(sel, { force: true, ...opts });
    }
    const r = await click(sel, opts);
    // 选完选项后等下拉面板的遮罩消失，避免下一次点击落在正在关闭的遮罩上
    if (/^mat-option/.test(sel)) await p.waitForSelector('.cdk-overlay-backdrop', { state: 'detached', timeout: 3000 }).catch(() => {});
    return r;
  };
  const errors = [];
  p.on('pageerror', e => errors.push('pageerror: ' + e.message));
  p.on('console', m => { if (m.type() === 'error' && !/ERR_CERT|401|403|404|409/.test(m.text())) errors.push('console: ' + m.text()); });
  return { b, p, errors };
}
export const step = (s) => console.log('✔', s);
export async function signup(p, slug, adminEmail = 'admin@demo.test') {
  await p.goto(`${WEB}/signup`);
  await p.fill('input[formcontrolname=tenantName]', '演示企业');
  await p.fill('input[formcontrolname=tenantSlug]', slug);
  await p.fill('input[formcontrolname=adminName]', '张管理');
  await p.fill('input[formcontrolname=adminEmail]', adminEmail);
  await p.fill('input[formcontrolname=password]', 'demo-pass-123');
  await p.click('button:has-text("创建企业并登录")');
  await p.waitForSelector('text=欢迎，张管理');
}
export async function login(p, slug, email, password) {
  await p.goto(`${WEB}/login`);
  await p.fill('input[formcontrolname=tenantSlug]', slug);
  await p.fill('input[formcontrolname=email]', email);
  await p.fill('input[formcontrolname=password]', password);
  await p.click('button:has-text("登录")');
  await p.waitForSelector('mat-toolbar');
  await p.waitForTimeout(300);
  // 管理员建的账号首次登录会被带到改密页：改成临时密码再改回原密码，后续脚本照常使用原密码
  if (p.url().includes('/account')) {
    await changePassword(p, password, password + '-tmp');
    await p.waitForURL((u) => !u.pathname.startsWith('/account'));
    await p.goto(`${WEB}/account`);
    await changePassword(p, password + '-tmp', password);
    await p.waitForSelector('text=密码已修改');
    await p.goto(`${WEB}/`);
    await p.waitForSelector('mat-toolbar');
  }
}
export async function changePassword(p, current, next) {
  await p.fill('input[formcontrolname=currentPassword]', current);
  await p.fill('input[formcontrolname=newPassword]', next);
  await p.fill('input[formcontrolname=confirm]', next);
  await p.click('button[type=submit]:has-text("修改密码")');
}
export async function logout(p) {
  await p.click('button:has-text("退出")');
  await p.waitForURL('**/login');
}
export async function addUser(p, name, email, password, roleLabel) {
  await p.click('a:has-text("用户管理")');
  await p.fill('input[formcontrolname=name]', name);
  await p.fill('input[formcontrolname=email]', email);
  await p.fill('input[formcontrolname=password]', password);
  await p.click('mat-select[formcontrolname=role]');
  await p.click(`mat-option:has-text("${roleLabel}")`);
  await p.click('button:has-text("添加用户")');
  await p.waitForSelector(`td:has-text("${email}")`);
}

/** 用真实的登录表单登录（令牌只在内存和 httpOnly Cookie 里，没有别的捷径） */
export async function loginAs(p, user) {
  // 先清掉上一个用户的登录状态：Cookie 会话不会因为换页面而消失
  await p.context().clearCookies();
  await p.goto(`${WEB}/login`);
  await p.waitForSelector('input[formcontrolname=email]');
  await p.fill('input[formcontrolname=tenantSlug]', user.slug ?? '');
  await p.fill('input[formcontrolname=email]', user.email);
  await p.fill('input[formcontrolname=password]', user.password);
  await p.click('button:has-text("登录")');
  await p.waitForSelector('mat-toolbar');
}
export async function openProject(p, code) {
  await p.click('mat-sidenav a:text-is("项目")');
  await p.click(`a:has-text("${code}")`);
  await p.waitForSelector(`h1:has-text("${code}")`);
}
export async function tab(p, label) {
  await p.click(`[role=tab]:has-text("${label}")`);
  await p.waitForFunction((l) => [...document.querySelectorAll('[role=tab]')].some((t) => t.textContent.includes(l) && t.getAttribute('aria-selected') === 'true'), label);
  await p.waitForTimeout(300);
}
