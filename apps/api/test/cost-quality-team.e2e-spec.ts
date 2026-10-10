import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { addMember, bearer, createApp, createProject, gateProject, setupTenant } from './helpers.js';

describe('成本管理', () => {
  let app: INestApplication;
  beforeAll(async () => {
    app = await createApp();
  });
  afterAll(() => app.close());
  const http = () => request(app.getHttpServer());
  type T = Awaited<ReturnType<typeof setupTenant>>;

  const acct = (t: T, pid: string, body: Record<string, unknown>) =>
    http().post(`/projects/${pid}/cost/accounts`).set(bearer(t.pm.token)).send(body);
  const entry = (t: T, pid: string, body: Record<string, unknown>, token = t.pm.token) =>
    http().post(`/projects/${pid}/cost/entries`).set(bearer(token)).send({ entryDate: '2026-02-01', description: '采购', ...body });

  it('预算分解到成本科目，科目预算之和不能超过项目预算', async () => {
    const t = await setupTenant(app, 'cost1');
    const p = await createProject(app, t.pm.token, { budget: 100000 });
    await acct(t, p.id, { code: 'MAT', name: '材料', budget: 60000 }).expect(201);
    await acct(t, p.id, { code: 'LAB', name: '人工', budget: 30000 }).expect(201);
    const over = await acct(t, p.id, { code: 'OTH', name: '其他', budget: 10001 }).expect(409);
    expect(over.body.code).toBe('BUDGET_ALLOCATION_EXCEEDED');
    await acct(t, p.id, { code: 'OTH', name: '其他', budget: 10000 }).expect(201);
    await acct(t, p.id, { code: 'MAT', name: '重复', budget: 1 }).expect(409);
    await http().post(`/projects/${p.id}/cost/accounts`).set(bearer(t.member.token)).send({ code: 'X', name: 'x', budget: 1 }).expect(404); // 非项目成员
    await addMember(app, t.pm.token, p.id, t.member.id, 'MEMBER');
    await http().post(`/projects/${p.id}/cost/accounts`).set(bearer(t.member.token)).send({ code: 'X', name: 'x', budget: 1 }).expect(403);

    const s = (await http().get(`/projects/${p.id}/cost`).set(bearer(t.pm.token)).expect(200)).body;
    expect(s).toMatchObject({ projectBudget: 100000, allocated: 100000, unallocated: 0 });
  });

  it('未设置项目预算时不能分配科目', async () => {
    const t = await setupTenant(app, 'cost2');
    const p = await createProject(app, t.pm.token, { budget: undefined });
    await acct(t, p.id, { code: 'A', name: 'A', budget: 1 }).expect(400);
  });

  it('实际成本、ETC、EAC 与偏差；超支预警', async () => {
    const t = await setupTenant(app, 'cost3');
    const p = await createProject(app, t.pm.token, { budget: 100000 });
    const mat = (await acct(t, p.id, { code: 'MAT', name: '材料', budget: 60000 }).expect(201)).body;
    const lab = (await acct(t, p.id, { code: 'LAB', name: '人工', budget: 40000 }).expect(201)).body;
    await entry(t, p.id, { accountId: mat.id, amount: 20000 }).expect(201);
    await entry(t, p.id, { accountId: mat.id, amount: 15000 }).expect(201);

    let s = (await http().get(`/projects/${p.id}/cost`).set(bearer(t.pm.token)).expect(200)).body;
    let m = s.accounts.find((a: { code: string }) => a.code === 'MAT');
    expect(m).toMatchObject({ actual: 35000, etc: 25000, eac: 60000, variance: 0, overrun: false });

    // 人工估算 ETC 超过剩余预算：科目和项目都预警
    await http().patch(`/projects/${p.id}/cost/accounts/${mat.id}`).set(bearer(t.pm.token)).send({ estimateToComplete: 40000 }).expect(200);
    s = (await http().get(`/projects/${p.id}/cost`).set(bearer(t.pm.token)).expect(200)).body;
    m = s.accounts.find((a: { code: string }) => a.code === 'MAT');
    expect(m).toMatchObject({ eac: 75000, variance: -15000, overrun: true, etcIsManual: true });
    expect(s).toMatchObject({ actual: 35000, eac: 115000, variance: -15000, overrun: true });
    const labRow = s.accounts.find((a: { code: string }) => a.code === lab.code);
    expect(labRow).toMatchObject({ actual: 0, etc: 40000, eac: 40000, overrun: false });
  });

  it('成本记录只增不改：用负数冲销，净额不能为负；成员可读不可写', async () => {
    const t = await setupTenant(app, 'cost4');
    const p = await createProject(app, t.pm.token, { budget: 50000 });
    await addMember(app, t.pm.token, p.id, t.member.id, 'MEMBER');
    const a = (await acct(t, p.id, { code: 'MAT', name: '材料', budget: 50000 }).expect(201)).body;
    const e1 = (await entry(t, p.id, { accountId: a.id, amount: 1000 }).expect(201)).body;
    await entry(t, p.id, { accountId: a.id, amount: -400, description: '冲销录入错误' }).expect(201);
    await entry(t, p.id, { accountId: a.id, amount: -700 }).expect(400);
    await entry(t, p.id, { accountId: a.id, amount: 0 }).expect(400);
    await entry(t, p.id, { accountId: a.id, amount: 5 }, t.member.token).expect(403);
    await http().delete(`/projects/${p.id}/cost/entries/${e1.id}`).set(bearer(t.pm.token)).expect(404); // 没有删除接口

    const s = (await http().get(`/projects/${p.id}/cost`).set(bearer(t.member.token)).expect(200)).body;
    expect(s.actual).toBe(600);
    const list = await http().get(`/projects/${p.id}/cost/entries`).set(bearer(t.member.token)).expect(200);
    expect(list.body).toHaveLength(2);
    await http().get(`/projects/${p.id}/cost`).set(bearer(t.outsider.token)).expect(404);
  });

  it('预算变更批准并实施后，可继续分配更多科目预算', async () => {
    const t = await setupTenant(app, 'cost5');
    const p = await gateProject(app, t);
    await acct(t, p.id, { code: 'MAT', name: '材料', budget: 1000000 }).expect(201);
    await acct(t, p.id, { code: 'MORE', name: '追加', budget: 1 }).expect(409);
    const cr = (await http().post(`/projects/${p.id}/changes`).set(bearer(t.member.token)).send({
      type: 'BUDGET', title: '追加预算', description: 'x', reason: 'y', impactAnalysis: 'z', proposed: { budget: 1100000 },
    }).expect(201)).body;
    await http().post(`/projects/${p.id}/changes/${cr.id}/submit`).set(bearer(t.member.token)).expect(200);
    await http().post(`/projects/${p.id}/changes/${cr.id}/approve`).set(bearer(t.top.token)).send({}).expect(200);
    await http().post(`/projects/${p.id}/changes/${cr.id}/implement`).set(bearer(t.pm.token)).expect(200);
    await acct(t, p.id, { code: 'MORE', name: '追加', budget: 100000 }).expect(201);
  });
});

describe('项目质量：质量计划与不符合项 / CAR', () => {
  let app: INestApplication;
  beforeAll(async () => {
    app = await createApp();
  });
  afterAll(() => app.close());
  const http = () => request(app.getHttpServer());
  type T = Awaited<ReturnType<typeof setupTenant>>;
  const tr = (t: T, pid: string, id: string, to: string, token: string, note?: string) =>
    http().post(`/projects/${pid}/nonconformities/${id}/transition`).set(bearer(token)).send({ to, note });
  const patch = (t: T, pid: string, id: string, token: string, body: Record<string, unknown>) =>
    http().patch(`/projects/${pid}/nonconformities/${id}`).set(bearer(token)).send(body);
  const newNc = async (t: T, pid: string, severity = 'MAJOR') =>
    (await http().post(`/projects/${pid}/nonconformities`).set(bearer(t.member.token)).send({
      title: '焊缝气孔', description: '转向架构架焊缝发现气孔', severity, source: 'INSPECTION',
    }).expect(201)).body as { id: string; code: string };

  it('质量计划：保存后需质量经理批准，且必须含 QA 与 QC 活动；修改后需重新批准', async () => {
    const t = await setupTenant(app, 'q1');
    const p = await gateProject(app, t);
    const put = (token: string, body: Record<string, unknown>) => http().put(`/projects/${p.id}/quality-plan`).set(bearer(token)).send(body);
    await put(t.member.token, { objectives: 'x' }).expect(403);
    await put(t.pqm.token, { objectives: '一次交检合格率 ≥ 98%', activities: [{ kind: 'QA', name: '过程审核' }] }).expect(200);
    const inc = await http().post(`/projects/${p.id}/quality-plan/approve`).set(bearer(t.pqm.token)).expect(409);
    expect(inc.body.code).toBe('QUALITY_PLAN_INCOMPLETE');
    await put(t.pqm.token, { activities: [{ kind: 'QA', name: '过程审核' }, { kind: 'QC', name: '焊缝无损检测', frequency: '每批' }] }).expect(200);
    await http().post(`/projects/${p.id}/quality-plan/approve`).set(bearer(t.pm.token)).expect(403); // 项目经理不能批准
    const ok = await http().post(`/projects/${p.id}/quality-plan/approve`).set(bearer(t.pqm.token)).expect(200);
    expect(ok.body.approvedAt).toBeTruthy();
    const again = await put(t.pm.token, { procedures: '按 WI-001 执行' }).expect(200);
    expect(again.body).toMatchObject({ version: 3, approvedAt: null });
    expect((await http().get(`/projects/${p.id}/quality-plan`).set(bearer(t.member.token)).expect(200)).body.objectives).toContain('98%');
  });

  it('不符合项完整闭环，每一步都有前置条件', async () => {
    const t = await setupTenant(app, 'q2');
    const p = await gateProject(app, t);
    const nc = await newNc(t, p.id, 'MINOR');
    expect(nc.code).toBe('NC-001');

    await tr(t, p.id, nc.id, 'CLOSED', t.pqm.token, '直接关闭').expect(409); // 不能跳步
    await tr(t, p.id, nc.id, 'ANALYSIS', t.member.token).expect(403);
    await tr(t, p.id, nc.id, 'ANALYSIS', t.pqm.token).expect(200);

    const bad = await tr(t, p.id, nc.id, 'ACTION', t.pqm.token).expect(400);
    expect(bad.body.problems).toHaveLength(5);
    await patch(t, p.id, nc.id, t.pqm.token, {
      containment: '隔离该批次并全检', rootCause: '焊接保护气流量偏低（5-Why）', correctiveAction: '更换流量计并重新标定',
      preventiveAction: '纳入日点检', actionOwnerId: t.member.id, actionDueDate: '2026-03-01',
    }).expect(200);
    await tr(t, p.id, nc.id, 'ACTION', t.pqm.token).expect(200);

    await tr(t, p.id, nc.id, 'VERIFICATION', t.outsider.token).expect(404);
    await tr(t, p.id, nc.id, 'VERIFICATION', t.member.token).expect(200); // 措施负责人可提交验证
    await tr(t, p.id, nc.id, 'CLOSED', t.member.token, '有效').expect(403); // 负责人不能验证自己的措施
    await tr(t, p.id, nc.id, 'CLOSED', t.pqm.token).expect(400);           // 缺有效性结论
    const closed = await tr(t, p.id, nc.id, 'CLOSED', t.pqm.token, '复检 3 批无气孔').expect(200);
    expect(closed.body).toMatchObject({ status: 'CLOSED', effectivenessNote: '复检 3 批无气孔' });
    await patch(t, p.id, nc.id, t.pqm.token, { rootCause: '篡改' }).expect(409); // 已关闭不可改
    const logs = await http().get(`/audit-logs?entity=Nonconformity&entityId=${nc.id}`).set(bearer(t.admin.token)).expect(200);
    expect(logs.body.map((l: { action: string }) => l.action)).toEqual(expect.arrayContaining(['nonconformity.analysis', 'nonconformity.action', 'nonconformity.verification', 'nonconformity.closed']));
  });

  it('质量经理自己负责的纠正措施，不能由本人验证关闭', async () => {
    const t = await setupTenant(app, 'q2b');
    const p = await gateProject(app, t);
    const nc = await newNc(t, p.id, 'MINOR');
    await tr(t, p.id, nc.id, 'ANALYSIS', t.pqm.token).expect(200);
    await patch(t, p.id, nc.id, t.pqm.token, { containment: 'a', rootCause: 'b', correctiveAction: 'c', actionOwnerId: t.pqm.id, actionDueDate: '2026-03-01' }).expect(200);
    await tr(t, p.id, nc.id, 'ACTION', t.pqm.token).expect(200);
    await tr(t, p.id, nc.id, 'VERIFICATION', t.pqm.token).expect(200);
    await tr(t, p.id, nc.id, 'CLOSED', t.pqm.token, '自己验证自己').expect(403);
    await tr(t, p.id, nc.id, 'CLOSED', t.pm.token, '项目经理复核有效').expect(200);
  });

  it('措施无效可退回；重大不符合项只能由质量经理关闭', async () => {
    const t = await setupTenant(app, 'q3');
    const p = await gateProject(app, t);
    const nc = await newNc(t, p.id, 'MAJOR');
    await tr(t, p.id, nc.id, 'ANALYSIS', t.pm.token).expect(200);
    await patch(t, p.id, nc.id, t.pm.token, { containment: 'a', rootCause: 'b', correctiveAction: 'c', actionOwnerId: t.member.id, actionDueDate: '2026-03-01' }).expect(200);
    await tr(t, p.id, nc.id, 'ACTION', t.pm.token).expect(200);
    await tr(t, p.id, nc.id, 'VERIFICATION', t.member.token).expect(200);
    await tr(t, p.id, nc.id, 'ACTION', t.pm.token).expect(400); // 退回必须写原因
    await tr(t, p.id, nc.id, 'ACTION', t.pm.token, '复检仍有气孔').expect(200);
    await tr(t, p.id, nc.id, 'VERIFICATION', t.member.token).expect(200);
    await tr(t, p.id, nc.id, 'CLOSED', t.pm.token, '有效').expect(403); // 重大不符合项，项目经理不能关闭
    await tr(t, p.id, nc.id, 'CLOSED', t.pqm.token, '有效').expect(200);
  });

  it('未关闭的重大 / 严重不符合项阻止阶段直接通过，轻微的不阻止', async () => {
    const t = await setupTenant(app, 'q4');
    const p = await gateProject(app, t);
    const mj = await newNc(t, p.id, 'MAJOR');
    await newNc(t, p.id, 'MINOR');
    const g = (await http().post(`/projects/${p.id}/phases/${p.phases[0].id}/gate-reviews`).set(bearer(t.pm.token)).expect(201)).body;
    await http().patch(`/projects/${p.id}/gate-reviews/${g.id}`).set(bearer(t.pm.token))
      .send({ attendees: [t.pm.id], checklistResults: [{ item: '设计评审完成', passed: true }] }).expect(200);
    const blocked = await http().post(`/projects/${p.id}/gate-reviews/${g.id}/decision`).set(bearer(t.pm.token)).send({ decision: 'APPROVED', note: '通过' }).expect(409);
    expect(blocked.body.blockers.nonconformities).toEqual([mj.code]);

    await tr(t, p.id, mj.id, 'ANALYSIS', t.pqm.token).expect(200);
    await patch(t, p.id, mj.id, t.pqm.token, { containment: 'a', rootCause: 'b', correctiveAction: 'c', actionOwnerId: t.member.id, actionDueDate: '2026-03-01' }).expect(200);
    await tr(t, p.id, mj.id, 'ACTION', t.pqm.token).expect(200);
    await tr(t, p.id, mj.id, 'VERIFICATION', t.member.token).expect(200);
    await tr(t, p.id, mj.id, 'CLOSED', t.pqm.token, '有效').expect(200);
    await http().post(`/projects/${p.id}/gate-reviews/${g.id}/decision`).set(bearer(t.pm.token)).send({ decision: 'APPROVED', note: '通过' }).expect(200);
  });

  it('非项目成员不能登记不符合项', async () => {
    const t = await setupTenant(app, 'q5');
    const p = await gateProject(app, t);
    await http().post(`/projects/${p.id}/nonconformities`).set(bearer(t.outsider.token)).send({ title: 'xx', description: 'y', severity: 'MINOR', source: 'OTHER' }).expect(404);
    await http().post(`/projects/${p.id}/nonconformities`).set(bearer(t.member.token)).send({ title: 'xx', description: 'y', severity: 'MINOR', source: 'OTHER', workPackageId: '00000000-0000-4000-8000-000000000000' }).expect(400);
  });
});

describe('沟通与培训', () => {
  let app: INestApplication;
  beforeAll(async () => {
    app = await createApp();
  });
  afterAll(() => app.close());
  const http = () => request(app.getHttpServer());

  it('沟通计划由项目经理维护，沟通记录由成员登记', async () => {
    const t = await setupTenant(app, 't1');
    const p = await gateProject(app, t);
    await http().put(`/projects/${p.id}/communication-plan`).set(bearer(t.member.token)).send({ notes: 'x' }).expect(403);
    const plan = await http().put(`/projects/${p.id}/communication-plan`).set(bearer(t.pm.token))
      .send({ channels: [{ audience: '客户', channel: '周报邮件', frequency: '每周' }] }).expect(200);
    expect(plan.body.version).toBe(1);
    await http().post(`/projects/${p.id}/communication-logs`).set(bearer(t.outsider.token)).send({ kind: 'MEETING', logDate: '2026-02-02', subject: 'x', summary: 'y' }).expect(404);
    await http().post(`/projects/${p.id}/communication-logs`).set(bearer(t.member.token)).send({ kind: 'CUSTOMER', logDate: '2026-02-02', subject: '交期沟通', summary: '客户同意顺延两周' }).expect(201);
    const logs = await http().get(`/projects/${p.id}/communication-logs`).set(bearer(t.pqm.token)).expect(200);
    expect(logs.body).toHaveLength(1);
  });

  it('培训记录：项目经理安排，本人或项目经理确认完成', async () => {
    const t = await setupTenant(app, 't2');
    const p = await gateProject(app, t);
    await http().post(`/projects/${p.id}/trainings`).set(bearer(t.member.token)).send({ userId: t.member.id, title: '焊接检验' }).expect(403);
    await http().post(`/projects/${p.id}/trainings`).set(bearer(t.pm.token)).send({ userId: t.outsider.id, title: 'x' }).expect(400);
    const tr = (await http().post(`/projects/${p.id}/trainings`).set(bearer(t.pm.token)).send({ userId: t.member.id, title: '焊接检验', dueDate: '2026-04-01' }).expect(201)).body;
    await http().patch(`/projects/${p.id}/trainings/${tr.id}`).set(bearer(t.pqm.token)).send({ status: 'DONE' }).expect(403);
    const done = await http().patch(`/projects/${p.id}/trainings/${tr.id}`).set(bearer(t.member.token)).send({ status: 'DONE' }).expect(200);
    expect(done.body.completedAt).toBeTruthy();
  });
});
