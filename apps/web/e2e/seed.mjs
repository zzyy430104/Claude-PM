// 通过 API 快速准备测试数据
const API = process.env.API_URL ?? 'http://localhost:3000';
export async function call(method, path, token, body) {
  const r = await fetch(API + path, {
    method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  if (!r.ok) throw new Error(`${method} ${path} -> ${r.status} ${text}`);
  return json;
}
export async function seedTenant(slug) {
  await call('POST', '/auth/signup', null, { tenantName: '演示企业', tenantSlug: slug, adminEmail: 'admin@demo.test', adminName: '张管理', password: 'demo-pass-123' });
  const admin = await call('POST', '/auth/login', null, { tenantSlug: slug, email: 'admin@demo.test', password: 'demo-pass-123' });
  const users = {};
  for (const [key, name, role] of [['pm', '李经理', 'PROJECT_MANAGER'], ['pqm', '赵质量', 'PROJECT_QUALITY_MANAGER'], ['member', '王成员', 'MEMBER'], ['top', '钱总', 'TOP_MANAGEMENT']]) {
    const email = `${key}@demo.test`;
    const u = await call('POST', '/users', admin.accessToken, { email, name, password: 'demo-pass-123', role });
    const l = await call('POST', '/auth/login', null, { tenantSlug: slug, email, password: 'demo-pass-123' });
    users[key] = { id: u.id, email, name, access: l.accessToken, refresh: l.refreshToken };
  }
  users.admin = { access: admin.accessToken, refresh: admin.refreshToken, email: 'admin@demo.test', name: '张管理' };
  return users;
}
export async function seedProject(u, extra = {}, baseline = true) {
  const tpl = await call('POST', '/phase-templates', u.admin.access, {
    name: 'gate-' + Date.now(), phases: [
      { name: '设计', checklist: ['设计评审完成'], mandatoryRoles: ['PROJECT_MANAGER'] },
      { name: '制造', checklist: ['首件合格'], mandatoryRoles: ['PROJECT_MANAGER', 'PROJECT_QUALITY_MANAGER'] },
      { name: '交付', checklist: [], mandatoryRoles: [] }],
  });
  const p = await call('POST', '/projects', u.pm.access, {
    code: 'C-' + Date.now().toString(36), name: '评审演示项目', riskLevel: 'MEDIUM', startDate: '2026-03-02', endDate: '2026-12-31',
    budget: 1000000, customerDeliveryDate: '2026-12-15', templateId: tpl.id, ...extra,
  });
  await call('POST', `/projects/${p.id}/members`, u.pm.access, { userId: u.pqm.id, projectRole: 'PROJECT_QUALITY_MANAGER' });
  await call('POST', `/projects/${p.id}/members`, u.pm.access, { userId: u.member.id, projectRole: 'MEMBER' });
  if (baseline) await call('POST', `/projects/${p.id}/baseline`, u.pm.access);
  return p;
}
