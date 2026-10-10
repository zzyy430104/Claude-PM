import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { addMember, bearer, createApp, createProject, setupTenant } from './helpers.js';

describe('WBS、依赖、关键路径与基线', () => {
  let app: INestApplication;
  beforeAll(async () => {
    app = await createApp();
  });
  afterAll(() => app.close());
  const http = () => request(app.getHttpServer());

  async function newWp(token: string, pid: string, body: Record<string, unknown>) {
    const r = await http().post(`/projects/${pid}/wbs`).set(bearer(token)).send(body).expect(201);
    return r.body as { id: string };
  }

  it('关键路径与父节点汇总', async () => {
    const t = await setupTenant(app, 'cpm');
    const p = await createProject(app, t.pm.token, { startDate: '2026-03-02' });
    const root = await newWp(t.pm.token, p.id, { code: '1', name: '设计', durationDays: 1 });
    const a = await newWp(t.pm.token, p.id, { code: '1.1', name: '方案', parentId: root.id, durationDays: 2 });
    const b = await newWp(t.pm.token, p.id, { code: '1.2', name: '详细设计', parentId: root.id, durationDays: 5 });
    const c = await newWp(t.pm.token, p.id, { code: '1.3', name: '评审', parentId: root.id, durationDays: 2 });
    const d = await newWp(t.pm.token, p.id, { code: '2', name: '制造', durationDays: 3 });
    for (const [x, y] of [[a, b], [a, c], [b, d], [c, d]]) {
      await http().post(`/projects/${p.id}/dependencies`).set(bearer(t.pm.token))
        .send({ predecessorId: x.id, successorId: y.id }).expect(201);
    }
    const g = await http().get(`/projects/${p.id}/wbs`).set(bearer(t.pm.token)).expect(200);
    const by = Object.fromEntries(g.body.items.map((i: { code: string }) => [i.code, i]));
    expect(g.body.projectDurationDays).toBe(10); // 2 + 5 + 3
    expect(by['1.2'].critical).toBe(true);
    expect(by['1.3'].critical).toBe(false);
    expect(by['1.3'].totalFloatDays).toBe(3);
    expect(by['2'].scheduledStart).toBe('2026-03-11'); // 2026-03-02（周一）后第 7 个工作日
    expect(by['1'].isLeaf).toBe(false);
    expect(by['1'].scheduledStart).toBe('2026-03-02');
    expect(by['1'].scheduledEnd).toBe('2026-03-10'); // 最后一个工作日
    expect(by['1'].critical).toBe(true);
    expect(g.body.exceedsPlannedEnd).toBe(false);
  });

  it('依赖形成环时被拒绝；自依赖被拒绝；重复依赖返回 409', async () => {
    const t = await setupTenant(app, 'cycle');
    const p = await createProject(app, t.pm.token);
    const a = await newWp(t.pm.token, p.id, { code: 'A', name: 'A', durationDays: 1 });
    const b = await newWp(t.pm.token, p.id, { code: 'B', name: 'B', durationDays: 1 });
    const c = await newWp(t.pm.token, p.id, { code: 'C', name: 'C', durationDays: 1 });
    const dep = (x: { id: string }, y: { id: string }) =>
      http().post(`/projects/${p.id}/dependencies`).set(bearer(t.pm.token)).send({ predecessorId: x.id, successorId: y.id });
    await dep(a, b).expect(201);
    await dep(b, c).expect(201);
    await dep(c, a).expect(400);
    await dep(a, a).expect(400);
    await dep(a, b).expect(409);
  });

  it('总工期超过计划结束日时给出提示', async () => {
    const t = await setupTenant(app, 'late');
    const p = await createProject(app, t.pm.token, { startDate: '2026-01-01', endDate: '2026-01-10' });
    await newWp(t.pm.token, p.id, { code: 'A', name: 'A', durationDays: 30 });
    const g = await http().get(`/projects/${p.id}/wbs`).set(bearer(t.pm.token)).expect(200);
    expect(g.body.exceedsPlannedEnd).toBe(true);
  });

  it('工作包编号在项目内唯一；负责人必须是项目成员', async () => {
    const t = await setupTenant(app, 'wpref');
    const p = await createProject(app, t.pm.token);
    await newWp(t.pm.token, p.id, { code: 'A', name: 'A', durationDays: 1 });
    await http().post(`/projects/${p.id}/wbs`).set(bearer(t.pm.token)).send({ code: 'A', name: 'dup', durationDays: 1 }).expect(409);
    await http().post(`/projects/${p.id}/wbs`).set(bearer(t.pm.token))
      .send({ code: 'B', name: 'B', durationDays: 1, ownerId: t.outsider.id }).expect(400);
  });

  it('负责人只能更新进度；核验人不能是负责人；已核验的工作包被锁定', async () => {
    const t = await setupTenant(app, 'verify');
    const p = await createProject(app, t.pm.token);
    await addMember(app, t.pm.token, p.id, t.member.id, 'WORK_PACKAGE_OWNER');
    await addMember(app, t.pm.token, p.id, t.pqm.id, 'PROJECT_QUALITY_MANAGER');
    const wp = await newWp(t.pm.token, p.id, { code: 'A', name: 'A', durationDays: 3, ownerId: t.member.id });
    const url = `/projects/${p.id}/wbs/${wp.id}`;

    await http().patch(url).set(bearer(t.member.token)).send({ name: '改名' }).expect(403);
    const prog = await http().patch(url).set(bearer(t.member.token)).send({ percentComplete: 40 }).expect(200);
    expect(prog.body.status).toBe('IN_PROGRESS');
    await http().post(`${url}/verify`).set(bearer(t.pqm.token)).expect(409); // 未完成
    const done = await http().patch(url).set(bearer(t.member.token)).send({ percentComplete: 100 }).expect(200);
    expect(done.body.status).toBe('DONE');
    await http().post(`${url}/verify`).set(bearer(t.member.token)).expect(403); // 负责人无权核验
    await http().patch(url).set(bearer(t.pm.token)).send({ status: 'VERIFIED' }).expect(400);
    await http().post(`${url}/verify`).set(bearer(t.pqm.token)).expect(200);
    await http().patch(url).set(bearer(t.member.token)).send({ percentComplete: 10 }).expect(409);
    const logs = await http().get(`/audit-logs?entity=WorkPackage&entityId=${wp.id}`).set(bearer(t.admin.token)).expect(200);
    expect(logs.body.map((l: { action: string }) => l.action)).toContain('workPackage.verify');
  });

  it('项目经理不能核验自己负责的工作包', async () => {
    const t = await setupTenant(app, 'selfverify');
    const p = await createProject(app, t.pm.token);
    const wp = await newWp(t.pm.token, p.id, { code: 'A', name: 'A', durationDays: 1, ownerId: t.pm.id });
    await http().patch(`/projects/${p.id}/wbs/${wp.id}`).set(bearer(t.pm.token)).send({ percentComplete: 100 }).expect(200);
    await http().post(`/projects/${p.id}/wbs/${wp.id}/verify`).set(bearer(t.pm.token)).expect(403);
    await addMember(app, t.pm.token, p.id, t.pqm.id, 'PROJECT_QUALITY_MANAGER');
    await http().post(`/projects/${p.id}/wbs/${wp.id}/verify`).set(bearer(t.pqm.token)).expect(200);
  });

  it('基线前可自由调整范围，基线后范围/预算/交期修改被拦截（需变更控制）', async () => {
    const t = await setupTenant(app, 'base');
    const p = await createProject(app, t.pm.token);
    const wp = await newWp(t.pm.token, p.id, { code: 'A', name: 'A', durationDays: 3 });
    await http().patch(`/projects/${p.id}`).set(bearer(t.pm.token)).send({ budget: 900000 }).expect(200);
    await http().delete(`/projects/${p.id}/wbs/${wp.id}`).set(bearer(t.pm.token)).expect(204);
    const wp2 = await newWp(t.pm.token, p.id, { code: 'B', name: 'B', durationDays: 3 });

    await http().post(`/projects/${p.id}/baseline`).set(bearer(t.member.token)).expect(404);
    await http().post(`/projects/${p.id}/baseline`).set(bearer(t.pm.token)).expect(200);
    await http().post(`/projects/${p.id}/baseline`).set(bearer(t.pm.token)).expect(409);

    const phases = await http().get(`/projects/${p.id}/phases`).set(bearer(t.pm.token)).expect(200);
    expect(phases.body[0].status).toBe('ACTIVE');

    for (const body of [{ budget: 1 }, { customerDeliveryDate: '2027-01-01' }, { endDate: '2027-06-01' }]) {
      const r = await http().patch(`/projects/${p.id}`).set(bearer(t.pm.token)).send(body).expect(409);
      expect(r.body.code).toBe('CHANGE_REQUEST_REQUIRED');
    }
    await http().patch(`/projects/${p.id}`).set(bearer(t.pm.token)).send({ name: '新名称' }).expect(200);

    const add = await http().post(`/projects/${p.id}/wbs`).set(bearer(t.pm.token))
      .send({ code: 'C', name: 'C', durationDays: 1 }).expect(409);
    expect(add.body.code).toBe('CHANGE_REQUEST_REQUIRED');
    await http().delete(`/projects/${p.id}/wbs/${wp2.id}`).set(bearer(t.pm.token)).expect(409);
  });

  it('基线后至少保留一名项目经理', async () => {
    const t = await setupTenant(app, 'lastpm');
    const p = await createProject(app, t.pm.token);
    await http().post(`/projects/${p.id}/baseline`).set(bearer(t.pm.token)).expect(200);
    await http().patch(`/projects/${p.id}/members/${t.pm.id}`).set(bearer(t.pm.token)).send({ active: false }).expect(409);
  });
});
