import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { addMember, bearer, createApp, gateProject, setupTenant } from './helpers.js';

describe('阶段关口评审', () => {
  let app: INestApplication;
  beforeAll(async () => {
    app = await createApp();
  });
  afterAll(() => app.close());
  const http = () => request(app.getHttpServer());

  type T = Awaited<ReturnType<typeof setupTenant>>;
  const openGate = async (t: T, pid: string, phaseId: string) =>
    (await http().post(`/projects/${pid}/phases/${phaseId}/gate-reviews`).set(bearer(t.pm.token)).expect(201)).body;
  const fill = (t: T, pid: string, rid: string, body: Record<string, unknown>) =>
    http().patch(`/projects/${pid}/gate-reviews/${rid}`).set(bearer(t.pm.token)).send(body).expect(200);
  const decide = (t: T, pid: string, rid: string, body: Record<string, unknown>, token = t.pm.token) =>
    http().post(`/projects/${pid}/gate-reviews/${rid}/decision`).set(bearer(token)).send(body);
  const allPassed = (items: { item: string }[]) => items.map((i) => ({ item: i.item, passed: true }));

  it('通过评审：关闭当前阶段并启动下一阶段', async () => {
    const t = await setupTenant(app, 'g1');
    const p = await gateProject(app, t);
    const g = await openGate(t, p.id, p.phases[0].id);
    expect(g.checklistResults).toEqual([{ item: '设计评审完成', passed: false }]);

    // 必选参与者（项目经理）未出席
    const noPm = await decide(t, p.id, g.id, { decision: 'APPROVED', note: '通过' }).expect(409);
    expect(noPm.body.code).toBe('MANDATORY_PARTICIPANTS_MISSING');
    expect(noPm.body.missing).toEqual(['PROJECT_MANAGER']);

    await fill(t, p.id, g.id, { attendees: [t.pm.id] });
    // 清单未通过不能直接通过
    const blocked = await decide(t, p.id, g.id, { decision: 'APPROVED', note: '通过' }).expect(409);
    expect(blocked.body.code).toBe('GATE_CRITERIA_NOT_MET');
    expect(blocked.body.blockers.checklist).toEqual(['设计评审完成']);

    await fill(t, p.id, g.id, { checklistResults: allPassed(g.checklistResults) });
    const ok = await decide(t, p.id, g.id, { decision: 'APPROVED', note: '通过' }).expect(200);
    expect(ok.body.status).toBe('DECIDED');

    const phases = await http().get(`/projects/${p.id}/phases`).set(bearer(t.pm.token)).expect(200);
    expect(phases.body.map((x: { status: string }) => x.status)).toEqual(['CLOSED', 'ACTIVE', 'PLANNED']);
    await decide(t, p.id, g.id, { decision: 'APPROVED', note: '再来一次' }).expect(409);
    await http().patch(`/projects/${p.id}/gate-reviews/${g.id}`).set(bearer(t.pm.token)).send({ notes: 'x' }).expect(409);
  });

  it('只能评审当前进行中的阶段；同一阶段同时只有一个未决评审', async () => {
    const t = await setupTenant(app, 'g2');
    const p = await gateProject(app, t);
    await http().post(`/projects/${p.id}/phases/${p.phases[2].id}/gate-reviews`).set(bearer(t.pm.token)).expect(409);
    await openGate(t, p.id, p.phases[0].id);
    await http().post(`/projects/${p.id}/phases/${p.phases[0].id}/gate-reviews`).set(bearer(t.pm.token)).expect(409);
    await http().post(`/projects/${p.id}/phases/${p.phases[0].id}/gate-reviews`).set(bearer(t.member.token)).expect(403);
  });

  it('有条件通过必须有行动计划，行动项成为遗留问题', async () => {
    const t = await setupTenant(app, 'g3');
    const p = await gateProject(app, t);
    const g = await openGate(t, p.id, p.phases[0].id);
    await fill(t, p.id, g.id, { attendees: [t.pm.id] });
    await decide(t, p.id, g.id, { decision: 'CONDITIONAL', note: '条件通过' }).expect(400);
    await decide(t, p.id, g.id, {
      decision: 'CONDITIONAL', note: '条件通过',
      actions: [{ title: '补充设计评审记录', ownerId: t.member.id }],
    }).expect(200);
    const issues = await http().get(`/projects/${p.id}/issues?status=OPEN`).set(bearer(t.pm.token)).expect(200);
    expect(issues.body).toHaveLength(1);
    expect(issues.body[0]).toMatchObject({ kind: 'ACTION', source: 'GATE', ownerId: t.member.id });
  });

  it('此前评审遗留问题未关闭：不能通过，除非最高管理层授权（R1）', async () => {
    const t = await setupTenant(app, 'g4');
    const p = await gateProject(app, t);
    const g1 = await openGate(t, p.id, p.phases[0].id);
    await fill(t, p.id, g1.id, { attendees: [t.pm.id] });
    await decide(t, p.id, g1.id, { decision: 'CONDITIONAL', note: '有条件', actions: [{ title: '补记录' }] }).expect(200);

    const g2 = await openGate(t, p.id, p.phases[1].id);
    await fill(t, p.id, g2.id, { attendees: [t.pm.id, t.pqm.id], checklistResults: [{ item: '首件合格', passed: true }] });
    const blocked = await decide(t, p.id, g2.id, { decision: 'CONDITIONAL', note: '继续', actions: [{ title: 'x' }] }).expect(409);
    expect(blocked.body.code).toBe('OPEN_ISSUES');
    expect(blocked.body.issues).toHaveLength(1);

    // 项目经理、质量经理都无权授权
    const reason = { reason: '客户催交，风险已评估' };
    await http().post(`/projects/${p.id}/gate-reviews/${g2.id}/authorize-override`).set(bearer(t.pm.token)).send(reason).expect(403);
    await http().post(`/projects/${p.id}/gate-reviews/${g2.id}/authorize-override`).set(bearer(t.admin.token)).send(reason).expect(403);
    await http().post(`/projects/${p.id}/gate-reviews/${g2.id}/authorize-override`).set(bearer(t.top.token)).send(reason).expect(200);
    await decide(t, p.id, g2.id, { decision: 'CONDITIONAL', note: '继续', actions: [{ title: 'x' }] }).expect(200);

    const logs = await http().get(`/audit-logs?entity=GateReview&entityId=${g2.id}`).set(bearer(t.admin.token)).expect(200);
    expect(logs.body.map((l: { action: string }) => l.action)).toEqual(
      expect.arrayContaining(['gateReview.authorizeOverride', 'gateReview.decide']),
    );
  });

  it('遗留问题关闭后无需授权即可通过', async () => {
    const t = await setupTenant(app, 'g5');
    const p = await gateProject(app, t);
    const g1 = await openGate(t, p.id, p.phases[0].id);
    await fill(t, p.id, g1.id, { attendees: [t.pm.id] });
    await decide(t, p.id, g1.id, { decision: 'CONDITIONAL', note: '有条件', actions: [{ title: '补记录', ownerId: t.member.id }] }).expect(200);
    const [issue] = (await http().get(`/projects/${p.id}/issues`).set(bearer(t.pm.token)).expect(200)).body;

    // 关闭必须写明结论；负责人可关闭
    await http().patch(`/projects/${p.id}/issues/${issue.id}`).set(bearer(t.member.token)).send({ status: 'CLOSED' }).expect(400);
    await http().patch(`/projects/${p.id}/issues/${issue.id}`).set(bearer(t.member.token)).send({ status: 'CLOSED', closureNote: '已补充' }).expect(200);

    const g2 = await openGate(t, p.id, p.phases[1].id);
    await fill(t, p.id, g2.id, { attendees: [t.pm.id, t.pqm.id], checklistResults: [{ item: '首件合格', passed: true }] });
    await decide(t, p.id, g2.id, { decision: 'APPROVED', note: '通过' }).expect(200);
  });

  it('评审被拒：阶段保持进行中，登记升级事项', async () => {
    const t = await setupTenant(app, 'g6');
    const p = await gateProject(app, t);
    const g = await openGate(t, p.id, p.phases[0].id);
    await fill(t, p.id, g.id, { attendees: [t.pm.id] });
    const r = await decide(t, p.id, g.id, { decision: 'REJECTED', note: '设计输入不完整' }).expect(200);
    expect(r.body.escalated).toBe(true);
    const phases = await http().get(`/projects/${p.id}/phases`).set(bearer(t.pm.token)).expect(200);
    expect(phases.body[0].status).toBe('ACTIVE');
    const issues = await http().get(`/projects/${p.id}/issues`).set(bearer(t.pm.token)).expect(200);
    expect(issues.body[0].title).toContain('被拒');
    // 被拒后可以重新发起评审
    await openGate(t, p.id, p.phases[0].id);
  });

  it('基线前登记的工作包与交付物决定关口就绪情况', async () => {
    const t = await setupTenant(app, 'g8');
    const p = await gateProject(app, t, { baseline: false });
    const wp = (await http().post(`/projects/${p.id}/wbs`).set(bearer(t.pm.token))
      .send({ code: 'A', name: '方案', durationDays: 2, phaseId: p.phases[0].id }).expect(201)).body;
    const dv = (await http().post(`/projects/${p.id}/deliverables`).set(bearer(t.pm.token))
      .send({ name: '设计文件', kind: 'CUSTOMER_APPROVAL', phaseId: p.phases[0].id }).expect(201)).body;
    await http().post(`/projects/${p.id}/baseline`).set(bearer(t.pm.token)).expect(200);

    const ready = await http().get(`/projects/${p.id}/phases/${p.phases[0].id}/readiness`).set(bearer(t.pm.token)).expect(200);
    expect(ready.body.pendingWorkPackages.map((w: { code: string }) => w.code)).toEqual(['A']);
    expect(ready.body.pendingDeliverables).toHaveLength(1);

    const g = await openGate(t, p.id, p.phases[0].id);
    await fill(t, p.id, g.id, { attendees: [t.pm.id], checklistResults: [{ item: '设计评审完成', passed: true }] });
    const blocked = await decide(t, p.id, g.id, { decision: 'APPROVED', note: '通过' }).expect(409);
    expect(blocked.body.blockers.workPackages).toEqual(['A']);
    expect(blocked.body.blockers.deliverables).toEqual(['设计文件']);

    // 完成并核验工作包、接受交付物后即可通过
    await http().patch(`/projects/${p.id}/wbs/${wp.id}`).set(bearer(t.pm.token)).send({ percentComplete: 100 }).expect(200);
    await http().post(`/projects/${p.id}/wbs/${wp.id}/verify`).set(bearer(t.pqm.token)).expect(200);
    await http().patch(`/projects/${p.id}/deliverables/${dv.id}`).set(bearer(t.pm.token)).send({ status: 'ACCEPTED' }).expect(200);
    await decide(t, p.id, g.id, { decision: 'APPROVED', note: '通过' }).expect(200);
  });

  it('非项目成员看不到评审；成员可读不可改', async () => {
    const t = await setupTenant(app, 'g9');
    const p = await gateProject(app, t);
    const g = await openGate(t, p.id, p.phases[0].id);
    await http().get(`/projects/${p.id}/gate-reviews`).set(bearer(t.outsider.token)).expect(404);
    const list = await http().get(`/projects/${p.id}/gate-reviews`).set(bearer(t.member.token)).expect(200);
    expect(list.body).toHaveLength(1);
    await http().patch(`/projects/${p.id}/gate-reviews/${g.id}`).set(bearer(t.member.token)).send({ notes: 'x' }).expect(403);
    await addMember(app, t.pm.token, p.id, t.outsider.id, 'MEMBER');
    await http().get(`/projects/${p.id}/gate-reviews`).set(bearer(t.outsider.token)).expect(200);
  });
});
