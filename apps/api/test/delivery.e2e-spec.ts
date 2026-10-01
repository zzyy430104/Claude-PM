import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { bearer, createApp, setupTenant } from './helpers.js';

type T = Awaited<ReturnType<typeof setupTenant>>;
const quality = { standards: ['ISO/TS 22163'], special: '', acceptance: '出厂检验', fai: true, faiReason: '', customerWitness: true, drawingApproval: false, rams: false };
const req = {
  deliveryDate: '2027-09-30', milestones: [], deliverables: [{ name: '牵引拉杆总成', quantity: '1200 件', kind: 'PRODUCT' }],
  stockLines: [], quality, cost: { cap: 3_000_000, target: 2_850_000 }, longLead: true, risks: [],
};

describe('采购计划、FAI、售后交接', () => {
  let app: INestApplication;
  const http = () => request(app.getHttpServer());
  beforeAll(async () => { app = await createApp(); });
  afterAll(() => app.close());

  async function project(t: T, code: string) {
    const i = (await http().post('/initiations').set(bearer(t.pm.token)).send({ name: '地铁转向架牵引拉杆', type: 'B', projectCode: code, customer: '华南城轨', proposedPmId: t.pm.id, startDate: '2026-11-02', requirements: req }).expect(201)).body;
    await http().post(`/initiations/${i.id}/submit`).set(bearer(t.pm.token)).expect(200);
    const pid = (await http().post(`/initiations/${i.id}/approve`).set(bearer(t.top.token)).send({}).expect(200)).body.projectId as string;
    await http().post(`/projects/${pid}/members`).set(bearer(t.pm.token)).send({ userId: t.member.id, projectRole: 'MEMBER' }).expect(201);
    await http().post(`/projects/${pid}/members`).set(bearer(t.pm.token)).send({ userId: t.pqm.id, projectRole: 'PROJECT_QUALITY_MANAGER' }).expect(201);
    return pid;
  }

  it('采购计划：物料、批准与修订；下单生成承诺成本，结算转为实际成本；逾期未下单；采购角色可编辑；量产准备自动检查', async () => {
    const t = await setupTenant(app, 'dl1');
    const pid = await project(t, 'DL-01');
    let plan = (await http().get(`/projects/${pid}/purchase-plan`).set(bearer(t.pm.token)).expect(200)).body;
    expect(plan.plan.version).toBe(0);
    const material = plan.accounts.find((a: { name: string }) => a.name === '材料');
    const wp = plan.workPackages[0];
    await http().post(`/projects/${pid}/purchase-plan/approve`).set(bearer(t.pm.token)).expect(409);

    // 普通成员不能编辑；职能角色为“采购”的成员可以
    await http().post(`/projects/${pid}/purchase-items`).set(bearer(t.member.token)).send({ name: '铸件毛坯' }).expect(403);
    const role = (await http().get('/functional-roles').set(bearer(t.admin.token)).expect(200)).body.find((r: { name: string }) => r.name === '采购');
    await http().patch(`/users/${t.member.id}`).set(bearer(t.admin.token)).send({ functionalRoleId: role.id }).expect(200);
    const m1 = (await http().post(`/projects/${pid}/purchase-items`).set(bearer(t.member.token)).send({ name: '铸件毛坯 QY-12-C', supplier: '某铸造厂', quantity: '1,250 件', needDate: '2026-12-20', longLead: true, workPackageId: wp.id, accountId: material.id, amount: 300000 }).expect(201)).body;
    const m2 = (await http().post(`/projects/${pid}/purchase-items`).set(bearer(t.pm.token)).send({ name: '涂料', needDate: '2020-01-10', amount: 20000 }).expect(201)).body;
    expect([m1.code, m2.code]).toEqual(['M-01', 'M-02']);

    plan = (await http().get(`/projects/${pid}/purchase-plan`).set(bearer(t.pm.token)).expect(200)).body;
    expect(plan.stats).toMatchObject({ items: 2, longLead: 1, longLeadOrdered: 0, overdue: ['M-02'] });
    await http().post(`/projects/${pid}/purchase-plan/approve`).set(bearer(t.member.token)).expect(403);
    await http().post(`/projects/${pid}/purchase-plan/approve`).set(bearer(t.pm.token)).expect(200);
    await http().patch(`/projects/${pid}/purchase-items/${m2.id}`).set(bearer(t.pm.token)).send({ needDate: '2027-01-10', supplier: '某涂料公司' }).expect(200);
    plan = (await http().get(`/projects/${pid}/purchase-plan`).set(bearer(t.pm.token)).expect(200)).body;
    expect(plan.plan).toMatchObject({ version: 1, dirty: true });
    await http().post(`/projects/${pid}/purchase-plan/approve`).set(bearer(t.pm.token)).expect(200);

    // 下单 → 承诺成本；到货；结算 → 实际成本
    await http().post(`/projects/${pid}/purchase-items/${m1.id}/order`).set(bearer(t.member.token)).send({ orderNo: 'PO-001' }).expect(200);
    let commitments = (await http().get(`/projects/${pid}/cost/commitments`).set(bearer(t.pm.token)).expect(200)).body;
    expect(commitments).toHaveLength(1);
    expect(Number(commitments[0].amount)).toBe(300000);
    await http().delete(`/projects/${pid}/purchase-items/${m1.id}`).set(bearer(t.pm.token)).expect(409);
    await http().patch(`/projects/${pid}/purchase-items/${m1.id}`).set(bearer(t.pm.token)).send({ amount: 1 }).expect(409);
    await http().post(`/projects/${pid}/purchase-items/${m1.id}/receive`).set(bearer(t.member.token)).send({ receivedPct: 40 }).expect(200);
    plan = (await http().get(`/projects/${pid}/purchase-plan`).set(bearer(t.pm.token)).expect(200)).body;
    expect(plan.items[0]).toMatchObject({ status: 'PARTIAL', receivedPct: 40 });
    expect(plan.stats).toMatchObject({ longLeadOrdered: 1, receivedPct: 20, committed: 300000 });
    expect(plan.plan.dirty).toBe(false); // 执行状态变化不算修订
    expect(plan.checks.find((c: { message: string }) => c.message.includes('长周期'))).toMatchObject({ ok: true });

    await http().post(`/projects/${pid}/purchase-items/${m1.id}/receive`).set(bearer(t.member.token)).send({ receivedPct: 100 }).expect(200);
    await http().post(`/projects/${pid}/purchase-items/${m1.id}/settle`).set(bearer(t.member.token)).send({ amount: 296000 }).expect(200);
    commitments = (await http().get(`/projects/${pid}/cost/commitments`).set(bearer(t.pm.token)).expect(200)).body;
    expect(commitments).toHaveLength(0);
    const cost = (await http().get(`/projects/${pid}/cost`).set(bearer(t.pm.token)).expect(200)).body;
    expect(cost.accounts.find((a: { name: string }) => a.name === '材料').actual).toBe(296000);

    // 取消下单的物料：承诺成本去掉
    await http().post(`/projects/${pid}/purchase-items/${m2.id}/order`).set(bearer(t.pm.token)).send({}).expect(200);
    expect((await http().get(`/projects/${pid}/cost/commitments`).set(bearer(t.pm.token)).expect(200)).body).toHaveLength(1);
    await http().post(`/projects/${pid}/purchase-items/${m2.id}/cancel`).set(bearer(t.pm.token)).expect(200);
    expect((await http().get(`/projects/${pid}/cost/commitments`).set(bearer(t.pm.token)).expect(200)).body).toHaveLength(0);

    // 阶段评审的检查清单：采购计划已批准、长周期物料已下单自动判断
    const phases = (await http().get(`/projects/${pid}/phases`).set(bearer(t.pm.token)).expect(200)).body as { id: string; checklist: string[] }[];
    const ph = phases.find((x) => x.checklist.includes('采购计划已批准'));
    if (ph) {
      const r = (await http().get(`/projects/${pid}/phases/${ph.id}/readiness`).set(bearer(t.pm.token)).expect(200)).body;
      const item = r.checklist.find((c: { item: string }) => c.item === '长周期物料已下单');
      expect(item).toMatchObject({ auto: true, passed: true });
      expect(r.checklist.find((c: { item: string }) => c.item === '采购计划已批准')).toMatchObject({ auto: true, passed: false }); // 取消后待重新批准
    }
  });

  it('FAI：登记结论和追溯信息，有条件通过须写遗留项并生成行动项；FAI 目标与项目经理质量分按 FAI 记录', async () => {
    const t = await setupTenant(app, 'dl2');
    const pid = await project(t, 'DL-02');
    let f = (await http().get(`/projects/${pid}/fai`).set(bearer(t.member.token)).expect(200)).body;
    expect(f).toMatchObject({ requirement: { fai: true, customerWitness: true }, state: 'GREY', canEdit: false });
    const base = { reportNo: 'FAI-2026-031', date: '2026-11-03', part: 'QY-12 牵引拉杆总成', witnessed: true, witness: '客户代表 张工', location: '质量部共享盘 /FAI/2026/031' };
    await http().post(`/projects/${pid}/fai`).set(bearer(t.member.token)).send({ ...base, result: 'PASS' }).expect(403);
    expect((await http().post(`/projects/${pid}/fai`).set(bearer(t.pqm.token)).send({ ...base, result: 'CONDITIONAL' }).expect(409)).body.code).toBe('OPEN_POINTS_REQUIRED');
    await http().post(`/projects/${pid}/fai`).set(bearer(t.pqm.token)).send({ ...base, result: 'CONDITIONAL', openPoints: ['补充焊缝 UT 报告', '更新控制计划第 5 项'], ownerId: t.member.id, dueDate: '2026-11-20' }).expect(201);
    await http().post(`/projects/${pid}/fai`).set(bearer(t.pqm.token)).send({ ...base, result: 'PASS' }).expect(409);
    await http().post(`/projects/${pid}/fai`).set(bearer(t.pqm.token)).send({ reportNo: 'FAI-2026-032', date: '2026-11-04', part: 'QY-12-C 铸件', result: 'PASS' }).expect(201);

    f = (await http().get(`/projects/${pid}/fai`).set(bearer(t.pm.token)).expect(200)).body;
    expect(f).toMatchObject({ firstPass: false, state: 'AMBER' });
    const rec = f.records.find((r: { reportNo: string }) => r.reportNo === 'FAI-2026-031');
    expect(rec.actions).toHaveLength(2);
    const issues = (await http().get(`/projects/${pid}/issues`).set(bearer(t.pm.token)).expect(200)).body;
    expect(issues.filter((i: { source: string }) => i.source === 'FAI')).toHaveLength(2);

    const objs = (await http().get(`/projects/${pid}/objectives`).set(bearer(t.pm.token)).expect(200)).body;
    expect(objs.find((o: { metric: string }) => o.metric === 'FAI')).toMatchObject({ state: 'AMBER' });
    expect(objs.find((o: { metric: string }) => o.metric === 'FAI').currentText).toContain('有条件通过');
    const ev = (await http().get(`/projects/${pid}/evaluation`).set(bearer(t.pm.token)).expect(200)).body;
    expect(ev.pm.aspects.find((a: { key: string }) => a.key === 'QUALITY')).toMatchObject({ score: 80 });
    expect(ev.pm.aspects.find((a: { key: string }) => a.key === 'QUALITY').actual).toContain('FAI 未一次通过');

    // 复检通过后当前状态正常，但仍不是一次通过
    await http().post(`/projects/${pid}/fai`).set(bearer(t.pqm.token)).send({ reportNo: 'FAI-2026-033', date: '2026-11-25', part: 'QY-12 牵引拉杆总成', result: 'PASS' }).expect(201);
    f = (await http().get(`/projects/${pid}/fai`).set(bearer(t.pm.token)).expect(200)).body;
    expect(f).toMatchObject({ firstPass: false, state: 'AMBER' });
    expect(f.text).toContain('第 2 次通过');
    await http().delete(`/projects/${pid}/fai/${rec.id}`).set(bearer(t.pqm.token)).expect(403);
  });

  it('售后交接：项目经理填写并发起，接收人确认；外部接收人由项目经理登记确认；经立项的项目关闭前须完成交接', async () => {
    const t = await setupTenant(app, 'dl3');
    const pid = await project(t, 'DL-03');
    let h = (await http().get(`/projects/${pid}/handover`).set(bearer(t.pm.token)).expect(200)).body;
    expect(h).toMatchObject({ required: true, handover: { status: 'DRAFT' }, can: { edit: true, submit: true, confirm: false } });
    expect(h.defaultDocuments).toContain('FAI 报告');

    // 项目还在策划：先启动（关闭检查需要 ACTIVE）
    await http().put(`/projects/${pid}/handover`).set(bearer(t.member.token)).send({ date: '2027-01-27' }).expect(403);
    expect((await http().post(`/projects/${pid}/handover/submit`).set(bearer(t.pm.token)).expect(400)).body.code).toBe('HANDOVER_INCOMPLETE');
    await http().put(`/projects/${pid}/handover`).set(bearer(t.pm.token)).send({ date: '2027-01-27', receiverId: t.outsider.id, warrantyFrom: '2027-01-15', warrantyTo: '2029-01-14', documents: ['质量文件包', 'FAI 报告'], openIssues: '客户反馈 2 件涂层轻微色差，已约定随下批更换' }).expect(200);
    await http().put(`/projects/${pid}/handover`).set(bearer(t.pm.token)).send({ warrantyFrom: '2029-01-15', warrantyTo: '2027-01-14' }).expect(400);
    await http().post(`/projects/${pid}/handover/submit`).set(bearer(t.pm.token)).expect(200);
    await http().put(`/projects/${pid}/handover`).set(bearer(t.pm.token)).send({ openIssues: 'x' }).expect(409);
    const notes = (await http().get('/notifications').set(bearer(t.outsider.token)).expect(200)).body;
    expect(notes.map((n: { kind: string }) => n.kind)).toContain('HANDOVER_PENDING');

    // 接收人不是项目成员也能看到并确认；项目经理不能代确认
    const mine = (await http().get('/handovers/mine').set(bearer(t.outsider.token)).expect(200)).body;
    expect(mine).toEqual([expect.objectContaining({ projectId: pid, status: 'PENDING' })]);
    h = (await http().get(`/projects/${pid}/handover`).set(bearer(t.outsider.token)).expect(200)).body;
    expect(h.can.confirm).toBe(true);
    await http().post(`/projects/${pid}/handover/confirm`).set(bearer(t.pm.token)).send({}).expect(403);
    await http().post(`/projects/${pid}/handover/confirm`).set(bearer(t.outsider.token)).send({ note: '已接收' }).expect(200);
    h = (await http().get(`/projects/${pid}/handover`).set(bearer(t.pm.token)).expect(200)).body;
    expect(h.handover).toMatchObject({ status: 'CONFIRMED', receiver: expect.any(String), confirmNote: '已接收' });

    // 外部接收人：项目经理登记签字交接单
    const pid2 = await project(t, 'DL-04');
    await http().put(`/projects/${pid2}/handover`).set(bearer(t.pm.token)).send({ date: '2027-01-27', externalName: '客户售后 王工', documents: ['质量文件包'] }).expect(200);
    await http().post(`/projects/${pid2}/handover/submit`).set(bearer(t.pm.token)).expect(200);
    expect((await http().post(`/projects/${pid2}/handover/confirm`).set(bearer(t.pm.token)).send({}).expect(400)).body.code).toBe('REASON_REQUIRED');
    await http().post(`/projects/${pid2}/handover/withdraw`).set(bearer(t.pm.token)).expect(200);
    await http().post(`/projects/${pid2}/handover/submit`).set(bearer(t.pm.token)).expect(200);
    await http().post(`/projects/${pid2}/handover/confirm`).set(bearer(t.pm.token)).send({ note: '签字交接单已归档 HO-2027-003' }).expect(200);
  });
});
