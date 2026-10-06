import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { bearer, createApp, gateProject, setupTenant } from './helpers.js';

describe('项目权限表（企业设置）', () => {
  let app: INestApplication;
  beforeAll(async () => { app = await createApp(); });
  afterAll(() => app.close());
  const http = () => request(app.getHttpServer());

  it('默认值按职能角色放开编辑；企业管理员修改后立即生效并留痕；可恢复默认', async () => {
    const t = await setupTenant(app, 'perm');
    const p = await gateProject(app, t, { baseline: false });
    const roles = (await http().get('/functional-roles').set(bearer(t.admin.token)).expect(200)).body as { id: string; name: string }[];
    const design = roles.find((r) => r.name.includes('设计')) ?? (await http().post('/functional-roles').set(bearer(t.admin.token)).send({ name: '设计' }).expect(201)).body;
    await http().patch(`/users/${t.member.id}`).set(bearer(t.admin.token)).send({ functionalRoleId: design.id }).expect(200);

    const cfg = (await http().get('/project-permissions').set(bearer(t.admin.token)).expect(200)).body;
    expect(cfg.rows.map((r: { key: string }) => r.key)).toEqual(expect.arrayContaining(['REQUIREMENTS', 'WBS', 'PURCHASE', 'INSPECTION', 'HANDOVER']));
    expect(cfg.config.grants.QUALITY).toContain('PQM');
    expect(cfg.config.grants.REQUIREMENTS).toContain(design.id);
    expect(cfg.config.grants.WBS).toEqual([]);

    // 设计人员（项目成员）可以写需求，不能改 WBS 结构
    await http().post(`/projects/${p.id}/requirements`).set(bearer(t.member.token)).send({ code: 'R-1', title: '最高运行速度 160 km/h', category: 'TECHNICAL' }).expect(201);
    await http().post(`/projects/${p.id}/wbs`).set(bearer(t.member.token)).send({ code: '9', name: 'x', durationDays: 1 }).expect(403);
    const mine = (await http().get(`/projects/${p.id}`).set(bearer(t.member.token)).expect(200)).body.permissions.edit;
    expect(mine).toMatchObject({ REQUIREMENTS: true, WBS: false, PURCHASE: false });
    expect((await http().get(`/projects/${p.id}`).set(bearer(t.pm.token)).expect(200)).body.permissions.edit.WBS).toBe(true);

    // 只有企业管理员能改；角色必须是本企业的
    await http().put('/project-permissions').set(bearer(t.pm.token)).send({ grants: cfg.config.grants }).expect(403);
    await http().put('/project-permissions').set(bearer(t.admin.token)).send({ grants: { ...cfg.config.grants, WBS: ['00000000-0000-4000-8000-000000000000'] } }).expect(400);
    const grants = { ...cfg.config.grants, REQUIREMENTS: cfg.config.grants.REQUIREMENTS.filter((x: string) => x !== design.id), WBS: [design.id] };
    await http().put('/project-permissions').set(bearer(t.admin.token)).send({ grants }).expect(200);
    await http().post(`/projects/${p.id}/requirements`).set(bearer(t.member.token)).send({ code: 'R-2', title: 'x', category: 'OTHER' }).expect(403);
    await http().post(`/projects/${p.id}/wbs`).set(bearer(t.member.token)).send({ code: '9', name: '设计评审准备', durationDays: 2 }).expect(201);
    const logs = (await http().get('/audit-logs?limit=20').set(bearer(t.admin.token)).expect(200)).body as { action: string }[];
    expect(logs.map((l) => l.action)).toContain('tenant.projectPermissions');

    // 恢复默认
    const back = (await http().put('/project-permissions').set(bearer(t.admin.token)).send({ reset: true }).expect(200)).body;
    expect(back.config.grants.REQUIREMENTS).toContain(design.id);
    expect(back.config.grants.WBS).toEqual([]);
  });
});
