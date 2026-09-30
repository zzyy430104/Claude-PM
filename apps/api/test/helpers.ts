import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';

export async function createApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  const app = moduleRef.createNestApplication();
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  await app.init();
  return app;
}

let counter = 0;
export const uid = () => `${Date.now().toString(36)}${counter++}`;

export async function signupTenant(app: INestApplication, label: string) {
  const slug = `t-${label}-${uid()}`;
  const adminEmail = `admin@${slug}.test`;
  const password = 'admin-pass-123';
  await request(app.getHttpServer())
    .post('/auth/signup')
    .send({
      tenantName: `Tenant ${label}`,
      tenantSlug: slug,
      adminEmail,
      adminName: 'Admin',
      password,
    })
    .expect(201);
  const login = await request(app.getHttpServer())
    .post('/auth/login')
    .send({ tenantSlug: slug, email: adminEmail, password })
    .expect(200);
  return {
    slug,
    adminEmail,
    password,
    token: login.body.accessToken as string,
    refreshToken: login.body.refreshToken as string,
  };
}

export const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

export interface TestUser {
  id: string;
  email: string;
  token: string;
}

/** 由租户管理员创建指定角色的用户并登录 */
export async function createUser(
  app: INestApplication,
  tenant: { slug: string; token: string },
  role: string,
  label = role.toLowerCase(),
): Promise<TestUser> {
  const email = `${label}-${uid()}@${tenant.slug}.test`;
  const password = 'password-123';
  const created = await request(app.getHttpServer())
    .post('/users')
    .set(bearer(tenant.token))
    .send({ email, name: label, password, role })
    .expect(201);
  const login = await request(app.getHttpServer())
    .post('/auth/login')
    .send({ tenantSlug: tenant.slug, email, password })
    .expect(200);
  return { id: created.body.id, email, token: login.body.accessToken };
}

/** 创建一个租户，含项目经理、质量经理和几个普通成员 */
export async function setupTenant(app: INestApplication, label: string) {
  const admin = await signupTenant(app, label);
  const pm = await createUser(app, admin, 'PROJECT_MANAGER', 'pm');
  const pqm = await createUser(app, admin, 'PROJECT_QUALITY_MANAGER', 'pqm');
  const member = await createUser(app, admin, 'MEMBER', 'member');
  const outsider = await createUser(app, admin, 'MEMBER', 'outsider');
  const top = await createUser(app, admin, 'TOP_MANAGEMENT', 'top');
  return { admin, pm, pqm, member, outsider, top };
}

export async function createProject(
  app: INestApplication,
  token: string,
  overrides: Record<string, unknown> = {},
) {
  const res = await request(app.getHttpServer())
    .post('/projects')
    .set(bearer(token))
    .send({
      code: `P-${uid()}`,
      name: '测试项目',
      riskLevel: 'MEDIUM',
      startDate: '2026-01-05',
      endDate: '2026-12-31',
      budget: 1000000,
      customerDeliveryDate: '2026-12-15',
      ...overrides,
    })
    .expect(201);
  return res.body as { id: string; code: string };
}

export async function addMember(
  app: INestApplication,
  token: string,
  projectId: string,
  userId: string,
  projectRole: string,
  extra: Record<string, unknown> = {},
) {
  return request(app.getHttpServer())
    .post(`/projects/${projectId}/members`)
    .set(bearer(token))
    .send({ userId, projectRole, ...extra })
    .expect(201);
}

/** 建立带 PM、质量经理、成员、最高管理层可见的项目；phases 缺省用自定义三阶段模板 */
export async function gateProject(
  app: INestApplication,
  t: Awaited<ReturnType<typeof setupTenant>>,
  opts: { baseline?: boolean } = {},
) {
  const tpl = await request(app.getHttpServer())
    .post('/phase-templates')
    .set(bearer(t.admin.token))
    .send({
      name: `gate-${uid()}`,
      phases: [
        { name: '设计', checklist: ['设计评审完成'], mandatoryRoles: ['PROJECT_MANAGER'] },
        { name: '制造', checklist: ['首件合格'], mandatoryRoles: ['PROJECT_MANAGER', 'PROJECT_QUALITY_MANAGER'] },
        { name: '交付', checklist: [], mandatoryRoles: [] },
      ],
    })
    .expect(201);
  const p = await createProject(app, t.pm.token, { templateId: tpl.body.id });
  await addMember(app, t.pm.token, p.id, t.pqm.id, 'PROJECT_QUALITY_MANAGER');
  await addMember(app, t.pm.token, p.id, t.member.id, 'MEMBER');
  if (opts.baseline !== false) {
    await request(app.getHttpServer()).post(`/projects/${p.id}/baseline`).set(bearer(t.pm.token)).expect(200);
  }
  const phases = await request(app.getHttpServer()).get(`/projects/${p.id}/phases`).set(bearer(t.pm.token)).expect(200);
  return { ...p, phases: phases.body as { id: string; name: string; status: string; order: number }[] };
}
