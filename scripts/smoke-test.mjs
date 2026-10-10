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

/** 管理员建的账号首次登录后改密，返回新的访问令牌 */
async function firstChange(token) {
  const r = await req('POST', '/auth/change-password', { token, body: { currentPassword: pw, newPassword: pw + '-changed' } });
  expectStatus(r, 200, '首次改密');
  return r.json.accessToken;
}

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
await check('企业管理员首次登录必须先改密', async () => {
  const r = await req('POST', '/auth/login', { body: { tenantSlug: slug, email: `admin@${slug}.test`, password: pw } });
  expectStatus(r, 200, '登录');
  expectStatus(await req('GET', '/projects', { token: r.json.accessToken }), 403, '改密前访问业务接口');
  state.admin = await firstChange(r.json.accessToken);
  expectStatus(await req('GET', '/projects', { token: state.admin }), 200, '改密后访问业务接口');
});
await check('平台管理员不能读取企业业务数据', async () => expectStatus(await req('GET', '/users', { token: state.platform }), 403));

console.log('\n3. 业务链路');
/** 企业管理员建用户，首次登录改密，返回 { id, token } */
async function newUser(key, name, role) {
  const u = await req('POST', '/users', { token: state.admin, body: { email: `${key}@${slug}.test`, name, password: pw, role } });
  expectStatus(u, 201, `创建${name}`);
  const l = await req('POST', '/auth/login', { body: { tenantSlug: slug, email: `${key}@${slug}.test`, password: pw } });
  expectStatus(l, 200, `${name}登录`);
  return { id: u.json.id, token: await firstChange(l.json.accessToken) };
}
await check('创建项目经理和高层管理并登录', async () => {
  const pm = await newUser('pm', '冒烟经理', 'PROJECT_MANAGER');
  state.pmId = pm.id; state.pm = pm.token;
  state.top = (await newUser('top', '冒烟高层', 'TOP_MANAGEMENT')).token;
});
await check('立项申请 → 提交 → 批准，生成项目、阶段和计划草稿', async () => {
  const quality = { standards: ['ISO/TS 22163'], special: '', acceptance: '出厂检验', fai: true, faiReason: '', customerWitness: false, drawingApproval: false, rams: false };
  const requirements = {
    deliveryDate: '2027-09-30', milestones: [], stockLines: [], risks: [{ text: '冒烟测试风险', kind: 'RISK' }], longLead: false, quality,
    deliverables: [{ name: '冒烟测试产品', quantity: '10 件', kind: 'PRODUCT' }], cost: { cap: 3000000, target: 2850000 },
  };
  const ini = await req('POST', '/initiations', { token: state.pm, body: { name: '冒烟测试项目', type: 'B', projectCode: `S-${stamp}`, customer: '冒烟客户', proposedPmId: state.pmId, startDate: '2026-11-02', requirements } });
  expectStatus(ini, 201, '立项申请');
  expectStatus(await req('POST', `/initiations/${ini.json.id}/submit`, { token: state.pm }), 200, '提交');
  const ok = await req('POST', `/initiations/${ini.json.id}/approve`, { token: state.top, body: {} });
  expectStatus(ok, 200, '批准'); state.project = ok.json.projectId;
  expect(state.project, '批准后没有生成项目');
  const ph = await req('GET', `/projects/${state.project}/phases`, { token: state.pm });
  expect(ph.json.length >= 5, `阶段数 ${ph.json.length}`);
  const w = await req('GET', `/projects/${state.project}/wbs`, { token: state.pm });
  expect(w.json.items.length > 0, '没有生成计划草稿');
});
await check('WBS 与关键路径', async () => {
  const a = await req('POST', `/projects/${state.project}/wbs`, { token: state.pm, body: { code: 'A', name: 'A', durationDays: 3 } });
  const b = await req('POST', `/projects/${state.project}/wbs`, { token: state.pm, body: { code: 'B', name: 'B', durationDays: 4 } });
  expectStatus(a, 201); expectStatus(b, 201);
  expectStatus(await req('POST', `/projects/${state.project}/dependencies`, { token: state.pm, body: { predecessorId: a.json.id, successorId: b.json.id } }), 201);
  const items = (await req('GET', `/projects/${state.project}/wbs`, { token: state.pm })).json.items;
  const A = items.find((x) => x.id === a.json.id); const B = items.find((x) => x.id === b.json.id);
  expect(B.scheduledStart > A.scheduledEnd, `B 应在 A 完成后开始：A 完成 ${A.scheduledEnd}，B 开始 ${B.scheduledStart}`);
  // 冒烟加的 A、B 不属于计划，删掉后再走计划审批
  for (const id of [b.json.id, a.json.id]) expectStatus(await req('DELETE', `/projects/${state.project}/wbs/${id}`, { token: state.pm }), 204, '删除工作包');
});
await check('计划提交审批并批准后，直接修改预算被拦截（需变更控制）', async () => {
  const roles = (await req('GET', '/functional-roles', { token: state.pm })).json;
  expectStatus(await req('POST', `/projects/${state.project}/wbs/assign-by-role`, { token: state.pm, body: { assignments: roles.map((r) => ({ functionalRoleId: r.id, userId: state.pmId })) } }), 200, '按角色分配');
  expectStatus(await req('POST', `/projects/${state.project}/plan-approval/submit`, { token: state.pm }), 200, '提交计划');
  const st = await req('POST', `/projects/${state.project}/plan-approval/approve`, { token: state.top });
  expectStatus(st, 200, '批准计划'); expect(st.json.baselined === true, JSON.stringify(st.json).slice(0, 200));
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
  const token2 = await firstChange(l.json.accessToken);
  const r = await req('GET', `/projects/${state.project}`, { token: token2 });
  expectStatus(r, 404);
  const list = await req('GET', '/projects', { token: token2 });
  expect(list.json.length === 0, '看到了别的企业的项目');
});

console.log('\n5. 清理');
for (const id of [state.tenantId, state.tenant2].filter(Boolean)) {
  await check(`停用测试企业 ${id.slice(0, 8)}`, async () => expectStatus(await req('PATCH', `/platform/tenants/${id}`, { token: state.platform, body: { active: false } }), 200));
}
await check('停用后该企业的令牌立即失效', async () => expectStatus(await req('GET', '/me', { token: state.admin }), 401));

console.log(failed ? `\n${failed} 项失败` : '\n全部通过');
process.exit(failed ? 1 : 0);
