import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { bearer, createApp, gateProject, setupTenant } from './helpers.js';

describe('风险与机会、项目评审、问题', () => {
  let app: INestApplication;
  beforeAll(async () => {
    app = await createApp();
  });
  afterAll(() => app.close());
  const http = () => request(app.getHttpServer());

  const risk = {
    kind: 'RISK', title: '供应商延期', probability: 4, impact: 3,
    exposureAmount: 200000, responseCost: 30000, costBenefitAnalysis: '提前下单可避免大部分损失',
  };

  it('风险登记：定了应对策略就要有成本收益分析，自动计算评分与期望价值', async () => {
    const t = await setupTenant(app, 'r1');
    const p = await gateProject(app, t);
    const { costBenefitAnalysis: _omit, ...missing } = risk;
    const noCba = await http().post(`/projects/${p.id}/risks`).set(bearer(t.pm.token)).send({ ...missing, strategy: '减弱' }).expect(400);
    expect(noCba.body.code).toBe('CBA_REQUIRED');
    await http().post(`/projects/${p.id}/risks`).set(bearer(t.pm.token)).send({ ...risk, probability: 9 }).expect(400);
    await http().post(`/projects/${p.id}/risks`).set(bearer(t.outsider.token)).send(risk).expect(404);

    const r = (await http().post(`/projects/${p.id}/risks`).set(bearer(t.member.token)).send(risk).expect(201)).body;
    const list = await http().get(`/projects/${p.id}/risks`).set(bearer(t.pm.token)).expect(200);
    expect(list.body[0]).toMatchObject({ score: 12, expectedValue: 140000, netBenefitOfResponse: 110000, openActions: 0 });

    const act = (await http().post(`/projects/${p.id}/risks/${r.id}/actions`).set(bearer(t.pm.token)).send({ title: '提前下单', ownerId: t.member.id }).expect(201)).body;
    const after = await http().get(`/projects/${p.id}/risks`).set(bearer(t.pm.token)).expect(200);
    expect(after.body[0].openActions).toBe(1);

    // 其他成员不能改；关闭需要写明结论；机会同样登记
    await http().patch(`/projects/${p.id}/risks/${r.id}`).set(bearer(t.pqm.token)).send({ status: 'MITIGATING' }).expect(200); // 质量经理可以
    const closed = await http().patch(`/projects/${p.id}/risks/${r.id}`).set(bearer(t.pm.token)).send({ status: 'CLOSED' }).expect(400);
    expect(JSON.stringify(closed.body)).toContain('closureNote');
    // 措施没完成不能关闭；完成后风险进入待复评
    expect((await http().patch(`/projects/${p.id}/risks/${r.id}`).set(bearer(t.pm.token)).send({ status: 'CLOSED', closureNote: '已按期到货' }).expect(409)).body.code).toBe('MEASURES_OPEN');
    await http().patch(`/projects/${p.id}/issues/${act.id}`).set(bearer(t.member.token)).send({ status: 'CLOSED', closureNote: '已下单' }).expect(200);
    expect((await http().get(`/projects/${p.id}/risks`).set(bearer(t.pm.token)).expect(200)).body[0].status).toBe('REVIEW');
    await http().patch(`/projects/${p.id}/risks/${r.id}`).set(bearer(t.pm.token)).send({ status: 'CLOSED', closureNote: '已按期到货' }).expect(200);
    await http().post(`/projects/${p.id}/risks`).set(bearer(t.pm.token)).send({ ...risk, kind: 'OPPORTUNITY', title: '批量采购降价' }).expect(201);
  });

  it('只有负责人或项目管理层能改风险', async () => {
    const t = await setupTenant(app, 'r2');
    const p = await gateProject(app, t);
    const r = (await http().post(`/projects/${p.id}/risks`).set(bearer(t.pm.token)).send(risk).expect(201)).body;
    await http().patch(`/projects/${p.id}/risks/${r.id}`).set(bearer(t.member.token)).send({ title: '篡改' }).expect(403);
    await http().patch(`/projects/${p.id}/risks/${r.id}`).set(bearer(t.pm.token)).send({ ownerId: t.member.id }).expect(200);
    await http().patch(`/projects/${p.id}/risks/${r.id}`).set(bearer(t.member.token)).send({ reviewed: true }).expect(200);
  });

  it('项目评审：核心团队必须出席，记录绩效快照，行动项进入问题清单，可上报管理层', async () => {
    const t = await setupTenant(app, 'rv1');
    const p = await gateProject(app, t);
    await http().post(`/projects/${p.id}/risks`).set(bearer(t.pm.token)).send(risk).expect(201);
    const body = { reviewDate: '2026-02-01', attendees: [t.pqm.id], actions: [{ title: '更新进度计划', ownerId: t.member.id, dueDate: '2026-02-10' }] };
    await http().post(`/projects/${p.id}/reviews`).set(bearer(t.pm.token)).send(body).expect(400); // 项目经理缺席
    await http().post(`/projects/${p.id}/reviews`).set(bearer(t.member.token)).send({ ...body, attendees: [t.pm.id] }).expect(403);
    await http().post(`/projects/${p.id}/reviews`).set(bearer(t.pm.token)).send({ ...body, attendees: [t.pm.id], reportedToId: t.member.id }).expect(400);

    const r = await http().post(`/projects/${p.id}/reviews`).set(bearer(t.pm.token))
      .send({ ...body, attendees: [t.pm.id, t.pqm.id], reportedToId: t.top.id, escalations: '需要追加预算' }).expect(201);
    expect(r.body.reportedAt).toBeTruthy();
    expect(r.body.performance.openRisks).toHaveLength(1);
    expect(r.body.performance.openRisks[0].score).toBe(12);
    expect(r.body.performance.progress).toHaveProperty('plannedPercent');

    const issues = await http().get(`/projects/${p.id}/issues?status=OPEN`).set(bearer(t.member.token)).expect(200);
    expect(issues.body[0]).toMatchObject({ source: 'PROJECT_REVIEW', kind: 'ACTION' });

    // 下一次评审的材料里能看到遗留行动项
    const prep = await http().get(`/projects/${p.id}/reviews/prepare`).set(bearer(t.pm.token)).expect(200);
    expect(prep.body.openIssues).toHaveLength(1);
    const list = await http().get(`/projects/${p.id}/reviews`).set(bearer(t.member.token)).expect(200);
    expect(list.body).toHaveLength(1);
  });

  it('进度指标：实际进度按工期加权，计划进度按排程推算', async () => {
    const t = await setupTenant(app, 'rv2');
    const p = await gateProject(app, t, { baseline: false });
    const a = (await http().post(`/projects/${p.id}/wbs`).set(bearer(t.pm.token)).send({ code: 'A', name: 'A', durationDays: 10 }).expect(201)).body;
    await http().post(`/projects/${p.id}/wbs`).set(bearer(t.pm.token)).send({ code: 'B', name: 'B', durationDays: 30 }).expect(201);
    await http().patch(`/projects/${p.id}/wbs/${a.id}`).set(bearer(t.pm.token)).send({ percentComplete: 100 }).expect(200);
    const prep = await http().get(`/projects/${p.id}/reviews/prepare`).set(bearer(t.pm.token)).expect(200);
    // 项目开始于 2026-01-05，今天远晚于此：计划进度 100%；实际 10/40 = 25%
    expect(prep.body.progress).toMatchObject({ plannedPercent: 100, actualPercent: 25, leafCount: 2 });
    expect(prep.body.progress.varianceDays).toBeLessThan(0);
  });

  it('问题：成员可登记；非负责人的普通成员不能改；只有登记的问题才会出现在清单', async () => {
    const t = await setupTenant(app, 'i1');
    const p = await gateProject(app, t);
    const i = (await http().post(`/projects/${p.id}/issues`).set(bearer(t.member.token)).send({ title: '图纸版本冲突' }).expect(201)).body;
    expect(i.kind).toBe('ISSUE');
    await http().post(`/projects/${p.id}/issues`).set(bearer(t.outsider.token)).send({ title: 'x' }).expect(404);
    await http().patch(`/projects/${p.id}/issues/${i.id}`).set(bearer(t.pqm.token)).send({ ownerId: t.member.id }).expect(200);
    await http().patch(`/projects/${p.id}/issues/${i.id}`).set(bearer(t.member.token)).send({ status: 'CLOSED', closureNote: '已统一' }).expect(200);
    await http().patch(`/projects/${p.id}/issues/${i.id}`).set(bearer(t.pm.token)).send({ title: '再改' }).expect(409); // 已关闭
  });
});
