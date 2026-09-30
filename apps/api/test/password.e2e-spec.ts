import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { bearer, CSRF, cookieOf, createApp, signupTenant, uid, USER_PASSWORD } from './helpers.js';

describe('修改与重置密码', () => {
  let app: INestApplication;
  const http = () => request(app.getHttpServer());
  beforeAll(async () => {
    app = await createApp();
  });
  afterAll(() => app.close());

  const login = (slug: string, email: string, password: string) =>
    http().post('/auth/login').send({ tenantSlug: slug, email, password });

  it('管理员建的账号首次登录只能改密，改密后恢复正常', async () => {
    const t = await signupTenant(app, 'pw1');
    const email = `u-${uid()}@pw.test`;
    await http().post('/users').set(bearer(t.token)).send({ email, name: 'U', password: 'initial-123', role: 'MEMBER' }).expect(201);
    const first = await login(t.slug, email, 'initial-123').expect(200);
    const me = await http().get('/me').set(bearer(first.body.accessToken)).expect(200);
    expect(me.body.mustChangePassword).toBe(true);
    const blocked = await http().get('/projects').set(bearer(first.body.accessToken)).expect(403);
    expect(blocked.body.code).toBe('PASSWORD_CHANGE_REQUIRED');

    const changed = await http().post('/auth/change-password').set(bearer(first.body.accessToken))
      .send({ currentPassword: 'initial-123', newPassword: USER_PASSWORD }).expect(200);
    await http().get('/projects').set(bearer(changed.body.accessToken)).expect(200);
    const me2 = await http().get('/me').set(bearer(changed.body.accessToken)).expect(200);
    expect(me2.body.mustChangePassword).toBe(false);
    await login(t.slug, email, 'initial-123').expect(401);
    await login(t.slug, email, USER_PASSWORD).expect(200);
  });

  it('当前密码错误、新旧相同、新密码太短都被拒绝', async () => {
    const t = await signupTenant(app, 'pw2');
    const bad = await http().post('/auth/change-password').set(bearer(t.token))
      .send({ currentPassword: 'wrong-password', newPassword: 'another-pass-1' }).expect(400);
    expect(bad.body.code).toBe('WRONG_PASSWORD');
    const same = await http().post('/auth/change-password').set(bearer(t.token))
      .send({ currentPassword: t.password, newPassword: t.password }).expect(400);
    expect(same.body.code).toBe('SAME_PASSWORD');
    await http().post('/auth/change-password').set(bearer(t.token))
      .send({ currentPassword: t.password, newPassword: 'short' }).expect(400);
    await login(t.slug, t.adminEmail, t.password).expect(200);
  });

  it('改密后其他设备的刷新令牌失效', async () => {
    const t = await signupTenant(app, 'pw3');
    const other = await login(t.slug, t.adminEmail, t.password).expect(200);
    await http().post('/auth/change-password').set(bearer(t.token))
      .send({ currentPassword: t.password, newPassword: 'brand-new-pass' }).expect(200);
    await http().post('/auth/refresh').set(CSRF).set('Cookie', cookieOf(other)).expect(401);
  });

  it('管理员重置密码后，用户旧密码失效且必须改密；自助注册的管理员不需要改密', async () => {
    const t = await signupTenant(app, 'pw4');
    const me = await http().get('/me').set(bearer(t.token)).expect(200);
    expect(me.body.mustChangePassword).toBe(false);
    const email = `r-${uid()}@pw.test`;
    const u = await http().post('/users').set(bearer(t.token)).send({ email, name: 'R', password: 'initial-123', role: 'MEMBER' }).expect(201);
    const s = await login(t.slug, email, 'initial-123').expect(200);
    await http().post('/auth/change-password').set(bearer(s.body.accessToken)).send({ currentPassword: 'initial-123', newPassword: 'mine-12345' }).expect(200);

    await http().patch(`/users/${u.body.id}`).set(bearer(t.token)).send({ password: 'reset-12345' }).expect(200);
    await login(t.slug, email, 'mine-12345').expect(401);
    const again = await login(t.slug, email, 'reset-12345').expect(200);
    const me2 = await http().get('/me').set(bearer(again.body.accessToken)).expect(200);
    expect(me2.body.mustChangePassword).toBe(true);
  });

  it('普通用户不能重置别人的密码', async () => {
    const t = await signupTenant(app, 'pw5');
    const email = `m-${uid()}@pw.test`;
    const u = await http().post('/users').set(bearer(t.token)).send({ email, name: 'M', password: 'initial-123', role: 'MEMBER' }).expect(201);
    const s = await login(t.slug, email, 'initial-123').expect(200);
    const c = await http().post('/auth/change-password').set(bearer(s.body.accessToken)).send({ currentPassword: 'initial-123', newPassword: 'mine-12345' }).expect(200);
    const admin = await http().get('/me').set(bearer(t.token)).expect(200);
    await http().patch(`/users/${admin.body.id}`).set(bearer(c.body.accessToken)).send({ password: 'hijack-12345' }).expect(403);
    expect(u.body.id).toBeTruthy();
  });
});
