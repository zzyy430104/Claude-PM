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
  // 老脚本直接建项目：打开“小项目免立项”（立项流程见 initiation.mjs）
  await call('PATCH', '/tenant-settings', admin.accessToken, { allowDirectProject: true });
  const users = {};
  for (const [key, name, role] of [['pm', '李经理', 'PROJECT_MANAGER'], ['pqm', '赵质量', 'PROJECT_QUALITY_MANAGER'], ['member', '王成员', 'MEMBER'], ['top', '钱总', 'TOP_MANAGEMENT']]) {
    const email = `${key}@demo.test`;
    const u = await call('POST', '/users', admin.accessToken, { email, name, password: 'demo-pass-123', role });
    const first = await call('POST', '/auth/login', null, { tenantSlug: slug, email, password: 'demo-pass-123' });
    // 管理员建的账号必须先改密；测试里改成临时密码再改回来，保持密码不变
    const tmp = await call('POST', '/auth/change-password', first.accessToken, { currentPassword: 'demo-pass-123', newPassword: 'demo-pass-tmp' });
    const l = await call('POST', '/auth/change-password', tmp.accessToken, { currentPassword: 'demo-pass-tmp', newPassword: 'demo-pass-123' });
    // access：用于通过接口造数据；slug / password：浏览器里走真实的登录表单
    users[key] = { id: u.id, email, name, access: l.accessToken, slug, password: 'demo-pass-123' };
  }
  users.admin = { access: admin.accessToken, email: 'admin@demo.test', name: '张管理', slug, password: 'demo-pass-123' };
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
