import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { bearer, createApp, setupTenant } from './helpers.js';

type T = Awaited<ReturnType<typeof setupTenant>>;
const quality = { standards: ['ISO/TS 22163'], special: '', acceptance: '出厂检验', fai: true, faiReason: '', customerWitness: false, drawingApproval: false, rams: false };
const req = {
  deliveryDate: '2027-09-30', milestones: [], deliverables: [{ name: '牵引拉杆总成', quantity: '1200 件', kind: 'PRODUCT' }],
  stockLines: [], quality, cost: { cap: 3_000_000, target: 2_850_000 }, longLead: false, risks: [],
};
const full = { 工作质量: 5, 按时完成: 4, 协作配合: 4, 主动性: 5 };

describe('项目绩效评价', () => {
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
    return pid;
  }

  it('项目经理绩效按时间、质量、成本自动计分；权重可按项目调整（须写理由）；管理层评语、调整分数（须写理由）并确认后锁定', async () => {
    const t = await setupTenant(app, 'ev1');
    const pid = await project(t, 'EV-01');
    let ev = (await http().get(`/projects/${pid}/evaluation`).set(bearer(t.pm.token)).expect(200)).body;
    expect(ev.pm.aspects.map((a: { key: string; weight: number }) => [a.key, a.weight])).toEqual([['TIME', 40], ['QUALITY', 30], ['COST', 30]]);
    expect(ev.pm.aspects[0]).toMatchObject({ estimate: true, target: '要求 2027-09-30' });
    expect(ev.can).toMatchObject({ evaluate: true, manage: false });

    // 实际交付晚 3 个工作日（2027-09-30 周四 → 10-05 周二）：100 − 3 × 5
    await http().put(`/projects/${pid}/evaluation/pm`).set(bearer(t.pm.token)).send({ actualDelivery: '2027-10-05' }).expect(200);
    ev = (await http().get(`/projects/${pid}/evaluation`).set(bearer(t.pm.token)).expect(200)).body;
    expect(ev.pm.aspects[0]).toMatchObject({ score: 85, actual: '实际 2027-10-05，晚 3 个工作日' });
    expect(ev.pm.aspects[1].score).toBe(100);
    expect(ev.pm.aspects[2].score).toBe(100);
    expect(ev.pm).toMatchObject({ total: 94, score: 94, grade: '优秀', complete: true });

    // 普通成员看不到项目经理绩效
    await http().get(`/projects/${pid}/evaluation`).set(bearer(t.member.token)).expect(403);
    await http().put(`/projects/${pid}/evaluation/pm`).set(bearer(t.pm.token)).send({ comment: '自评' }).expect(403);

    // 权重：须写理由、合计 100；可加自定义方面（管理层评分）
    await http().put(`/projects/${pid}/evaluation/aspects`).set(bearer(t.pm.token)).send({ aspects: [{ key: 'TIME', name: '时间', weight: 50 }, { key: 'COST', name: '成本', weight: 30 }], reason: 'x' }).expect(400);
    const aspects = [{ key: 'TIME', name: '时间', weight: 40 }, { key: 'QUALITY', name: '质量', weight: 30 }, { key: 'COST', name: '成本', weight: 20 }, { key: 'CUSTOMER', name: '客户满意', weight: 10 }];
    await http().put(`/projects/${pid}/evaluation/aspects`).set(bearer(t.pm.token)).send({ aspects, reason: '' }).expect(400);
    await http().put(`/projects/${pid}/evaluation/aspects`).set(bearer(t.pm.token)).send({ aspects, reason: '客户满意度是本项目的重点' }).expect(200);
    ev = (await http().get(`/projects/${pid}/evaluation`).set(bearer(t.top.token)).expect(200)).body;
    expect(ev.pm).toMatchObject({ complete: false, customAspects: true, aspectsReason: '客户满意度是本项目的重点' });
    expect((await http().post(`/projects/${pid}/evaluation/pm/confirm`).set(bearer(t.top.token)).expect(409)).body.code).toBe('EVALUATION_INCOMPLETE');

    await http().put(`/projects/${pid}/evaluation/pm`).set(bearer(t.top.token)).send({ manualScores: { CUSTOMER: 70 } }).expect(200);
    ev = (await http().get(`/projects/${pid}/evaluation`).set(bearer(t.top.token)).expect(200)).body;
    expect(ev.pm).toMatchObject({ total: 91, complete: true }); // (85×40 + 100×30 + 100×20 + 70×10) / 100 = 91
    expect((await http().put(`/projects/${pid}/evaluation/pm`).set(bearer(t.top.token)).send({ adjustedScore: 95 }).expect(400)).body.code).toBe('REASON_REQUIRED');
    await http().put(`/projects/${pid}/evaluation/pm`).set(bearer(t.top.token)).send({ adjustedScore: 95, adjustReason: '交期提前 10 天的要求变更下仍基本按期', comment: '应对得当' }).expect(200);
    await http().post(`/projects/${pid}/evaluation/pm/confirm`).set(bearer(t.member.token)).expect(403);
    await http().post(`/projects/${pid}/evaluation/pm/confirm`).set(bearer(t.top.token)).expect(200);
    expect(await kinds(t.pm.token)).toContain('EVALUATION_SUBMITTED');
    ev = (await http().get(`/projects/${pid}/evaluation`).set(bearer(t.pm.token)).expect(200)).body;
    expect(ev.pm).toMatchObject({ score: 95, grade: '优秀', comment: '应对得当' });
    expect(ev.pm.confirmedAt).toBeTruthy();
    expect((await http().put(`/projects/${pid}/evaluation/pm`).set(bearer(t.pm.token)).send({ actualDelivery: '2027-09-30' }).expect(409)).body.code).toBe('EVALUATION_CONFIRMED');
    const pmSheets = (await http().get('/evaluations').set(bearer(t.pm.token)).expect(200)).body;
    expect(pmSheets.pms).toHaveLength(1);
  });

  it('成员评价只针对本项目：打分、提交后锁定并发给人事和部门负责人；本人提交后可见；撤回修改须重新提交；可见范围可设置；导出留审计', async () => {
    const t = await setupTenant(app, 'ev2');
    const pid = await project(t, 'EV-02');

    // 部门、负责人、人事
    const dept = (await http().post('/departments').set(bearer(t.admin.token)).send({ name: '工艺部', headId: t.pqm.id }).expect(201)).body;
    await http().post('/departments').set(bearer(t.admin.token)).send({ name: '工艺部' }).expect(409);
    await http().post('/departments').set(bearer(t.pm.token)).send({ name: '质量部' }).expect(403);
    await http().patch(`/users/${t.member.id}`).set(bearer(t.admin.token)).send({ departmentId: dept.id }).expect(200);
    await http().put('/approval-roles/HR').set(bearer(t.admin.token)).send({ entries: [{ userId: t.outsider.id, basis: '人事部' }] }).expect(200);
    expect((await http().get('/evaluations/access').set(bearer(t.outsider.token)).expect(200)).body).toMatchObject({ hr: true });
    expect((await http().get('/evaluations/access').set(bearer(t.pqm.token)).expect(200)).body).toMatchObject({ deptHead: true });

    let ev = (await http().get(`/projects/${pid}/evaluation`).set(bearer(t.pm.token)).expect(200)).body;
    const row = ev.members.find((m: { userId: string }) => m.userId === t.member.id);
    expect(row).toMatchObject({ status: 'DRAFT', editable: true });
    expect(row.reference.text).toContain('工作包');
    expect(ev.members.some((m: { userId: string }) => m.userId === t.pm.id)).toBe(false);

    await http().put(`/projects/${pid}/evaluation/members/${t.member.id}`).set(bearer(t.member.token)).send({ scores: full }).expect(403);
    await http().put(`/projects/${pid}/evaluation/members/${t.member.id}`).set(bearer(t.pm.token)).send({ scores: { 工作质量: 6 } }).expect(400);
    await http().put(`/projects/${pid}/evaluation/members/${t.member.id}`).set(bearer(t.pm.token)).send({ scores: { 加班: 5 } }).expect(400);
    await http().put(`/projects/${pid}/evaluation/members/${t.member.id}`).set(bearer(t.pm.token)).send({ scores: { 工作质量: 5, 按时完成: 4 } }).expect(200);
    expect((await http().post(`/projects/${pid}/evaluation/members/${t.member.id}/submit`).set(bearer(t.pm.token)).expect(400)).body.code).toBe('SCORES_INCOMPLETE');
    const saved = (await http().put(`/projects/${pid}/evaluation/members/${t.member.id}`).set(bearer(t.pm.token)).send({ scores: full, comment: '工艺文件质量高' }).expect(200)).body;
    expect(saved).toMatchObject({ score: 90, grade: '优秀' });

    // 提交前本人看不到
    await http().get(`/projects/${pid}/evaluation`).set(bearer(t.member.token)).expect(403);
    await http().post(`/projects/${pid}/evaluation/members/${t.member.id}/submit`).set(bearer(t.pm.token)).expect(200);
    for (const u of [t.outsider, t.pqm, t.member]) expect(await kinds(u.token)).toContain('EVALUATION_SUBMITTED');
    await http().put(`/projects/${pid}/evaluation/members/${t.member.id}`).set(bearer(t.pm.token)).send({ scores: full }).expect(409);

    ev = (await http().get(`/projects/${pid}/evaluation`).set(bearer(t.member.token)).expect(200)).body;
    expect(ev.pm).toBeNull();
    expect(ev.members).toHaveLength(1);
    expect(ev.members[0]).toMatchObject({ userId: t.member.id, grade: '优秀', editable: false });

    for (const u of [t.outsider, t.pqm, t.top, t.member]) {
      const s = (await http().get('/evaluations').set(bearer(u.token)).expect(200)).body;
      expect(s.members.map((m: { name: string; department: string }) => [m.name, m.department])).toEqual([[expect.any(String), '工艺部']]);
    }
    // 部门负责人看不到其他部门的人；项目经理绩效只给管理层、人事、本人、所在部门负责人
    expect((await http().get('/evaluations').set(bearer(t.pm.token)).expect(200)).body.members).toHaveLength(0);

    // 撤回修改：须写理由，回到草稿；重新提交后版本加一
    await http().post(`/projects/${pid}/evaluation/members/${t.member.id}/reopen`).set(bearer(t.pm.token)).send({ reason: '' }).expect(400);
    await http().post(`/projects/${pid}/evaluation/members/${t.member.id}/reopen`).set(bearer(t.pm.token)).send({ reason: '补充协作评价' }).expect(200);
    await http().put(`/projects/${pid}/evaluation/members/${t.member.id}`).set(bearer(t.pm.token)).send({ scores: { 协作配合: 5 } }).expect(200);
    const again = (await http().post(`/projects/${pid}/evaluation/members/${t.member.id}/submit`).set(bearer(t.pm.token)).expect(200)).body;
    expect(again).toMatchObject({ version: 2, score: 95, status: 'SUBMITTED' });

    // 导出（人事），留审计
    const x = await http().get('/evaluations/export').set(bearer(t.outsider.token)).expect(200);
    expect(x.headers['content-type']).toContain('spreadsheetml');
    const audit = (await http().get('/audit-logs').set(bearer(t.admin.token)).query({ entity: 'Tenant' }).expect(200)).body;
    expect(JSON.stringify(audit)).toContain('evaluation.export');

    // 可见范围：关闭“本人可见”后本人看不到
    await http().put('/perf-settings').set(bearer(t.admin.token)).send({ aspects: [{ key: 'TIME', name: '时间', weight: 50 }, { key: 'QUALITY', name: '质量', weight: 30 }] }).expect(400);
    await http().put('/perf-settings').set(bearer(t.admin.token)).send({ grades: { excellent: 60, good: 70, pass: 50 } }).expect(400);
    await http().put('/perf-settings').set(bearer(t.pm.token)).send({ visibility: { memberSelf: false } }).expect(403);
    await http().put('/perf-settings').set(bearer(t.admin.token)).send({ visibility: { memberSelf: false } }).expect(200);
    expect((await http().get('/evaluations').set(bearer(t.member.token)).expect(200)).body.members).toHaveLength(0);
    await http().get(`/projects/${pid}/evaluation`).set(bearer(t.member.token)).expect(403);
  });
});
