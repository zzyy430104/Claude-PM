import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { bearer, createApp, signupTenant } from './helpers.js';

describe('认证', () => {
  let app: INestApplication;
  beforeAll(async () => {
    app = await createApp();
  });
  afterAll(() => app.close());

  it('健康检查无需登录', async () => {
    await request(app.getHttpServer()).get('/health').expect(200);
  });

  it('未登录访问受保护接口返回 401', async () => {
    await request(app.getHttpServer()).get('/me').expect(401);
    await request(app.getHttpServer()).get('/users').expect(401);
  });

  it('注册租户后可登录并读取当前用户', async () => {
    const t = await signupTenant(app, 'auth');
    const me = await request(app.getHttpServer())
      .get('/me')
      .set(bearer(t.token))
      .expect(200);
    expect(me.body.email).toBe(t.adminEmail);
    expect(me.body.role).toBe('TENANT_ADMIN');
  });

  it('错误密码或不存在的租户统一返回 401', async () => {
    const t = await signupTenant(app, 'badpw');
    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ tenantSlug: t.slug, email: t.adminEmail, password: 'wrong-password' })
      .expect(401);
    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ tenantSlug: 'no-such-tenant', email: t.adminEmail, password: t.password })
      .expect(401);
  });

  it('同一邮箱可在不同租户各自注册', async () => {
    const a = await signupTenant(app, 'same-a');
    const res = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({
        tenantName: 'Other',
        tenantSlug: `other-${a.slug}`.slice(0, 40),
        adminEmail: a.adminEmail,
        adminName: 'Admin',
        password: 'admin-pass-123',
      });
    expect(res.status).toBe(201);
  });

  it('租户标识重复返回 409', async () => {
    const t = await signupTenant(app, 'dup');
    await request(app.getHttpServer())
      .post('/auth/signup')
      .send({
        tenantName: 'Dup',
        tenantSlug: t.slug,
        adminEmail: 'x@example.test',
        adminName: 'X',
        password: 'admin-pass-123',
      })
      .expect(409);
  });

  it('刷新令牌一次性使用，登出后失效', async () => {
    const t = await signupTenant(app, 'refresh');
    const r1 = await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken: t.refreshToken })
      .expect(200);
    // 旧令牌已作废
    await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken: t.refreshToken })
      .expect(401);
    await request(app.getHttpServer())
      .post('/auth/logout')
      .set(bearer(r1.body.accessToken))
      .send({})
      .expect(204);
    await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken: r1.body.refreshToken })
      .expect(401);
  });

  it('平台管理员可登录，但不能访问租户业务数据', async () => {
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'root@platform.test', password: 'platform-pass-1' })
      .expect(200);
    const token = login.body.accessToken;
    await request(app.getHttpServer())
      .get('/platform/tenants')
      .set(bearer(token))
      .expect(200);
    await request(app.getHttpServer())
      .get('/users')
      .set(bearer(token))
      .expect(403);
    await request(app.getHttpServer())
      .get('/audit-logs')
      .set(bearer(token))
      .expect(403);
  });

  it('租户管理员不能访问平台接口', async () => {
    const t = await signupTenant(app, 'noplat');
    await request(app.getHttpServer())
      .get('/platform/tenants')
      .set(bearer(t.token))
      .expect(403);
  });

  it('租户被平台停用后，其用户的令牌立即失效', async () => {
    const t = await signupTenant(app, 'suspend');
    const root = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'root@platform.test', password: 'platform-pass-1' })
      .expect(200);
    const list = await request(app.getHttpServer())
      .get('/platform/tenants')
      .set(bearer(root.body.accessToken))
      .expect(200);
    const tenant = list.body.find((x: { slug: string }) => x.slug === t.slug);
    await request(app.getHttpServer())
      .patch(`/platform/tenants/${tenant.id}`)
      .set(bearer(root.body.accessToken))
      .send({ active: false })
      .expect(200);
    await request(app.getHttpServer()).get('/me').set(bearer(t.token)).expect(401);
    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ tenantSlug: t.slug, email: t.adminEmail, password: t.password })
      .expect(401);
  });
});
