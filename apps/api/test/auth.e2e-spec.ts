import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { bearer, CSRF, cookieOf, createApp, signupTenant, uid } from './helpers.js';

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

  it('刷新令牌只放在 httpOnly Cookie 里，响应体不含刷新令牌', async () => {
    const t = await signupTenant(app, 'cookie');
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ tenantSlug: t.slug, email: t.adminEmail, password: t.password })
      .expect(200);
    expect(res.body).not.toHaveProperty('refreshToken');
    expect(res.body.accessToken).toBeTruthy();
    const cookie = (res.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith('pm_rt='))!;
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Strict');
  });

  it('刷新令牌一次性使用，登出后失效；必须带 CSRF 请求头', async () => {
    process.env.REFRESH_REUSE_GRACE_SECONDS = '0'; // 关掉宽限期，验证严格一次性
    onTestFinished(() => {
      delete process.env.REFRESH_REUSE_GRACE_SECONDS;
    });
    const t = await signupTenant(app, 'refresh');
    const refresh = (cookie: string, csrf = true) => {
      let r = request(app.getHttpServer()).post('/auth/refresh').set('Cookie', cookie);
      if (csrf) r = r.set(CSRF);
      return r;
    };
    await refresh(t.refreshCookie, false).expect(403); // 没有 CSRF 头
    await request(app.getHttpServer()).post('/auth/refresh').set(CSRF).expect(401); // 没有 Cookie

    const r1 = await refresh(t.refreshCookie).expect(200);
    const next = cookieOf(r1);
    expect(next).not.toBe(t.refreshCookie);
    // 旧令牌已作废；因为只是被轮换，不清 Cookie（浏览器里可能已是别的标签页拿到的新令牌）
    await new Promise((r) => setTimeout(r, 5));
    const reused = await refresh(t.refreshCookie).expect(401);
    expect(((reused.headers['set-cookie'] as unknown as string[]) ?? []).some((c) => c.startsWith('pm_rt=;'))).toBe(false);
    await request(app.getHttpServer())
      .post('/auth/logout')
      .set('Cookie', next)
      .set(bearer(r1.body.accessToken))
      .send({})
      .expect(204);
    await refresh(next).expect(401);
  });

  it('多个标签页同时用同一个 Cookie 刷新：全部成功，不会被登出', async () => {
    const t = await signupTenant(app, 'multitab');
    const refresh = () => request(app.getHttpServer()).post('/auth/refresh').set('Cookie', t.refreshCookie).set(CSRF);
    const results = await Promise.all([refresh(), refresh(), refresh(), refresh(), refresh()]);
    for (const r of results) {
      expect(r.status).toBe(200);
      expect(r.body.accessToken).toBeTruthy();
      const next = cookieOf(r);
      expect(next).not.toBe(t.refreshCookie);
      // 每个标签页拿到的新令牌都能继续用
      await request(app.getHttpServer()).post('/auth/refresh').set('Cookie', next).set(CSRF).expect(200);
    }
  });

  it('宽限期内，登出之后旧令牌也不能再换新', async () => {
    const t = await signupTenant(app, 'gracelogout');
    const r1 = await request(app.getHttpServer()).post('/auth/refresh').set('Cookie', t.refreshCookie).set(CSRF).expect(200);
    await request(app.getHttpServer())
      .post('/auth/logout')
      .set('Cookie', cookieOf(r1))
      .set(bearer(r1.body.accessToken))
      .send({})
      .expect(204);
    await request(app.getHttpServer()).post('/auth/refresh').set('Cookie', t.refreshCookie).set(CSRF).expect(401);
  });

  it('连续输错密码会被限流，登录成功后清零', async () => {
    const t = await signupTenant(app, 'ratelimit');
    process.env.RATE_LIMIT_LOGIN_PER_ACCOUNT = '3';
    try {
      const login = (password: string) =>
        request(app.getHttpServer()).post('/auth/login').send({ tenantSlug: t.slug, email: t.adminEmail, password });
      await login('wrong-1').expect(401);
      await login('wrong-2').expect(401);
      await login(t.password).expect(200); // 成功后清零
      await login('wrong-3').expect(401);
      await login('wrong-4').expect(401);
      await login('wrong-5').expect(401);
      await login(t.password).expect(429); // 已达上限，连正确密码也拒绝
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ tenantSlug: t.slug, email: 'other@' + t.slug + '.test', password: 'x'.repeat(8) })
        .expect(401); // 其他账号不受影响
    } finally {
      process.env.RATE_LIMIT_LOGIN_PER_ACCOUNT = '1000';
    }
  });

  it('自助注册按 IP 限流', async () => {
    process.env.RATE_LIMIT_SIGNUP_PER_IP = '2';
    try {
      const body = (n: number) => ({ tenantName: 'RL', tenantSlug: `rl-${uid()}-${n}`, adminEmail: `a${n}@rl.test`, adminName: 'A', password: 'admin-pass-123' });
      // 先用掉此前测试可能累计的次数：只关心在上限内外的差异
      let blocked = 0;
      for (let i = 0; i < 6; i++) {
        const r = await request(app.getHttpServer()).post('/auth/signup').send(body(i));
        if (r.status === 429) blocked++;
      }
      expect(blocked).toBeGreaterThan(0);
    } finally {
      process.env.RATE_LIMIT_SIGNUP_PER_IP = '100000';
    }
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
