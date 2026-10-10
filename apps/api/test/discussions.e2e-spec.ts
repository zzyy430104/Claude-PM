import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { EmailService } from '../src/notifications/email.service.js';
import { bearer, createApp, setupTenant } from './helpers.js';

const req = {
  deliveryDate: '2027-09-30', milestones: [], deliverables: [{ name: '牵引拉杆总成', quantity: '1200 件', kind: 'PRODUCT' }], stockLines: [],
  quality: { standards: ['ISO/TS 22163'], special: '', acceptance: '出厂检验', fai: true, faiReason: '', customerWitness: false, drawingApproval: false, rams: false },
  cost: { cap: 3_000_000, target: 2_850_000 }, longLead: false, risks: [{ text: '铸件供应商产能', kind: 'RISK' }],
};

describe('讨论、邮件偏好、工作台', () => {
  let app: INestApplication;
  const http = () => request(app.getHttpServer());
  beforeAll(async () => { app = await createApp(); });
  afterAll(() => app.close());

  it('在工作包、风险上讨论并 @ 项目成员；负责人和参与讨论的人收到回复通知；作者可删除；按类别关闭邮件；工作台数据', async () => {
    const t = await setupTenant(app, 'ds1');
    const i = (await http().post('/initiations').set(bearer(t.pm.token)).send({ name: '地铁转向架牵引拉杆', type: 'B', projectCode: 'DS-01', customer: '华南城轨', proposedPmId: t.pm.id, startDate: '2026-11-02', requirements: req }).expect(201)).body;
    await http().post(`/initiations/${i.id}/submit`).set(bearer(t.pm.token)).expect(200);
    const pid = (await http().post(`/initiations/${i.id}/approve`).set(bearer(t.top.token)).send({}).expect(200)).body.projectId as string;
    await http().post(`/projects/${pid}/members`).set(bearer(t.pm.token)).send({ userId: t.member.id, projectRole: 'MEMBER' }).expect(201);
    await http().post(`/projects/${pid}/members`).set(bearer(t.pm.token)).send({ userId: t.pqm.id, projectRole: 'PROJECT_QUALITY_MANAGER' }).expect(201);
    const wbs = (await http().get(`/projects/${pid}/wbs`).set(bearer(t.pm.token)).expect(200)).body;
    const wp = wbs.items.find((w: { isLeaf: boolean }) => w.isLeaf);
    await http().patch(`/projects/${pid}/wbs/${wp.id}`).set(bearer(t.pm.token)).send({ ownerId: t.member.id }).expect(200);

    // 邮件偏好：成员关闭“讨论”类邮件
    expect((await http().get('/notifications/email-prefs').set(bearer(t.member.token)).expect(200)).body.prefs).toMatchObject({ DISCUSSION: true, MEETING: true });
    await http().put('/notifications/email-prefs').set(bearer(t.member.token)).send({ DISCUSSION: false, BOGUS: false }).expect(200);
    expect((await http().get('/notifications/email-prefs').set(bearer(t.member.token)).expect(200)).body.prefs).toMatchObject({ DISCUSSION: false, TASK: true });

    // 讨论：非项目成员不能 @；对象须属于本项目
    const base = { entityType: 'WORK_PACKAGE', entityId: wp.id };
    await http().post(`/projects/${pid}/comments`).set(bearer(t.pm.token)).send({ ...base, body: 'x', mentions: [t.outsider.id] }).expect(400);
    await http().post(`/projects/${pid}/comments`).set(bearer(t.pm.token)).send({ entityType: 'RISK', entityId: wp.id, body: 'x' }).expect(404);
    EmailService.outbox.length = 0;
    const c1 = (await http().post(`/projects/${pid}/comments`).set(bearer(t.pm.token)).send({ ...base, body: '@赵质量 夹具图纸请先确认', mentions: [t.pqm.id] }).expect(201)).body;
    const kinds = async (token: string) => (await http().get('/notifications').set(bearer(token)).expect(200)).body.map((n: { kind: string }) => n.kind);
    expect(await kinds(t.pqm.token)).toContain('MENTION');
    expect(await kinds(t.member.token)).toContain('COMMENT'); // 工作包负责人
    expect(EmailService.outbox.map((m) => m.to)).toContain(t.pqm.email);
    expect(EmailService.outbox.map((m) => m.to)).not.toContain(t.member.email); // 已关闭讨论类邮件

    await http().post(`/projects/${pid}/comments`).set(bearer(t.pqm.token)).send({ ...base, body: '已确认，周五前回复' }).expect(201);
    expect((await http().get('/notifications').set(bearer(t.pm.token)).expect(200)).body.some((n: { kind: string; title: string }) => n.kind === 'COMMENT' && n.title.includes(wp.code))).toBe(true);

    let list = (await http().get(`/projects/${pid}/comments`).set(bearer(t.member.token)).query({ type: 'WORK_PACKAGE', entityId: wp.id }).expect(200)).body;
    expect(list.map((c: { body: string }) => c.body)).toEqual(['@赵质量 夹具图纸请先确认', '已确认，周五前回复']);
    expect((await http().get(`/projects/${pid}/comment-counts`).set(bearer(t.pm.token)).query({ type: 'WORK_PACKAGE' }).expect(200)).body).toEqual({ [wp.id]: 2 });
    await http().delete(`/projects/${pid}/comments/${c1.id}`).set(bearer(t.member.token)).expect(403);
    await http().delete(`/projects/${pid}/comments/${c1.id}`).set(bearer(t.pm.token)).expect(200);
    list = (await http().get(`/projects/${pid}/comments`).set(bearer(t.member.token)).query({ type: 'WORK_PACKAGE', entityId: wp.id }).expect(200)).body;
    expect(list[0]).toMatchObject({ deleted: true, body: '' });

    // 风险上的讨论
    const risk = (await http().get(`/projects/${pid}/risks`).set(bearer(t.pm.token)).expect(200)).body[0];
    await http().post(`/projects/${pid}/comments`).set(bearer(t.member.token)).send({ entityType: 'RISK', entityId: risk.id, body: '@李经理 第二供应商报价已到', mentions: [t.pm.id] }).expect(201);
    const mentions = (await http().get('/me/mentions').set(bearer(t.pm.token)).expect(200)).body;
    expect(mentions[0]).toMatchObject({ project: 'DS-01', entityType: 'RISK' });
    expect(mentions[0].link).toContain('s=risks');

    // 工作台：我负责的工作包带计划完成日期
    const todos = (await http().get('/me/todos').set(bearer(t.member.token)).expect(200)).body;
    const w = todos.find((x: { kind: string }) => x.kind === 'WORK_PACKAGE');
    expect(w.dueDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(w.link).toContain('s=wbs');
  });
});
