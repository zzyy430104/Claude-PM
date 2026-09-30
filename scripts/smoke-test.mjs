#!/usr/bin/env node
// 部署冒烟测试：对已经部署好的站点走一遍核心链路，确认各部分连通。
//
// 用法：
//   PM_URL=http://localhost:8080 PM_ADMIN_EMAIL=admin@example.com PM_ADMIN_PASSWORD=... node scripts/smoke-test.mjs
//
// 会在站点里创建一个名为 smoke-<时间戳> 的测试企业，并把它停用，不会删除数据。
// 需要平台管理员账号（首次启动时按 PLATFORM_ADMIN_EMAIL / PLATFORM_ADMIN_PASSWORD 创建）。

const BASE = (process.env.PM_URL ?? 'http://localhost:8080').replace(/\/$/, '');
const API = `${BASE}/api`;
const ADMIN_EMAIL = process.env.PM_ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.PM_ADMIN_PASSWORD;
if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
  console.error('请设置 PM_ADMIN_EMAIL 和 PM_ADMIN_PASSWORD（平台管理员账号）');
  process.exit(2);
}

let failed = 0;
const ok = (name) => console.log(`  ✔ ${name}`);
const bad = (name, detail) => { failed++; console.log(`  ✘ ${name}\n      ${detail}`); };

async function req(method, path, { token, body, cookie, headers = {} } = {}) {
  const res = await fetch(API + path, {
    method, redirect: 'manual',
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}), ...(cookie ? { cookie } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, json, headers: res.headers };
}

async function check(name, fn) {
  try { await fn(); ok(name); } catch (e) { bad(name, e.message); }
}
const expect = (cond, msg) => { if (!cond) throw new Error(msg); };
const expectStatus = (r, code, what = '') => expect(r.status === code, `${what} 期望 ${code}，实际 ${r.status}：${JSON.stringify(r.json).slice(0, 200)}`);

const stamp = Date.now().toString(36);
const slug = `smoke-${stamp}`;
const pw = 'Smoke-pass-12345';
const state = {};

console.log(`冒烟测试：${BASE}`);

console.log('\n1. 基础');
await check('前端首页可访问', async () => {
  const r = await fetch(BASE + '/');
  expect(r.status === 200, `状态 ${r.status}`);
  expect((await r.text()).includes('<app-root'), '返回的不是前端页面');
});
await check('前端路由刷新不 404（回退到 index.html）', async () => {
  const r = await fetch(BASE + '/projects/some-id');
  expect(r.status === 200, `状态 ${r.status}`);
});
await check('安全响应头齐全', async () => {
  const r = await fetch(BASE + '/');
  for (const h of ['content-security-policy', 'x-content-type-options', 'x-frame-options']) expect(r.headers.has(h), `缺少 ${h}`);
});
await check('后端健康检查（含数据库连通）', async () => {
  const r = await req('GET', '/health');
  expectStatus(r, 200); expect(r.json.status === 'ok', JSON.stringify(r.json));
});
await check('未登录访问受保护接口返回 401', async () => expectStatus(await req('GET', '/projects'), 401));

console.log('\n2. 平台管理员与租户');
await check('平台管理员登录，刷新令牌通过 httpOnly Cookie 下发', async () => {
  const r = await req('POST', '/auth/login', { body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD } });
  expectStatus(r, 200, '登录');
  state.platform = r.json.accessToken;
  expect(!('refreshToken' in r.json), '响应体不应包含 refreshToken');
  const c = r.headers.get('set-cookie') ?? '';
  expect(/pm_rt=/.test(c) && /HttpOnly/i.test(c) && /SameSite=Strict/i.test(c), `Cookie 属性不对：${c}`);
  state.cookie = c.split(';')[0];
});
await check('刷新令牌换新访问令牌（必须带 CSRF 头）', async () => {
  expectStatus(await req('POST', '/auth/refresh', { cookie: state.cookie }), 403, '缺少 CSRF 头时');
  const r = await req('POST', '/auth/refresh', { cookie: state.cookie, headers: { 'x-requested-with': 'claude-pm' } });
  expectStatus(r, 200); expect(r.json.accessToken, '没有返回访问令牌');
});
await check('创建测试企业', async () => {
  const r = await req('POST', '/platform/tenants', { token: state.platform, body: { name: `冒烟测试 ${stamp}`, slug, adminEmail: `admin@${slug}.test`, adminName: '冒烟管理员', adminPassword: pw } });
  expectStatus(r, 201); state.tenantId = r.json.id;
});
await check('企业管理员登录', async () => {
  const r = await req('POST', '/auth/login', { body: { tenantSlug: slug, email: `admin@${slug}.test`, password: pw } });
  expectStatus(r, 200); state.admin = r.json.accessToken;
});
await check('平台管理员不能读取企业业务数据', async () => expectStatus(await req('GET', '/users', { token: state.platform }), 403));

console.log('\n3. 业务链路');
await check('创建项目经理并登录', async () => {
  const u = await req('POST', '/users', { token: state.admin, body: { email: `pm@${slug}.test`, name: '冒烟经理', password: pw, role: 'PROJECT_MANAGER' } });
  expectStatus(u, 201, '创建用户'); state.pmId = u.json.id;
  const l = await req('POST', '/auth/login', { body: { tenantSlug: slug, email: `pm@${slug}.test`, password: pw } });
  expectStatus(l, 200, '登录'); state.pm = l.json.accessToken;
});
await check('创建项目，自动生成 7 个阶段', async () => {
  const r = await req('POST', '/projects', { token: state.pm, body: { code: `S-${stamp}`, name: '冒烟测试项目', riskLevel: 'MEDIUM', startDate: '2026-01-05', endDate: '2026-12-31', budget: 100000 } });
  expectStatus(r, 201); state.project = r.json.id;
  const ph = await req('GET', `/projects/${state.project}/phases`, { token: state.pm });
  expect(ph.json.length === 7, `阶段数 ${ph.json.length}`);
});
await check('WBS 与关键路径', async () => {
  const a = await req('POST', `/projects/${state.project}/wbs`, { token: state.pm, body: { code: 'A', name: 'A', durationDays: 3 } });
  const b = await req('POST', `/projects/${state.project}/wbs`, { token: state.pm, body: { code: 'B', name: 'B', durationDays: 4 } });
  expectStatus(a, 201); expectStatus(b, 201);
  expectStatus(await req('POST', `/projects/${state.project}/dependencies`, { token: state.pm, body: { predecessorId: a.json.id, successorId: b.json.id } }), 201);
  const g = await req('GET', `/projects/${state.project}/wbs`, { token: state.pm });
  expect(g.json.projectDurationDays === 7, `总工期 ${g.json.projectDurationDays}`);
});
await check('建立基线后，直接修改预算被拦截（需变更控制）', async () => {
  expectStatus(await req('POST', `/projects/${state.project}/baseline`, { token: state.pm }), 200, '基线');
  const r = await req('PATCH', `/projects/${state.project}`, { token: state.pm, body: { budget: 1 } });
  expectStatus(r, 409); expect(r.json.code === 'CHANGE_REQUEST_REQUIRED', JSON.stringify(r.json));
});
await check('文档上传与下载', async () => {
  const fd = new FormData();
  fd.append('folder', '02-项目计划'); fd.append('name', '冒烟文档');
  fd.append('file', new Blob(['hello smoke'], { type: 'text/plain' }), 'smoke.txt');
  const up = await fetch(`${API}/projects/${state.project}/documents`, { method: 'POST', headers: { authorization: `Bearer ${state.pm}` }, body: fd });
  expect(up.status === 201, `上传状态 ${up.status}`);
  const doc = await up.json();
  const dl = await fetch(`${API}/projects/${state.project}/documents/${doc.id}/download`, { headers: { authorization: `Bearer ${state.pm}` } });
  expect(dl.status === 200 && (await dl.text()) === 'hello smoke', '下载内容不一致');
});
await check('审计日志有记录', async () => {
  const r = await req('GET', '/audit-logs?limit=5', { token: state.admin });
  expectStatus(r, 200); expect(r.json.length > 0, '没有审计记录');
});
await check('审核证据包可以导出（ZIP）', async () => {
  const res = await fetch(`${API}/projects/${state.project}/evidence-pack`, { headers: { authorization: `Bearer ${state.pm}` } });
  const buf = Buffer.from(await res.arrayBuffer());
  expect(res.status === 200 && buf.subarray(0, 2).toString() === 'PK', `状态 ${res.status}`);
});
await check('仪表盘与通知接口', async () => {
  expectStatus(await req('GET', '/dashboard', { token: state.pm }), 200);
  expectStatus(await req('GET', '/notifications/count', { token: state.pm }), 200);
});

console.log('\n4. 租户隔离');
await check('另一个企业看不到这个项目', async () => {
  const slug2 = `smoke2-${stamp}`;
  const t = await req('POST', '/platform/tenants', { token: state.platform, body: { name: `冒烟测试2 ${stamp}`, slug: slug2, adminEmail: `admin@${slug2}.test`, adminName: 'B', adminPassword: pw } });
  expectStatus(t, 201); state.tenant2 = t.json.id;
  const l = await req('POST', '/auth/login', { body: { tenantSlug: slug2, email: `admin@${slug2}.test`, password: pw } });
  const r = await req('GET', `/projects/${state.project}`, { token: l.json.accessToken });
  expectStatus(r, 404);
  const list = await req('GET', '/projects', { token: l.json.accessToken });
  expect(list.json.length === 0, '看到了别的企业的项目');
});

console.log('\n5. 清理');
for (const id of [state.tenantId, state.tenant2].filter(Boolean)) {
  await check(`停用测试企业 ${id.slice(0, 8)}`, async () => expectStatus(await req('PATCH', `/platform/tenants/${id}`, { token: state.platform, body: { active: false } }), 200));
}
await check('停用后该企业的令牌立即失效', async () => expectStatus(await req('GET', '/me', { token: state.admin }), 401));

console.log(failed ? `\n${failed} 项失败` : '\n全部通过');
process.exit(failed ? 1 : 0);
