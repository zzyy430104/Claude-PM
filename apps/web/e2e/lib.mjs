import { chromium } from 'playwright-core';

export const WEB = process.env.WEB_URL ?? 'http://localhost:4200';
export async function launch() {
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--no-sandbox'] });
  const p = await b.newPage({ viewport: { width: 1360, height: 900 }, locale: 'zh-CN' });
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

/** 直接写入令牌，免去表单登录 */
export async function loginAs(p, user) {
  await p.goto(`${WEB}/login`);
  await p.evaluate(([a, r]) => { localStorage.setItem('pm.access', a); localStorage.setItem('pm.refresh', r); }, [user.access, user.refresh]);
  await p.goto(`${WEB}/`);
  await p.waitForSelector('mat-toolbar');
}
export async function openProject(p, code) {
  await p.click('a:has-text("项目")');
  await p.click(`a:has-text("${code}")`);
  await p.waitForSelector(`h1:has-text("${code}")`);
}
export async function tab(p, label) {
  await p.click(`[role=tab]:has-text("${label}")`);
  await p.waitForFunction((l) => [...document.querySelectorAll('[role=tab]')].some((t) => t.textContent.includes(l) && t.getAttribute('aria-selected') === 'true'), label);
  await p.waitForTimeout(300);
}
