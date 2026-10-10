import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { addMember, bearer, createProject, createUser, createApp, setupTenant, signupTenant } from './helpers.js';

describe('项目、成员与访问控制', () => {
  let app: INestApplication;
  beforeAll(async () => {
    app = await createApp();
  });
  afterAll(() => app.close());
  const http = () => request(app.getHttpServer());

  it('项目经理创建项目：自动生成 7 个默认阶段并成为项目经理', async () => {
    const t = await setupTenant(app, 'proj1');
    const p = await createProject(app, t.pm.token);
    const phases = await http().get(`/projects/${p.id}/phases`).set(bearer(t.pm.token)).expect(200);
    expect(phases.body).toHaveLength(6);
    expect(phases.body.map((x: { name: string }) => x.name)).toEqual(['项目策划', '技术准备', 'FAI 首件鉴定', '量产', '交付', '项目总结']);
    const members = await http().get(`/projects/${p.id}/members`).set(bearer(t.pm.token)).expect(200);
    expect(members.body).toHaveLength(1);
    expect(members.body[0].projectRole).toBe('PROJECT_MANAGER');
    const detail = await http().get(`/projects/${p.id}`).set(bearer(t.pm.token)).expect(200);
    expect(detail.body.permissions.manage).toBe(true);
    expect(detail.body.reviewIntervalDays).toBe(30);
  });

  it('普通成员不能创建项目；项目编号在租户内唯一', async () => {
    const t = await setupTenant(app, 'proj2');
    await http().post('/projects').set(bearer(t.member.token)).send({
      code: 'X-1', name: 'x项目', riskLevel: 'LOW', startDate: '2026-01-01', endDate: '2026-02-01',
    }).expect(403);
    const p = await createProject(app, t.pm.token);
    await http().post('/projects').set(bearer(t.pm.token)).send({
      code: p.code, name: '重复', riskLevel: 'LOW', startDate: '2026-01-01', endDate: '2026-02-01',
    }).expect(409);
  });

  it('只有项目成员、企业管理员、最高管理层能看到项目', async () => {
    const t = await setupTenant(app, 'proj3');
    const other = await setupTenant(app, 'proj3b');
    const p = await createProject(app, t.pm.token);
    await addMember(app, t.pm.token, p.id, t.member.id, 'MEMBER');

    for (const [who, expected] of [
      [t.member, 200], [t.outsider, 404], [t.admin, 200], [t.top, 200], [other.admin, 404], [other.pm, 404],
    ] as const) {
      await http().get(`/projects/${p.id}`).set(bearer(who.token)).expect(expected);
    }
    const listOutsider = await http().get('/projects').set(bearer(t.outsider.token)).expect(200);
    expect(listOutsider.body).toHaveLength(0);
    const listMember = await http().get('/projects').set(bearer(t.member.token)).expect(200);
    expect(listMember.body.map((x: { id: string }) => x.id)).toEqual([p.id]);
    const listOther = await http().get('/projects').set(bearer(other.admin.token)).expect(200);
    expect(listOther.body).toHaveLength(0);
  });

  it('普通成员不能修改项目、成员和计划', async () => {
    const t = await setupTenant(app, 'proj4');
    const p = await createProject(app, t.pm.token);
    await addMember(app, t.pm.token, p.id, t.member.id, 'MEMBER');
    await http().patch(`/projects/${p.id}`).set(bearer(t.member.token)).send({ name: '改名' }).expect(403);
    await http().post(`/projects/${p.id}/members`).set(bearer(t.member.token))
      .send({ userId: t.outsider.id, projectRole: 'MEMBER' }).expect(403);
    await http().put(`/projects/${p.id}/plan`).set(bearer(t.member.token)).send({ objectives: 'x' }).expect(403);
  });

  it('不能把其他租户的用户加入项目', async () => {
    const t = await setupTenant(app, 'proj5');
    const other = await setupTenant(app, 'proj5b');
    const p = await createProject(app, t.pm.token);
    await http().post(`/projects/${p.id}/members`).set(bearer(t.pm.token))
      .send({ userId: other.member.id, projectRole: 'MEMBER' }).expect(400);
  });

  it('自定义阶段模板：管理员创建，项目按模板生成阶段', async () => {
    const t = await setupTenant(app, 'tpl');
    await http().post('/phase-templates').set(bearer(t.pm.token)).send({ name: 'x', phases: [] }).expect(403);
    const tpl = await http().post('/phase-templates').set(bearer(t.admin.token)).send({
      name: '轻量流程',
      phases: [
        { name: '设计', checklist: ['评审完成'], mandatoryRoles: ['PROJECT_MANAGER'] },
        { name: '交付', checklist: [], mandatoryRoles: [] },
      ],
    }).expect(201);
    const p = await createProject(app, t.pm.token, { templateId: tpl.body.id });
    const phases = await http().get(`/projects/${p.id}/phases`).set(bearer(t.pm.token)).expect(200);
    expect(phases.body.map((x: { name: string }) => x.name)).toEqual(['设计', '交付']);
  });

  it('风险分级决定评审周期', async () => {
    const t = await setupTenant(app, 'risk');
    const p = await createProject(app, t.pm.token, { riskLevel: 'HIGH' });
    const d = await http().get(`/projects/${p.id}`).set(bearer(t.pm.token)).expect(200);
    expect(d.body.reviewIntervalDays).toBe(14);
  });

  it('项目管理计划：保存并递增版本，写入审计', async () => {
    const t = await setupTenant(app, 'plan');
    const p = await createProject(app, t.pm.token);
    const empty = await http().get(`/projects/${p.id}/plan`).set(bearer(t.pm.token)).expect(200);
    expect(empty.body.version).toBe(0);
    await http().put(`/projects/${p.id}/plan`).set(bearer(t.pm.token))
      .send({ objectives: '按期交付', orgChart: [{ userId: t.pm.id, role: 'PM' }] }).expect(200);
    const v2 = await http().put(`/projects/${p.id}/plan`).set(bearer(t.pm.token))
      .send({ exclusions: '不含培训' }).expect(200);
    expect(v2.body.version).toBe(2);
    expect(v2.body.objectives).toBe('按期交付');
    const logs = await http().get(`/audit-logs?entity=ProjectPlan&entityId=${p.id}`).set(bearer(t.admin.token)).expect(200);
    expect(logs.body).toHaveLength(2);
  });

  it('交付物：项目经理创建，成员可读不可写', async () => {
    const t = await setupTenant(app, 'deliv');
    const p = await createProject(app, t.pm.token);
    await addMember(app, t.pm.token, p.id, t.member.id, 'MEMBER');
    await http().post(`/projects/${p.id}/deliverables`).set(bearer(t.member.token))
      .send({ name: '设计文件', kind: 'CUSTOMER_APPROVAL' }).expect(403);
    const d = await http().post(`/projects/${p.id}/deliverables`).set(bearer(t.pm.token))
      .send({ name: '设计文件', kind: 'CUSTOMER_APPROVAL', dueDate: '2026-06-01' }).expect(201);
    await http().patch(`/projects/${p.id}/deliverables/${d.body.id}`).set(bearer(t.pm.token))
      .send({ status: 'SUBMITTED' }).expect(200);
    const list = await http().get(`/projects/${p.id}/deliverables`).set(bearer(t.member.token)).expect(200);
    expect(list.body[0].status).toBe('SUBMITTED');
  });

  it('租户管理员创建的项目可指定项目经理', async () => {
    const t = await setupTenant(app, 'adm');
    const p = await createProject(app, t.admin.token, { managerId: t.pm.id });
    await http().get(`/projects/${p.id}`).set(bearer(t.pm.token)).expect(200);
    const x = await signupTenant(app, 'adm-other');
    const u = await createUser(app, x, 'PROJECT_MANAGER');
    await http().post('/projects').set(bearer(t.admin.token)).send({
      code: 'Z-9', name: '越租户', riskLevel: 'LOW', startDate: '2026-01-01', endDate: '2026-02-01', managerId: u.id,
    }).expect(400);
  });
});
