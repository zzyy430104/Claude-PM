import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { EmailService } from '../src/notifications/email.service.js';
import { bearer, createApp, setupTenant } from './helpers.js';

type T = Awaited<ReturnType<typeof setupTenant>>;
const req = {
  deliveryDate: '2027-09-30', milestones: [], deliverables: [{ name: '牵引拉杆总成', quantity: '1200 件', kind: 'PRODUCT' }], stockLines: [],
  quality: { standards: ['ISO/TS 22163'], special: '', acceptance: '出厂检验', fai: true, faiReason: '', customerWitness: false, drawingApproval: false, rams: false },
  cost: { cap: 3_000_000, target: 2_850_000 }, longLead: false, risks: [],
};
const day = (offset: number, h: number) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + offset); d.setUTCHours(h, 30, 0, 0); return d.toISOString(); };

describe('会议与公告', () => {
  let app: INestApplication;
  const http = () => request(app.getHttpServer());
  beforeAll(async () => { app = await createApp(); });
  afterAll(() => app.close());
  const kinds = async (token: string) => (await http().get('/notifications').set(bearer(token)).expect(200)).body.map((n: { kind: string }) => n.kind);

  async function project(t: T, code: string) {
    const i = (await http().post('/initiations').set(bearer(t.pm.token)).send({ name: '地铁转向架牵引拉杆', type: 'B', projectCode: code, customer: '华南城轨', proposedPmId: t.pm.id, startDate: '2026-11-02', requirements: req }).expect(201)).body;
    await http().post(`/initiations/${i.id}/submit`).set(bearer(t.pm.token)).expect(200);
    const pid = (await http().post(`/initiations/${i.id}/approve`).set(bearer(t.top.token)).send({}).expect(200)).body.projectId as string;
    await http().post(`/projects/${pid}/members`).set(bearer(t.pm.token)).send({ userId: t.member.id, projectRole: 'MEMBER' }).expect(201);
    await http().post(`/projects/${pid}/members`).set(bearer(t.pm.token)).send({ userId: t.pqm.id, projectRole: 'PROJECT_QUALITY_MANAGER' }).expect(201);
    return pid;
  }

  it('例会：通知带日历邀请，参会确认（外部人员由组织者登记），纪要发布后行动项进入问题与行动，下一次自动带出未关闭的行动项', async () => {
    const t = await setupTenant(app, 'mt1');
    const pid = await project(t, 'MT-01');
    await http().post(`/projects/${pid}/meetings`).set(bearer(t.outsider.token)).send({ title: 'x', startAt: day(-1, 1), endAt: day(-1, 2) }).expect(404);
    await http().post(`/projects/${pid}/meetings`).set(bearer(t.member.token)).send({ title: 'x', startAt: day(-1, 2), endAt: day(-1, 1) }).expect(400);

    // 任何项目成员可以发起；组织者默认参加
    const m = (await http().post(`/projects/${pid}/meetings`).set(bearer(t.member.token)).send({
      type: 'REGULAR', title: '项目周例会', startAt: day(-1, 1), endAt: day(-1, 2), location: '3 号会议室', agenda: ['上周行动项跟踪', '技术准备进展'],
      attendees: [{ userId: t.pm.id }, { userId: t.pqm.id }, { name: '陈工', org: '华南城轨（客户）', email: 'chen@customer.test' }],
    }).expect(201)).body;
    expect(m).toMatchObject({ seq: 1, recurrence: 'WEEKLY', status: 'DRAFT' });
    let d = (await http().get(`/projects/${pid}/meetings/${m.id}`).set(bearer(t.member.token)).expect(200)).body;
    expect(d.stats).toMatchObject({ total: 4, accepted: 1, pending: 3 });
    expect(d.seriesId).toBe(m.id);

    EmailService.outbox.length = 0;
    // 不是组织者、也没有“会议、公告”编辑权限的人不能发通知（项目质量经理按默认权限表可以）
    await http().post(`/projects/${pid}/meetings/${m.id}/notify`).set(bearer(t.top.token)).expect(403);
    await http().post(`/projects/${pid}/meetings/${m.id}/notify`).set(bearer(t.member.token)).expect(200);
    expect(await kinds(t.pqm.token)).toContain('MEETING_INVITE');
    const mails = EmailService.outbox.filter((x) => x.subject.includes('项目周例会'));
    expect(mails.map((x) => x.to).sort()).toEqual(['chen@customer.test', t.pm.email, t.pqm.email].sort());
    expect(mails[0].icalEvent?.content).toContain('BEGIN:VEVENT');
    expect(mails[0].icalEvent?.content).toContain(`UID:${m.id}@claude-pm`);
    const ics = await http().get(`/projects/${pid}/meetings/${m.id}/ics`).set(bearer(t.pm.token)).expect(200);
    expect(ics.headers['content-type']).toContain('text/calendar');

    // 参会确认
    await http().post(`/projects/${pid}/meetings/${m.id}/rsvp`).set(bearer(t.pm.token)).send({ response: 'ACCEPTED' }).expect(200);
    await http().post(`/projects/${pid}/meetings/${m.id}/rsvp`).set(bearer(t.pqm.token)).send({ response: 'DECLINED', note: '出差' }).expect(200);
    expect(await kinds(t.member.token)).toContain('MEETING_DECLINED');
    await http().post(`/projects/${pid}/meetings/${m.id}/rsvp`).set(bearer(t.top.token)).send({ response: 'ACCEPTED' }).expect(403);
    d = (await http().get(`/projects/${pid}/meetings/${m.id}`).set(bearer(t.member.token)).expect(200)).body;
    const ext = d.attendees.find((a: { external: boolean }) => a.external);
    await http().post(`/projects/${pid}/meetings/${m.id}/attendees/${ext.id}/rsvp`).set(bearer(t.top.token)).send({ response: 'ACCEPTED', method: 'PHONE' }).expect(403);
    await http().post(`/projects/${pid}/meetings/${m.id}/attendees/${ext.id}/rsvp`).set(bearer(t.member.token)).send({ response: 'ACCEPTED', method: 'PHONE' }).expect(200);
    d = (await http().get(`/projects/${pid}/meetings/${m.id}`).set(bearer(t.member.token)).expect(200)).body;
    expect(d.stats).toMatchObject({ accepted: 3, declined: 1, pending: 0 });
    expect(d.attendees.find((a: { external: boolean }) => a.external)).toMatchObject({ response: 'ACCEPTED', confirmMethod: 'PHONE' });

    // 纪要：行动项责任人必须是项目成员；发布后进入问题与行动
    expect((await http().post(`/projects/${pid}/meetings/${m.id}/publish`).set(bearer(t.member.token)).expect(400)).body.code).toBe('MINUTES_EMPTY');
    await http().put(`/projects/${pid}/meetings/${m.id}/minutes`).set(bearer(t.member.token)).send({ points: 'p', decisions: 'd', actions: [{ title: 'x', ownerId: t.outsider.id }] }).expect(400);
    await http().put(`/projects/${pid}/meetings/${m.id}/minutes`).set(bearer(t.member.token)).send({
      points: 'PFMEA 初稿完成 80%', decisions: '铸件开发第二供应商',
      actions: [{ title: '提交 PFMEA 初稿供质量评审', ownerId: t.member.id, dueDate: day(-1, 0).slice(0, 10) }, { title: '确认第二供应商样件交期', ownerId: t.pm.id }, { title: '' }],
    }).expect(200);
    await http().post(`/projects/${pid}/meetings/${m.id}/publish`).set(bearer(t.member.token)).expect(200);
    expect(await kinds(t.pm.token)).toEqual(expect.arrayContaining(['MEETING_MINUTES', 'ACTION_ASSIGNED']));
    const issues = (await http().get(`/projects/${pid}/issues`).set(bearer(t.pm.token)).expect(200)).body.filter((i: { source: string }) => i.source === 'MEETING');
    expect(issues).toHaveLength(2);
    await http().patch(`/projects/${pid}/meetings/${m.id}`).set(bearer(t.member.token)).send({ title: '改' }).expect(409);

    // 下一次：时间 +7 天，参会人带入（确认重置），上次未关闭的行动项自动带出
    await http().patch(`/projects/${pid}/issues/${issues.find((i: { title: string }) => i.title.startsWith('确认')).id}`).set(bearer(t.pm.token)).send({ status: 'CLOSED', closureNote: '已确认' }).expect(200);
    const n = (await http().post(`/projects/${pid}/meetings/${m.id}/next`).set(bearer(t.member.token)).expect(201)).body;
    expect(n).toMatchObject({ title: '项目周例会 #2', seq: 2, seriesId: m.id });
    expect(Date.parse(n.startAt) - Date.parse(m.startAt)).toBe(7 * 86_400_000);
    const nd = (await http().get(`/projects/${pid}/meetings/${n.id}`).set(bearer(t.pm.token)).expect(200)).body;
    expect(nd.stats).toMatchObject({ total: 4, pending: 3 });
    expect(nd.carryOver.map((a: { title: string }) => a.title)).toEqual(['提交 PFMEA 初稿供质量评审']);
    expect(nd.carryOver[0].overdueDays).toBeGreaterThan(0);

    // 未来的会议还不能发布纪要；取消已通知的会议会发取消邀请
    const f = (await http().post(`/projects/${pid}/meetings`).set(bearer(t.pm.token)).send({ title: '技术准备评审会', type: 'PHASE_REVIEW', startAt: day(3, 6), endAt: day(3, 8), attendees: [{ userId: t.member.id }] }).expect(201)).body;
    await http().put(`/projects/${pid}/meetings/${f.id}/minutes`).set(bearer(t.pm.token)).send({ points: 'x', decisions: '', actions: [] }).expect(200);
    expect((await http().post(`/projects/${pid}/meetings/${f.id}/publish`).set(bearer(t.pm.token)).expect(409)).body.code).toBe('MEETING_NOT_HELD');
    await http().post(`/projects/${pid}/meetings/${f.id}/notify`).set(bearer(t.pm.token)).expect(200);
    const mine = (await http().get('/meetings/mine').set(bearer(t.member.token)).expect(200)).body;
    expect(mine.map((x: { title: string }) => x.title)).toContain('技术准备评审会');
    EmailService.outbox.length = 0;
    await http().post(`/projects/${pid}/meetings/${f.id}/cancel`).set(bearer(t.pm.token)).expect(200);
    expect(EmailService.outbox[0].icalEvent).toMatchObject({ method: 'CANCEL' });
    expect(await kinds(t.member.token)).toContain('MEETING_CANCELLED');
  });

  it('公告：只有项目经理和管理层可发布；发给指定人员时其他人看不到；已读确认与提醒未读', async () => {
    const t = await setupTenant(app, 'mt2');
    const pid = await project(t, 'MT-02');
    await http().post(`/projects/${pid}/announcements`).set(bearer(t.member.token)).send({ title: 'x', body: 'y' }).expect(403);
    const a = (await http().post(`/projects/${pid}/announcements`).set(bearer(t.pm.token)).send({ title: '项目要求 v2：首批交期提前到 11-30', body: '客户补充协议已签署。', requireRead: true }).expect(201)).body;
    await http().post(`/projects/${pid}/announcements`).set(bearer(t.top.token)).send({ title: '质量专项', body: '只发质量', recipients: [t.pqm.id] }).expect(201);
    await http().post(`/projects/${pid}/announcements`).set(bearer(t.pm.token)).send({ title: 'x', body: 'y', recipients: [t.outsider.id] }).expect(400);
    expect(await kinds(t.member.token)).toContain('ANNOUNCEMENT');

    let m = (await http().get(`/projects/${pid}/announcements`).set(bearer(t.member.token)).expect(200)).body;
    expect(m.canPublish).toBe(false);
    expect(m.items.map((x: { title: string }) => x.title)).toEqual(['项目要求 v2：首批交期提前到 11-30']);
    expect(m.items[0]).toMatchObject({ readByMe: false });
    expect(m.items[0].unread).toBeUndefined();
    expect((await http().get('/announcements/unread').set(bearer(t.member.token)).expect(200)).body).toHaveLength(1);

    let pm = (await http().get(`/projects/${pid}/announcements`).set(bearer(t.pm.token)).expect(200)).body;
    const item = pm.items.find((x: { id: string }) => x.id === a.id);
    expect(item).toMatchObject({ readCount: 1, total: 3 });
    expect(item.unread).toHaveLength(2);

    await http().post(`/projects/${pid}/announcements/${a.id}/read`).set(bearer(t.member.token)).expect(200);
    await http().post(`/projects/${pid}/announcements/${a.id}/read`).set(bearer(t.member.token)).expect(200);
    m = (await http().get(`/projects/${pid}/announcements`).set(bearer(t.member.token)).expect(200)).body;
    expect(m.items[0].readByMe).toBe(true);
    expect((await http().get('/announcements/unread').set(bearer(t.member.token)).expect(200)).body).toHaveLength(0);

    await http().post(`/projects/${pid}/announcements/${a.id}/remind`).set(bearer(t.member.token)).expect(403);
    expect((await http().post(`/projects/${pid}/announcements/${a.id}/remind`).set(bearer(t.pm.token)).expect(200)).body).toEqual({ reminded: 1 });
    pm = (await http().get(`/projects/${pid}/announcements`).set(bearer(t.pm.token)).expect(200)).body;
    expect(pm.items.find((x: { id: string }) => x.id === a.id)).toMatchObject({ readCount: 2, unread: [expect.any(String)] });
  });
});
