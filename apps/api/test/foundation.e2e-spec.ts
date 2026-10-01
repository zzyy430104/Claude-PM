import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { bearer, createApp, setupTenant } from './helpers.js';

describe('底座调整：职能角色、品牌、投标已删除', () => {
  let app: INestApplication;
  const http = () => request(app.getHttpServer());
  beforeAll(async () => {
    app = await createApp();
  });
  afterAll(() => app.close());

  it('新企业自带 11 个默认职能角色；管理员可改名、新增、停用，名称不能重复', async () => {
    const t = await setupTenant(app, 'fr1');
    const list = (await http().get('/functional-roles').set(bearer(t.member.token)).expect(200)).body;
    expect(list.map((r: { name: string }) => r.name)).toEqual(['项目经理', '技术', '设计', '工艺', '质量', '生产', '采购', '计划', '物流', '仓库', '售后']);
    const tech = list.find((r: { name: string }) => r.name === '技术');

    await http().patch(`/functional-roles/${tech.id}`).set(bearer(t.pm.token)).send({ name: 'x' }).expect(403);
    await http().post('/functional-roles').set(bearer(t.pm.token)).send({ name: '软件' }).expect(403);
    await http().patch(`/functional-roles/${tech.id}`).set(bearer(t.admin.token)).send({ name: '技术工程师' }).expect(200);
    await http().patch(`/functional-roles/${tech.id}`).set(bearer(t.admin.token)).send({ name: '工艺' }).expect(409);
    const soft = (await http().post('/functional-roles').set(bearer(t.admin.token)).send({ name: '软件' }).expect(201)).body;
    expect(soft.sortOrder).toBe(12);
    await http().post('/functional-roles').set(bearer(t.admin.token)).send({ name: '软件' }).expect(409);
    await http().patch(`/functional-roles/${soft.id}`).set(bearer(t.admin.token)).send({ active: false }).expect(200);

    const names = (await http().get('/functional-roles').set(bearer(t.member.token)).expect(200)).body.map((r: { name: string }) => r.name);
    expect(names).toContain('技术工程师');
    const logs = (await http().get(`/audit-logs?entity=FunctionalRole&entityId=${tech.id}`).set(bearer(t.admin.token)).expect(200)).body;
    expect(logs[0]).toMatchObject({ action: 'functionalRole.update', before: { name: '技术' }, after: { name: '技术工程师' } });

    // 给用户指定职能角色；停用的角色和别的企业的角色不能用
    await http().patch(`/users/${t.member.id}`).set(bearer(t.admin.token)).send({ functionalRoleId: tech.id }).expect(200);
    expect((await http().get('/users/directory').set(bearer(t.pm.token)).expect(200)).body.find((u: { id: string }) => u.id === t.member.id).functionalRoleId).toBe(tech.id);
    await http().patch(`/users/${t.member.id}`).set(bearer(t.admin.token)).send({ functionalRoleId: soft.id }).expect(400);
    const other = await setupTenant(app, 'fr2');
    const otherRole = (await http().get('/functional-roles').set(bearer(other.admin.token)).expect(200)).body[0];
    await http().patch(`/users/${t.member.id}`).set(bearer(t.admin.token)).send({ functionalRoleId: otherRole.id }).expect(400);
    await http().patch(`/functional-roles/${otherRole.id}`).set(bearer(t.admin.token)).send({ name: '越权' }).expect(404);
    await http().patch(`/users/${t.member.id}`).set(bearer(t.admin.token)).send({ functionalRoleId: null }).expect(200);
    expect((await http().get(`/users/${t.member.id}`).set(bearer(t.admin.token)).expect(200)).body.functionalRoleId).toBeNull();
  });

  it('系统名称和企业名称：管理员可改，所有人可读', async () => {
    const t = await setupTenant(app, 'br1');
    expect((await http().get('/branding').set(bearer(t.member.token)).expect(200)).body.systemName).toBe('Claude-PM');
    await http().patch('/tenant-settings').set(bearer(t.pm.token)).send({ systemName: '华东轨道 PMS' }).expect(403);
    await http().patch('/tenant-settings').set(bearer(t.admin.token)).send({ systemName: '' }).expect(400);
    await http().patch('/tenant-settings').set(bearer(t.admin.token)).send({ systemName: '华东轨道 PMS', companyName: '华东轨道装备有限公司' }).expect(200);
    expect((await http().get('/branding').set(bearer(t.member.token)).expect(200)).body).toMatchObject({ systemName: '华东轨道 PMS', companyName: '华东轨道装备有限公司' });
    expect((await http().get('/tenant-settings').set(bearer(t.admin.token)).expect(200)).body).toMatchObject({ systemName: '华东轨道 PMS', evmAmber: 0.95 });
  });

  it('投标功能已删除', async () => {
    const t = await setupTenant(app, 'nt1');
    await http().get('/tenders').set(bearer(t.admin.token)).expect(404);
  });
});
