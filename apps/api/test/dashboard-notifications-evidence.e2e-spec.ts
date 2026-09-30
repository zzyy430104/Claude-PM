import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { EmailService } from '../src/notifications/email.service.js';
import { addMember, bearer, createApp, createProject, gateProject, setupTenant } from './helpers.js';

const http = (app: INestApplication) => request(app.getHttpServer());

describe('仪表盘与待办', () => {
  let app: INestApplication;
  beforeAll(async () => {
    app = await createApp();
  });
  afterAll(() => app.close());

  it('健康度：无异常为绿；预计完工晚于计划为红；高分风险 / 逾期行动项为黄', async () => {
    const t = await setupTenant(app, 'db1');
    const green = await gateProject(app, t);
    // 项目评审周期 30 天，从未评审过就算逾期，所以绿色项目要有一次最近的评审
    await http(app).post(`/projects/${green.id}/reviews`).set(bearer(t.pm.token)).send({ reviewDate: new Date().toISOString().slice(0, 10), attendees: [t.pm.id] }).expect(201);
    // 制造一个红色项目：工期 30 天，计划只有 10 天
    const red = await createProject(app, t.pm.token, { startDate: '2026-01-01', endDate: '2026-01-10' });
    await http(app).post(`/projects/${red.id}/wbs`).set(bearer(t.pm.token)).send({ code: 'A', name: 'A', durationDays: 30 }).expect(201);
    await http(app).post(`/projects/${red.id}/baseline`).set(bearer(t.pm.token)).expect(200);
    // 黄色项目：高分风险 + 逾期行动项
    const amber = await gateProject(app, t);
    await http(app).post(`/projects/${amber.id}/risks`).set(bearer(t.pm.token)).send({
      kind: 'RISK', title: '关键件延期', probability: 5, impact: 4, exposureAmount: 1, responseCost: 1, costBenefitAnalysis: '分析',
    }).expect(201);
    await http(app).post(`/projects/${amber.id}/issues`).set(bearer(t.pm.token)).send({ title: '逾期事项', kind: 'ACTION', dueDate: '2020-01-01' }).expect(201);

    const d = (await http(app).get('/dashboard').set(bearer(t.top.token)).expect(200)).body;
    const by = Object.fromEntries(d.projects.map((p: { code: string }) => [p.code, p]));
    expect(by[green.code]).toMatchObject({ health: 'GREEN', reasons: [] });
    expect(by[red.code].health).toBe('RED');
    expect(by[red.code].reasons[0]).toContain('晚于计划');
    expect(by[amber.code].health).toBe('AMBER');
    expect(by[amber.code]).toMatchObject({ highRisks: 1, overdueActions: 1 });
    expect(d.totals).toMatchObject({ projects: 3, red: 1, amber: 1, green: 1 });
  });

  it('成本预计超支 → 红；严重不符合项未关闭 → 红', async () => {
    const t = await setupTenant(app, 'db2');
    const p = await createProject(app, t.pm.token, { budget: 100000 });
    const acct = (await http(app).post(`/projects/${p.id}/cost/accounts`).set(bearer(t.pm.token)).send({ code: 'MAT', name: '材料', budget: 100000 }).expect(201)).body;
    await http(app).post(`/projects/${p.id}/cost/entries`).set(bearer(t.pm.token)).send({ accountId: acct.id, amount: 120000, entryDate: '2026-02-01', description: '采购' }).expect(201);
    const d = (await http(app).get('/dashboard').set(bearer(t.pm.token)).expect(200)).body;
    expect(d.projects.find((x: { id: string }) => x.id === p.id).health).toBe('RED');
    expect(d.projects.find((x: { id: string }) => x.id === p.id).cost).toMatchObject({ overrun: true });

    // 单个科目超支但项目总体未超：黄色
    const q0 = await createProject(app, t.pm.token, { budget: 1000000 });
    const a0 = (await http(app).post(`/projects/${q0.id}/cost/accounts`).set(bearer(t.pm.token)).send({ code: 'MAT', name: '材料', budget: 100000 }).expect(201)).body;
    await http(app).post(`/projects/${q0.id}/cost/entries`).set(bearer(t.pm.token)).send({ accountId: a0.id, amount: 120000, entryDate: '2026-02-01', description: '采购' }).expect(201);
    const d1 = (await http(app).get('/dashboard').set(bearer(t.pm.token)).expect(200)).body;
    expect(d1.projects.find((x: { id: string }) => x.id === q0.id)).toMatchObject({ health: 'AMBER' });
    expect(d1.projects.find((x: { id: string }) => x.id === q0.id).reasons.join()).toContain('成本科目预计超支');

    const q = await gateProject(app, t);
    await http(app).post(`/projects/${q.id}/nonconformities`).set(bearer(t.member.token)).send({ title: '重大缺陷', description: 'x', severity: 'CRITICAL', source: 'INSPECTION' }).expect(201);
    const d2 = (await http(app).get('/dashboard').set(bearer(t.top.token)).expect(200)).body;
    expect(d2.projects.find((x: { id: string }) => x.id === q.id).reasons.join()).toContain('严重不符合项');
  });

  it('可见范围：普通成员只看自己参与的项目；其他企业看不到', async () => {
    const t = await setupTenant(app, 'db3');
    const other = await setupTenant(app, 'db3b');
    const p = await gateProject(app, t);
    await gateProject(app, other);
    expect((await http(app).get('/dashboard').set(bearer(t.outsider.token)).expect(200)).body.totals.projects).toBe(0);
    expect((await http(app).get('/dashboard').set(bearer(t.member.token)).expect(200)).body.projects.map((x: { id: string }) => x.id)).toEqual([p.id]);
    expect((await http(app).get('/dashboard').set(bearer(t.admin.token)).expect(200)).body.totals.projects).toBe(1);
    await http(app).get('/dashboard').set(bearer(other.admin.token)).expect(200);
  });

  it('我的待办：待审批变更、分配给我的行动项和培训', async () => {
    const t = await setupTenant(app, 'todo1');
    const p = await gateProject(app, t);
    const cr = (await http(app).post(`/projects/${p.id}/changes`).set(bearer(t.member.token)).send({ type: 'OTHER', title: '流程调整', description: 'd', reason: 'r', impactAnalysis: 'i' }).expect(201)).body;
    await http(app).post(`/projects/${p.id}/changes/${cr.id}/submit`).set(bearer(t.member.token)).expect(200);
    await http(app).post(`/projects/${p.id}/issues`).set(bearer(t.pm.token)).send({ title: '补充记录', kind: 'ACTION', ownerId: t.member.id, dueDate: '2026-03-01' }).expect(201);
    await http(app).post(`/projects/${p.id}/trainings`).set(bearer(t.pm.token)).send({ userId: t.member.id, title: '焊接检验' }).expect(201);

    const pm = (await http(app).get('/me/todos').set(bearer(t.pm.token)).expect(200)).body;
    expect(pm.map((x: { kind: string }) => x.kind)).toContain('CHANGE_APPROVAL');
    const mine = (await http(app).get('/me/todos').set(bearer(t.member.token)).expect(200)).body;
    expect(mine.map((x: { kind: string }) => x.kind).sort()).toEqual(['ISSUE', 'TRAINING']);
    expect(mine[0].dueDate).toBe('2026-03-01'); // 有期限的排在前面
    expect((await http(app).get('/me/todos').set(bearer(t.outsider.token)).expect(200)).body).toEqual([]);
  });
});

describe('通知', () => {
  let app: INestApplication;
  beforeAll(async () => {
    app = await createApp();
  });
  afterAll(() => app.close());

  const unread = async (token: string) => (await http(app).get('/notifications/count').set(bearer(token)).expect(200)).body.count as number;

  it('变更提交通知审批人，批准后通知申请人；已读状态只影响本人', async () => {
    const t = await setupTenant(app, 'nt1');
    const p = await gateProject(app, t);
    EmailService.outbox.length = 0;
    const cr = (await http(app).post(`/projects/${p.id}/changes`).set(bearer(t.member.token)).send({ type: 'OTHER', title: '流程调整', description: 'd', reason: 'r', impactAnalysis: 'i' }).expect(201)).body;
    await http(app).post(`/projects/${p.id}/changes/${cr.id}/submit`).set(bearer(t.member.token)).expect(200);

    expect(await unread(t.pm.token)).toBe(1);    // CCB（项目经理）
    expect(await unread(t.top.token)).toBe(1);   // 最高管理层
    expect(await unread(t.member.token)).toBe(0); // 申请人自己不通知
    expect(await unread(t.outsider.token)).toBe(0);
    expect(EmailService.outbox.map((m) => m.to).sort()).toEqual([t.pm.email, t.top.email].sort());
    expect(EmailService.outbox[0].subject).toContain('待审批变更 CR-001');

    await http(app).post(`/projects/${p.id}/changes/${cr.id}/approve`).set(bearer(t.pm.token)).send({ note: '同意' }).expect(200);
    const mine = (await http(app).get('/notifications?unread=true').set(bearer(t.member.token)).expect(200)).body;
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ kind: 'CHANGE_DECIDED', link: `/projects/${p.id}` });

    // 已读只影响自己；不能标记别人的通知
    const pmList = (await http(app).get('/notifications').set(bearer(t.pm.token)).expect(200)).body;
    await http(app).post(`/notifications/${pmList[0].id}/read`).set(bearer(t.top.token)).expect(404);
    await http(app).post(`/notifications/${pmList[0].id}/read`).set(bearer(t.pm.token)).expect(204);
    expect(await unread(t.pm.token)).toBe(0);
    expect(await unread(t.top.token)).toBe(1);
    await http(app).post('/notifications/read-all').set(bearer(t.member.token)).expect(204);
    expect(await unread(t.member.token)).toBe(0);
  });

  it('行动项、培训、关口结论、投标审批都会通知相关人，且不跨企业', async () => {
    const t = await setupTenant(app, 'nt2');
    const other = await setupTenant(app, 'nt2b');
    const p = await gateProject(app, t);
    await http(app).post(`/projects/${p.id}/issues`).set(bearer(t.pm.token)).send({ title: '补图纸', kind: 'ACTION', ownerId: t.member.id }).expect(201);
    await http(app).post(`/projects/${p.id}/trainings`).set(bearer(t.pm.token)).send({ userId: t.member.id, title: '焊接检验' }).expect(201);
    const kinds = (await http(app).get('/notifications').set(bearer(t.member.token)).expect(200)).body.map((n: { kind: string }) => n.kind).sort();
    expect(kinds).toEqual(['ISSUE_ASSIGNED', 'TRAINING']);

    const g = (await http(app).post(`/projects/${p.id}/phases/${p.phases[0].id}/gate-reviews`).set(bearer(t.pm.token)).expect(201)).body;
    await http(app).patch(`/projects/${p.id}/gate-reviews/${g.id}`).set(bearer(t.pm.token)).send({ attendees: [t.pm.id] }).expect(200);
    await http(app).post(`/projects/${p.id}/gate-reviews/${g.id}/decision`).set(bearer(t.pm.token)).send({ decision: 'REJECTED', note: '设计输入不完整' }).expect(200);
    expect((await http(app).get('/notifications?unread=true').set(bearer(t.pqm.token)).expect(200)).body.map((n: { kind: string }) => n.kind)).toContain('GATE_DECIDED');
    expect(await unread(t.pm.token)).toBe(0); // 操作人自己不通知

    expect(await unread(other.admin.token)).toBe(0);
    expect(await unread(other.pm.token)).toBe(0);

    const tender = (await http(app).post('/tenders').set(bearer(t.pm.token)).send({ code: 'T-N1', title: '通知测试投标', customer: 'c' }).expect(201)).body;
    await http(app).patch(`/tenders/${tender.id}`).set(bearer(t.pm.token)).send({
      requirements: 'r', riskAssessment: 'a', riskExposure: 1, knowledgeInputs: 'k', deliverablesPlan: 'd', estimatedCost: 1, offerPrice: 2, resourcePlan: 'p',
    }).expect(200);
    await http(app).post(`/tenders/${tender.id}/submit`).set(bearer(t.pm.token)).expect(200);
    expect((await http(app).get('/notifications').set(bearer(t.top.token)).expect(200)).body.map((n: { kind: string }) => n.kind)).toContain('TENDER_SUBMITTED');
    await http(app).post(`/tenders/${tender.id}/approve`).set(bearer(t.top.token)).send({ note: '同意' }).expect(200);
    expect((await http(app).get('/notifications').set(bearer(t.pm.token)).expect(200)).body.map((n: { kind: string }) => n.kind)).toContain('TENDER_DECIDED');
  });
});

describe('审核证据包', () => {
  let app: INestApplication;
  beforeAll(async () => {
    app = await createApp();
  });
  afterAll(() => app.close());

  const binary = (res: request.Response, done: (err: Error | null, body: Buffer) => void) => {
    const chunks: Buffer[] = [];
    res.on('data', (c: Buffer) => chunks.push(c));
    res.on('end', () => done(null, Buffer.concat(chunks)));
  };
  const pack = (pid: string, token: string) => http(app).get(`/projects/${pid}/evidence-pack`).set(bearer(token)).buffer(true).parse(binary);

  it('导出 ZIP：含各类记录、文档全部版本、审计日志和 SHA-256 清单', async () => {
    const t = await setupTenant(app, 'ev1');
    const p = await gateProject(app, t);
    await http(app).post(`/projects/${p.id}/documents`).set(bearer(t.pm.token)).field('folder', '06-评审记录').field('name', '设计评审纪要')
      .attach('file', Buffer.from('评审纪要 v1'), 'minutes-v1.txt').expect(201);
    await http(app).post(`/projects/${p.id}/documents`).set(bearer(t.pm.token)).field('folder', '06-评审记录').field('name', '设计评审纪要')
      .attach('file', Buffer.from('评审纪要 v2'), 'minutes-v2.txt').expect(201);
    await http(app).post(`/projects/${p.id}/risks`).set(bearer(t.pm.token)).send({ kind: 'RISK', title: '外协延期', probability: 3, impact: 3, exposureAmount: 1, responseCost: 1, costBenefitAnalysis: '分析' }).expect(201);

    const res = await pack(p.id, t.pqm.token).expect(200);
    const zip = res.body as Buffer;
    expect(res.headers['content-type']).toContain('application/zip');
    expect(zip.subarray(0, 2).toString()).toBe('PK');
    const text = zip.toString('latin1');
    for (const name of ['INDEX.md', 'MANIFEST.sha256', 'audit-logs.json', 'risks.json', 'gate-reviews.json', 'change-requests.json', 'cost.json', 'quality-plan.json']) {
      expect(text).toContain(name);
    }
    expect(Buffer.from(zip).includes(Buffer.from('documents/06-评审记录/设计评审纪要_v1_minutes-v1.txt'))).toBe(true);
    expect(Buffer.from(zip).includes(Buffer.from('documents/06-评审记录/设计评审纪要_v2_minutes-v2.txt'))).toBe(true);

    const logs = await http(app).get(`/audit-logs?entity=Project&entityId=${p.id}`).set(bearer(t.admin.token)).expect(200);
    expect(logs.body.map((l: { action: string }) => l.action)).toContain('evidencePack.export'); // 导出行为本身也留痕
  });

  it('权限：只有项目经理、质量经理、最高管理层、企业管理员可导出', async () => {
    const t = await setupTenant(app, 'ev2');
    const other = await setupTenant(app, 'ev2b');
    const p = await gateProject(app, t);
    await pack(p.id, t.member.token).expect(403);
    await pack(p.id, t.outsider.token).expect(404);
    await pack(p.id, other.admin.token).expect(404);
    for (const who of [t.pm, t.pqm, t.top, t.admin]) await pack(p.id, who.token).expect(200);
    await addMember(app, t.pm.token, p.id, t.outsider.id, 'MEMBER');
    await pack(p.id, t.outsider.token).expect(403);
  });
});
