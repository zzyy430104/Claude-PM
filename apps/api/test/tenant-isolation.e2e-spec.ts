import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { bearer, createApp, signupTenant } from './helpers.js';

describe('多租户隔离与用户管理', () => {
  let app: INestApplication;
  beforeAll(async () => {
    app = await createApp();
  });
  afterAll(() => app.close());

  const http = () => request(app.getHttpServer());

  it('租户 A 看不到、也改不了租户 B 的用户', async () => {
    const a = await signupTenant(app, 'iso-a');
    const b = await signupTenant(app, 'iso-b');

    const bUser = await http()
      .post('/users')
      .set(bearer(b.token))
      .send({
        email: 'pm@b.test',
        name: 'B PM',
        password: 'password-123',
        role: 'PROJECT_MANAGER',
      })
      .expect(201);

    const listA = await http().get('/users').set(bearer(a.token)).expect(200);
    expect(listA.body.map((u: { email: string }) => u.email)).not.toContain(
      'pm@b.test',
    );

    await http()
      .get(`/users/${bUser.body.id}`)
      .set(bearer(a.token))
      .expect(404);
    await http()
      .patch(`/users/${bUser.body.id}`)
      .set(bearer(a.token))
      .send({ active: false })
      .expect(404);

    // B 的用户数据未被改动
    const still = await http()
      .get(`/users/${bUser.body.id}`)
      .set(bearer(b.token))
      .expect(200);
    expect(still.body.active).toBe(true);
  });

  it('审计日志只包含本租户的记录', async () => {
    const a = await signupTenant(app, 'aud-a');
    const b = await signupTenant(app, 'aud-b');
    await http()
      .post('/users')
      .set(bearer(b.token))
      .send({
        email: 'x@b.test',
        name: 'X',
        password: 'password-123',
        role: 'MEMBER',
      })
      .expect(201);

    const logsA = await http().get('/audit-logs').set(bearer(a.token)).expect(200);
    const logsB = await http().get('/audit-logs').set(bearer(b.token)).expect(200);
    const emailsInA = JSON.stringify(logsA.body);
    expect(emailsInA).not.toContain('x@b.test');
    expect(JSON.stringify(logsB.body)).toContain('x@b.test');
  });

  it('只有租户管理员能创建用户，普通角色返回 403', async () => {
    const t = await signupTenant(app, 'rbac');
    await http()
      .post('/users')
      .set(bearer(t.token))
      .send({
        email: 'member@rbac.test',
        name: 'Member',
        password: 'password-123',
        role: 'MEMBER',
      })
      .expect(201);
    const login = await http()
      .post('/auth/login')
      .send({ tenantSlug: t.slug, email: 'member@rbac.test', password: 'password-123' })
      .expect(200);
    const memberToken = login.body.accessToken;
    await http().get('/users').set(bearer(memberToken)).expect(403);
    await http()
      .post('/users')
      .set(bearer(memberToken))
      .send({
        email: 'evil@rbac.test',
        name: 'Evil',
        password: 'password-123',
        role: 'TENANT_ADMIN',
      })
      .expect(403);
  });

  it('不能在租户内创建平台管理员，也不能停用自己', async () => {
    const t = await signupTenant(app, 'guard');
    await http()
      .post('/users')
      .set(bearer(t.token))
      .send({
        email: 'p@guard.test',
        name: 'P',
        password: 'password-123',
        role: 'PLATFORM_ADMIN',
      })
      .expect(400);
    const me = await http().get('/me').set(bearer(t.token)).expect(200);
    await http()
      .patch(`/users/${me.body.id}`)
      .set(bearer(t.token))
      .send({ active: false })
      .expect(400);
  });

  it('停用用户后其令牌立即失效，且写入审计日志', async () => {
    const t = await signupTenant(app, 'deact');
    const created = await http()
      .post('/users')
      .set(bearer(t.token))
      .send({
        email: 'u@deact.test',
        name: 'U',
        password: 'password-123',
        role: 'MEMBER',
      })
      .expect(201);
    const login = await http()
      .post('/auth/login')
      .send({ tenantSlug: t.slug, email: 'u@deact.test', password: 'password-123' })
      .expect(200);
    await http().get('/me').set(bearer(login.body.accessToken)).expect(200);

    await http()
      .patch(`/users/${created.body.id}`)
      .set(bearer(t.token))
      .send({ active: false })
      .expect(200);
    await http().get('/me').set(bearer(login.body.accessToken)).expect(401);
    await http()
      .post('/auth/refresh')
      .send({ refreshToken: login.body.refreshToken })
      .expect(401);

    const logs = await http()
      .get(`/audit-logs?entity=User&entityId=${created.body.id}`)
      .set(bearer(t.token))
      .expect(200);
    const actions = logs.body.map((l: { action: string }) => l.action);
    expect(actions).toContain('user.create');
    expect(actions).toContain('user.update');
  });

  it('通讯录：普通成员可查本企业在职用户，看不到其他企业、也看不到已停用用户', async () => {
    const a = await signupTenant(app, 'dir-a');
    const b = await signupTenant(app, 'dir-b');
    const gone = await http().post('/users').set(bearer(a.token)).send({
      email: 'gone@dir.test', name: 'Gone', password: 'password-123', role: 'MEMBER',
    }).expect(201);
    await http().patch(`/users/${gone.body.id}`).set(bearer(a.token)).send({ active: false }).expect(200);
    await http().post('/users').set(bearer(a.token)).send({
      email: 'm@dir.test', name: 'M', password: 'password-123', role: 'MEMBER',
    }).expect(201);
    const login = await http().post('/auth/login')
      .send({ tenantSlug: a.slug, email: 'm@dir.test', password: 'password-123' }).expect(200);
    const dir = await http().get('/users/directory').set(bearer(login.body.accessToken)).expect(200);
    const emails = dir.body.map((u: { email: string }) => u.email);
    expect(emails).toContain('m@dir.test');
    expect(emails).not.toContain('gone@dir.test');
    expect(emails).not.toContain(b.adminEmail);
    expect(dir.body[0]).not.toHaveProperty('passwordHash');
  });

  it('请求体校验：多余字段与弱密码被拒绝', async () => {
    const t = await signupTenant(app, 'valid');
    await http()
      .post('/users')
      .set(bearer(t.token))
      .send({
        email: 'v@valid.test',
        name: 'V',
        password: 'short',
        role: 'MEMBER',
      })
      .expect(400);
    await http()
      .post('/users')
      .set(bearer(t.token))
      .send({
        email: 'v@valid.test',
        name: 'V',
        password: 'password-123',
        role: 'MEMBER',
        tenantId: 'someone-else',
      })
      .expect(400);
  });
});
