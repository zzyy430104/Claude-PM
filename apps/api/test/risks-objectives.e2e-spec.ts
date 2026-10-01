import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { bearer, createApp, setupTenant } from './helpers.js';

type T = Awaited<ReturnType<typeof setupTenant>>;
const quality = { standards: ['ISO/TS 22163'], special: '', acceptance: '出厂检验', fai: true, faiReason: '', customerWitness: true, drawingApproval: false, rams: false };
const req = {
  deliveryDate: '2027-09-30', milestones: [], deliverables: [{ name: '牵引拉杆总成', quantity: '1200 件', kind: 'PRODUCT' }],
  stockLines: [], quality, cost: { cap: 3_000_000, target: 2_850_000 }, longLead: false, risks: [{ text: '铸件供应商产能', kind: 'RISK' }],
};
const base = { kind: 'RISK', title: '铸件供应商产能不足', probability: 3, impact: 3, cause: '主供应商同时承接其他订单', effect: '首件物料晚到' };

describe('项目目标与风险、机会', () => {
  let app: INestApplication;
  const http = () => request(app.getHttpServer());
  beforeAll(async () => { app = await createApp(); });
  afterAll(() => app.close());
  const kinds = async (token: string) => (await http().get('/notifications').set(bearer(token)).expect(200)).body.map((n: { kind: string }) => n.kind);

  async function project(t: T, code: string) {
    await http().put('/risk-settings').set(bearer(t.admin.token)).send({ scale: 3 }).expect(200); // 新企业默认 3 档
    const i = (await http().post('/initiations').set(bearer(t.pm.token)).send({ name: '地铁转向架牵引拉杆', type: 'B', projectCode: code, customer: '华南城轨', proposedPmId: t.pm.id, startDate: '2026-11-02', requirements: req }).expect(201)).body;
    await http().post(`/initiations/${i.id}/submit`).set(bearer(t.pm.token)).expect(200);
    const pid = (await http().post(`/initiations/${i.id}/approve`).set(bearer(t.top.token)).send({}).expect(200)).body.projectId as string;
    await http().post(`/projects/${pid}/members`).set(bearer(t.pm.token)).send({ userId: t.member.id, projectRole: 'MEMBER' }).expect(201);
    return pid;
  }

  it('目标由项目要求生成；高风险让相关目标显示“关注”；高风险通知管理层；没有措施时预警并挡住计划批准', async () => {
    const t = await setupTenant(app, 'ro1');
    const pid = await project(t, 'RO-01');
    let objs = (await http().get(`/projects/${pid}/objectives`).set(bearer(t.member.token)).expect(200)).body;
    expect(objs.map((o: { metric: string }) => o.metric)).toEqual(['DELIVERY', 'COST', 'FAI']);
    const delivery = objs[0];
    expect(delivery).toMatchObject({ dimension: '交期', target: '不晚于 2027-09-30', auto: true });
    await http().patch(`/projects/${pid}/objectives/${delivery.id}`).set(bearer(t.pm.token)).send({ target: '改' }).expect(409);
    const custom = (await http().post(`/projects/${pid}/objectives`).set(bearer(t.pm.token)).send({ dimension: '客户', name: '客户满意度', target: '≥ 90 分' }).expect(201)).body;
    await http().patch(`/projects/${pid}/objectives/${custom.id}`).set(bearer(t.pm.token)).send({ current: '交付后评价', manualState: 'GREEN' }).expect(200);

    // 立项带入的初步风险为“中”
    const initial = (await http().get(`/projects/${pid}/risks`).set(bearer(t.pm.token)).expect(200)).body;
    expect(initial[0]).toMatchObject({ title: '铸件供应商产能', importance: 'MEDIUM', level: 'PROJECT' });

    await http().post(`/projects/${pid}/risks`).set(bearer(t.pm.token)).send({ ...base, probability: 4 }).expect(400); // 3 档
    const r = (await http().post(`/projects/${pid}/risks`).set(bearer(t.member.token)).send({ ...base, objectiveId: delivery.id, trigger: '供应商周产能低于 200 件' }).expect(201)).body;
    expect(r).toMatchObject({ level: 'PROJECT', ownerId: t.member.id, reviewCycleDays: 14 });
    expect(await kinds(t.top.token)).toContain('RISK_HIGH');
    objs = (await http().get(`/projects/${pid}/objectives`).set(bearer(t.pm.token)).expect(200)).body;
    expect(objs.find((o: { id: string }) => o.id === delivery.id)).toMatchObject({ highRisk: true });
    expect(objs.find((o: { id: string }) => o.id === delivery.id).state).not.toBe('GREEN');

    let w = (await http().get(`/projects/${pid}/risk-warnings`).set(bearer(t.pm.token)).expect(200)).body;
    expect(w).toEqual(expect.arrayContaining([expect.objectContaining({ riskId: r.id, kind: 'NO_MEASURE' })]));
    const st = (await http().get(`/projects/${pid}/plan-approval`).set(bearer(t.pm.token)).expect(200)).body;
    expect(st.checks.find((c: { key: string }) => c.key === 'riskHigh')).toMatchObject({ ok: false });

    // 应对：策略要有成本收益分析；措施即行动项
    await http().patch(`/projects/${pid}/risks/${r.id}`).set(bearer(t.member.token)).send({ strategy: '躲开' }).expect(400);
    expect((await http().patch(`/projects/${pid}/risks/${r.id}`).set(bearer(t.member.token)).send({ strategy: '减弱' }).expect(400)).body.code).toBe('CBA_REQUIRED');
    await http().patch(`/projects/${pid}/risks/${r.id}`).set(bearer(t.member.token)).send({ strategy: '减弱', costBenefitAnalysis: '第二供应商单价高 3%，可避免 10 天延误' }).expect(200);
    const act = (await http().post(`/projects/${pid}/risks/${r.id}/actions`).set(bearer(t.member.token)).send({ title: '启用第二供应商', ownerId: t.member.id, dueDate: '2020-01-01' }).expect(201)).body;
    w = (await http().get(`/projects/${pid}/risk-warnings`).set(bearer(t.pm.token)).expect(200)).body;
    expect(w.map((x: { kind: string }) => x.kind)).toEqual(expect.arrayContaining(['MEASURE_OVERDUE']));
    expect(w.map((x: { kind: string }) => x.kind)).not.toContain('NO_MEASURE');

    // 预警条件触发 → 通知；复查
    await http().post(`/projects/${pid}/risks/${r.id}/trigger`).set(bearer(t.member.token)).expect(200);
    expect(await kinds(t.pm.token)).toContain('RISK_TRIGGERED');
    await http().post(`/projects/${pid}/risks/${r.id}/review`).set(bearer(t.member.token)).send({ probability: 2, impact: 3, note: '第二供应商已确认', clearTrigger: true }).expect(200);
    expect((await http().get(`/projects/${pid}/risks/${r.id}/reviews`).set(bearer(t.pm.token)).expect(200)).body[0]).toMatchObject({ probability: 2, note: '第二供应商已确认' });

    // 关闭：措施完成 → 待复评；项目级由项目经理关闭，责任人自己不能关
    await http().patch(`/projects/${pid}/issues/${act.id}`).set(bearer(t.member.token)).send({ status: 'CLOSED', closureNote: '已下单' }).expect(200);
    expect((await http().get(`/projects/${pid}/risks`).set(bearer(t.pm.token)).expect(200)).body.find((x: { id: string }) => x.id === r.id).status).toBe('REVIEW');
    await http().post(`/projects/${pid}/risks/${r.id}/close`).set(bearer(t.member.token)).send({ residualProbability: 1, residualImpact: 2, note: '风险解除' }).expect(403);
    const closed = (await http().post(`/projects/${pid}/risks/${r.id}/close`).set(bearer(t.pm.token)).send({ residualProbability: 1, residualImpact: 2, note: '风险解除' }).expect(200)).body;
    expect(closed).toMatchObject({ status: 'CLOSED', residualProbability: 1 });
  });

  it('接受高风险要写理由和应急预案并由管理层确认；风险发生转为问题；工作包级升级为项目级、企业级；企业风险所有人可见', async () => {
    const t = await setupTenant(app, 'ro2');
    const pid = await project(t, 'RO-02');
    const r = (await http().post(`/projects/${pid}/risks`).set(bearer(t.pm.token)).send({ ...base, title: '客户见证排期冲突' }).expect(201)).body;
    expect((await http().patch(`/projects/${pid}/risks/${r.id}`).set(bearer(t.pm.token)).send({ strategy: '接受', costBenefitAnalysis: '调整成本高于延误损失', acceptReason: '客户代表时间不可控' }).expect(400)).body.code).toBe('CONTINGENCY_REQUIRED');
    await http().patch(`/projects/${pid}/risks/${r.id}`).set(bearer(t.pm.token)).send({ strategy: '接受', costBenefitAnalysis: '调整成本高于延误损失', acceptReason: '客户代表时间不可控', contingencyPlan: '改为视频见证' }).expect(200);
    expect((await http().post(`/projects/${pid}/risks/${r.id}/close`).set(bearer(t.pm.token)).send({ residualProbability: 3, residualImpact: 3, note: '接受' }).expect(409)).body.code).toBe('ACCEPT_NOT_APPROVED');
    await http().post(`/projects/${pid}/risks/${r.id}/accept-approve`).set(bearer(t.pm.token)).expect(403);
    await http().post(`/projects/${pid}/risks/${r.id}/accept-approve`).set(bearer(t.top.token)).expect(200);
    await http().post(`/projects/${pid}/risks/${r.id}/close`).set(bearer(t.pm.token)).send({ residualProbability: 3, residualImpact: 3, note: '接受，按预案执行' }).expect(200);

    // 风险发生 → 问题
    const r2 = (await http().post(`/projects/${pid}/risks`).set(bearer(t.pm.token)).send({ ...base, title: '涂料到货延误', probability: 2, impact: 2 }).expect(201)).body;
    const issue = (await http().post(`/projects/${pid}/risks/${r2.id}/occurred`).set(bearer(t.pm.token)).send({ note: '到货晚 5 天' }).expect(201)).body;
    expect(issue).toMatchObject({ kind: 'ISSUE', riskId: r2.id });
    expect((await http().get(`/projects/${pid}/risks`).set(bearer(t.pm.token)).expect(200)).body.find((x: { id: string }) => x.id === r2.id).status).toBe('OCCURRED');

    // 工作包级 → 项目级 → 企业级
    const wbs = (await http().get(`/projects/${pid}/wbs`).set(bearer(t.pm.token)).expect(200)).body;
    const wp = wbs.items.find((w: { code: string }) => w.code === '2.5');
    const r3 = (await http().post(`/projects/${pid}/risks`).set(bearer(t.member.token)).send({ ...base, title: '持证焊工不足', workPackageId: wp.id, probability: 2 }).expect(201)).body;
    expect(r3.level).toBe('WORK_PACKAGE');
    expect((await http().post(`/projects/${pid}/risks/${r3.id}/escalate`).set(bearer(t.member.token)).send({ note: '影响多个工作包' }).expect(200)).body).toMatchObject({ level: 'PROJECT', ownerId: t.pm.id });
    await http().post(`/projects/${pid}/risks/${r3.id}/escalate`).set(bearer(t.pm.token)).send({ ownerId: t.member.id }).expect(400);
    const e = (await http().post(`/projects/${pid}/risks/${r3.id}/escalate`).set(bearer(t.pm.token)).send({ note: '多个项目都受影响' }).expect(200)).body;
    expect(e).toMatchObject({ level: 'ENTERPRISE', ownerId: t.top.id, projectId: null });
    expect((await http().get(`/projects/${pid}/risks`).set(bearer(t.member.token)).expect(200)).body.map((x: { id: string }) => x.id)).toContain(r3.id); // 仍挂在原项目上

    // 企业风险：所有人可见；措施完成 → 待复评；由管理层关闭
    const list = (await http().get('/enterprise-risks').set(bearer(t.outsider.token)).expect(200)).body;
    expect(list.risks.map((x: { id: string }) => x.id)).toContain(r3.id);
    expect(list.risks.find((x: { id: string }) => x.id === r3.id).projects[0].id).toBe(pid);
    await http().post('/enterprise-risks').set(bearer(t.pm.token)).send(base).expect(403);
    const m = (await http().post(`/enterprise-risks/${r3.id}/measures`).set(bearer(t.top.token)).send({ title: '安排 3 人外部培训取证', ownerId: t.member.id, cost: 36000 }).expect(201)).body;
    await http().post(`/enterprise-risks/${r3.id}/measures/${m.id}/done`).set(bearer(t.outsider.token)).expect(403);
    await http().post(`/enterprise-risks/${r3.id}/measures/${m.id}/done`).set(bearer(t.member.token)).expect(200);
    expect((await http().get('/enterprise-risks').set(bearer(t.top.token)).expect(200)).body.risks.find((x: { id: string }) => x.id === r3.id).status).toBe('REVIEW');
    await http().post(`/enterprise-risks/${r3.id}/close`).set(bearer(t.pm.token)).send({ residualProbability: 1, residualImpact: 1, note: '已取证' }).expect(403);
    await http().post(`/enterprise-risks/${r3.id}/close`).set(bearer(t.top.token)).send({ residualProbability: 1, residualImpact: 1, note: '已取证' }).expect(200);
    const created = (await http().post('/enterprise-risks').set(bearer(t.top.token)).send({ ...base, kind: 'OPPORTUNITY', title: '城轨新线集中招标', projectIds: [pid] }).expect(201)).body;
    expect(created).toMatchObject({ level: 'ENTERPRISE' });
  });

  it('风险管理设置：矩阵、判断标准、策略、规则由企业管理员自定义', async () => {
    const t = await setupTenant(app, 'ro3');
    await http().put('/risk-settings').set(bearer(t.pm.token)).send({ scale: 3 }).expect(403);
    const s = (await http().put('/risk-settings').set(bearer(t.admin.token)).send({
      scale: 3, matrix: [[0, 0, 0], [0, 1, 1], [1, 1, 2]], strategies: { RISK: ['规避', '转移', '减轻', '接受'] },
      rules: { 'PROJECT:HIGH': { close: 'MANAGEMENT', reviewDays: 7 } },
    }).expect(200)).body;
    expect(s.rules['PROJECT:HIGH']).toMatchObject({ close: 'MANAGEMENT', reviewDays: 7, approve: 'PM' });
    await http().put('/risk-settings').set(bearer(t.admin.token)).send({ matrix: [[0, 0], [0, 1]] }).expect(400);
    await http().put('/risk-settings').set(bearer(t.admin.token)).send({ rules: { 'PROJECT:HIGH': { close: 'NOBODY' } } }).expect(400);
    expect((await http().get('/risk-settings').set(bearer(t.member.token)).expect(200)).body.strategies.RISK).toContain('规避');
  });
});
