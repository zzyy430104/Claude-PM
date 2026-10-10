import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { addMember, bearer, createApp, createProject, gateProject, setupTenant } from './helpers.js';

describe('变更控制', () => {
  let app: INestApplication;
  beforeAll(async () => {
    app = await createApp();
  });
  afterAll(() => app.close());
  const http = () => request(app.getHttpServer());
  type T = Awaited<ReturnType<typeof setupTenant>>;

  const newCr = async (t: T, pid: string, body: Record<string, unknown>, token = t.member.token) =>
    (await http().post(`/projects/${pid}/changes`).set(bearer(token)).send({
      title: '变更', description: '说明', reason: '原因', ...body,
    }).expect(201)).body as { id: string; code: string };
  const act = (t: T, pid: string, cid: string, action: string, token: string, body: Record<string, unknown> = {}) =>
    http().post(`/projects/${pid}/changes/${cid}/${action}`).set(bearer(token)).send(body);

  it('预算增加的完整流程：提交、审批、实施、验证、关闭，全程留痕', async () => {
    const t = await setupTenant(app, 'c1');
    const p = await gateProject(app, t);
    const cr = await newCr(t, p.id, { type: 'BUDGET', proposed: { budget: 1200000 } });
    expect(cr.code).toBe('CR-001');

    // 缺影响分析不能提交
    const bad = await act(t, p.id, cr.id, 'submit', t.member.token).expect(400);
    expect(bad.body.code).toBe('CHANGE_INCOMPLETE');
    await http().patch(`/projects/${p.id}/changes/${cr.id}`).set(bearer(t.member.token))
      .send({ impactAnalysis: '增加外协成本，风险可控' }).expect(200);
    await act(t, p.id, cr.id, 'submit', t.member.token).expect(200);

    // 提交后不能再编辑；未批准不能实施（R6）
    await http().patch(`/projects/${p.id}/changes/${cr.id}`).set(bearer(t.member.token)).send({ title: '改标题' }).expect(409);
    await act(t, p.id, cr.id, 'implement', t.pm.token).expect(409);

    // 审批权限：普通成员不行；项目经理（CCB）可审批一般变更，但预算增加必须最高管理层批准
    await act(t, p.id, cr.id, 'approve', t.member.token).expect(403);
    const noTop = await act(t, p.id, cr.id, 'approve', t.pm.token).expect(403);
    expect(noTop.body.code).toBe('TOP_MANAGEMENT_REQUIRED');
    await act(t, p.id, cr.id, 'approve', t.top.token, { note: '同意增加预算' }).expect(200);

    const proj = await http().get(`/projects/${p.id}`).set(bearer(t.pm.token)).expect(200);
    expect(proj.body.budget).toBe('1000000');            // 批准不等于生效
    await act(t, p.id, cr.id, 'implement', t.member.token).expect(403);
    await act(t, p.id, cr.id, 'implement', t.pm.token).expect(200);
    const after = await http().get(`/projects/${p.id}`).set(bearer(t.pm.token)).expect(200);
    expect(after.body.budget).toBe('1200000');

    // 实施人不能验证自己的变更；验证需写明有效性结论
    await act(t, p.id, cr.id, 'verify', t.pm.token, { note: '有效' }).expect(403);
    await act(t, p.id, cr.id, 'verify', t.pqm.token, {}).expect(400);
    await act(t, p.id, cr.id, 'close', t.pm.token).expect(409); // 未验证不能关闭
    await act(t, p.id, cr.id, 'verify', t.pqm.token, { note: '预算已更新，成本台账一致' }).expect(200);
    await act(t, p.id, cr.id, 'close', t.pm.token).expect(200);

    const hist = await http().get(`/projects/${p.id}/changes/${cr.id}/history`).set(bearer(t.member.token)).expect(200);
    expect(hist.body.map((h: { action: string }) => h.action)).toEqual([
      'changeRequest.create', 'changeRequest.update', 'changeRequest.submit', 'changeRequest.approve',
      'changeRequest.implement', 'changeRequest.verify', 'changeRequest.close',
    ]);
  });

  it('预算减少可由变更委员会（项目经理）批准；申请人不能批准自己的申请', async () => {
    const t = await setupTenant(app, 'c2');
    const p = await gateProject(app, t);
    const own = await newCr(t, p.id, { type: 'BUDGET', proposed: { budget: 900000 }, impactAnalysis: '节约' }, t.pm.token);
    await act(t, p.id, own.id, 'submit', t.pm.token).expect(200);
    await act(t, p.id, own.id, 'approve', t.pm.token).expect(403); // 自批自
    await act(t, p.id, own.id, 'approve', t.top.token).expect(200);

    const other = await newCr(t, p.id, { type: 'BUDGET', proposed: { budget: 800000 }, impactAnalysis: '再节约' });
    await act(t, p.id, other.id, 'submit', t.member.token).expect(200);
    await act(t, p.id, other.id, 'approve', t.pm.token).expect(200);
  });

  it('由故障引起的变更必须有原因分析（R7）；技术变更必须有影响分析', async () => {
    const t = await setupTenant(app, 'c3');
    const p = await gateProject(app, t);
    const f = await newCr(t, p.id, { type: 'OTHER', triggeredByFailure: true, impactAnalysis: '影响很小' });
    const r = await act(t, p.id, f.id, 'submit', t.member.token).expect(400);
    expect(r.body.problems).toEqual(['由故障引起的变更必须包含原因分析']);
    await http().patch(`/projects/${p.id}/changes/${f.id}`).set(bearer(t.member.token)).send({ causeAnalysis: '焊接缺陷，5-Why 分析' }).expect(200);
    await act(t, p.id, f.id, 'submit', t.member.token).expect(200);

    const tech = await newCr(t, p.id, { type: 'TECHNICAL', impactAnalysis: '需再验证' });
    const r2 = await act(t, p.id, tech.id, 'submit', t.member.token).expect(400);
    expect(r2.body.problems[0]).toContain('技术变更');
    await http().patch(`/projects/${p.id}/changes/${tech.id}`).set(bearer(t.member.token)).send({
      technicalImpact: { deliveredParts: '已交付 3 套需回溯', customerSpec: '无影响', documents: '更新 FMEA', requirements: '不变', revalidation: '需重做型式试验' },
    }).expect(200);
    await act(t, p.id, tech.id, 'submit', t.member.token).expect(200);
  });

  it('客户交期变更：必须先通知客户才能批准，客户同意后才能实施', async () => {
    const t = await setupTenant(app, 'c4');
    const p = await gateProject(app, t);
    const cr = await newCr(t, p.id, { type: 'DELIVERY_DATE', proposed: { customerDeliveryDate: '2027-02-01' }, impactAnalysis: '供应商延期' });
    await act(t, p.id, cr.id, 'submit', t.member.token).expect(200);

    const early = await act(t, p.id, cr.id, 'approve', t.pm.token).expect(409);
    expect(early.body.code).toBe('CUSTOMER_NOT_NOTIFIED');
    await act(t, p.id, cr.id, 'customer-contact', t.member.token, {}).expect(403);
    await act(t, p.id, cr.id, 'customer-contact', t.pm.token, { date: '2026-06-01' }).expect(200);
    await act(t, p.id, cr.id, 'approve', t.pm.token).expect(200);

    const noAgree = await act(t, p.id, cr.id, 'implement', t.pm.token).expect(409);
    expect(noAgree.body.code).toBe('CUSTOMER_AGREEMENT_REQUIRED');
    await act(t, p.id, cr.id, 'customer-contact', t.pm.token, { agreed: true }).expect(200);
    await act(t, p.id, cr.id, 'implement', t.pm.token).expect(200);
    const proj = await http().get(`/projects/${p.id}`).set(bearer(t.pm.token)).expect(200);
    expect(proj.body.customerDeliveryDate.slice(0, 10)).toBe('2027-02-01');
  });

  it('基线后修改范围：必须引用已批准的范围变更，实施后窗口关闭', async () => {
    const t = await setupTenant(app, 'c5');
    const p = await createProject(app, t.pm.token);
    await addMember(app, t.pm.token, p.id, t.member.id, 'MEMBER');
    await http().post(`/projects/${p.id}/wbs`).set(bearer(t.pm.token)).send({ code: '1', name: '原范围', durationDays: 3 }).expect(201);
    await http().post(`/projects/${p.id}/baseline`).set(bearer(t.pm.token)).expect(200);
    const add = (extra: Record<string, unknown>) =>
      http().post(`/projects/${p.id}/wbs`).set(bearer(t.pm.token)).send({ code: 'N' + Math.random().toString(36).slice(2, 6), name: '新增', durationDays: 2, ...extra });

    await add({}).expect(409);
    const cr = await newCr(t, p.id, { type: 'SCOPE', impactAnalysis: '增加一个工作包', title: '增加范围' });
    await add({ changeRequestId: cr.id }).expect(409); // 尚未批准
    await act(t, p.id, cr.id, 'submit', t.member.token).expect(200);
    await add({ changeRequestId: cr.id }).expect(409); // 仅提交
    await act(t, p.id, cr.id, 'approve', t.pm.token).expect(200);
    await add({ changeRequestId: cr.id }).expect(201);
    await add({}).expect(409); // 没有引用变更仍然不行

    // 其他类型的变更申请不能开范围窗口
    const bud = await newCr(t, p.id, { type: 'BUDGET', proposed: { budget: 1 }, impactAnalysis: 'x' });
    await act(t, p.id, bud.id, 'submit', t.member.token).expect(200);
    await add({ changeRequestId: bud.id }).expect(409);

    await act(t, p.id, cr.id, 'implement', t.pm.token).expect(200);
    await add({ changeRequestId: cr.id }).expect(409); // 已实施，窗口关闭
  });

  it('已驳回的变更不能实施；驳回必须写明原因', async () => {
    const t = await setupTenant(app, 'c6');
    const p = await gateProject(app, t);
    const cr = await newCr(t, p.id, { type: 'OTHER', impactAnalysis: 'x' });
    await act(t, p.id, cr.id, 'submit', t.member.token).expect(200);
    await act(t, p.id, cr.id, 'reject', t.pm.token, {}).expect(400);
    await act(t, p.id, cr.id, 'reject', t.pm.token, { note: '理由不充分' }).expect(200);
    await act(t, p.id, cr.id, 'implement', t.pm.token).expect(409);
    await act(t, p.id, cr.id, 'approve', t.pm.token).expect(409);
  });

  it('非项目成员不能提变更申请，也看不到', async () => {
    const t = await setupTenant(app, 'c7');
    const p = await gateProject(app, t);
    await http().post(`/projects/${p.id}/changes`).set(bearer(t.outsider.token))
      .send({ type: 'OTHER', title: '变更', description: 'x', reason: 'y' }).expect(404);
    await http().get(`/projects/${p.id}/changes`).set(bearer(t.outsider.token)).expect(404);
  });
});
