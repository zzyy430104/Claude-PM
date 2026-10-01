import { INestApplication } from '@nestjs/common';
import ExcelJS from 'exceljs';
import request from 'supertest';
import { bearer, createApp, setupTenant, signupTenant } from './helpers.js';

type T = Awaited<ReturnType<typeof setupTenant>>;

const quality = { standards: ['ISO/TS 22163'], special: '', acceptance: '出厂检验', fai: true, faiReason: '', customerWitness: false, drawingApproval: false, rams: false };
const reqB = {
  deliveryDate: '2027-09-30', milestones: [{ name: '首批交付', date: '2027-06-30' }],
  deliverables: [{ name: '座椅骨架总成 ZY-03', quantity: '1200 套', kind: 'PRODUCT' }, { name: '出厂检验报告', quantity: '每批', kind: 'DOCUMENT' }],
  stockLines: [], quality, cost: { cap: 3_000_000, target: 2_850_000 }, longLead: false,
  risks: [{ text: '焊接产能紧张', kind: 'RISK' }],
};

describe('立项、项目要求、计划批准', () => {
  let app: INestApplication;
  const http = () => request(app.getHttpServer());
  beforeAll(async () => {
    app = await createApp();
  });
  afterAll(() => app.close());

  const newInit = (t: T, token: string, body: Record<string, unknown>) => http().post('/initiations').set(bearer(token)).send({ name: '动车组座椅骨架', ...body });

  /** 按角色把所有工作包指给一个人 */
  async function assignAll(t: T, projectId: string, userId: string) {
    const roles = (await http().get('/functional-roles').set(bearer(t.pm.token)).expect(200)).body as { id: string }[];
    await http().post(`/projects/${projectId}/wbs/assign-by-role`).set(bearer(t.pm.token)).send({ assignments: roles.map((r) => ({ functionalRoleId: r.id, userId })) }).expect(200);
  }

  it('B 类：申请 → 批准生成项目和计划草稿 → 计划对照项目要求检查 → 提交 → 批准', async () => {
    const t = await setupTenant(app, 'in1');
    const draft = (await newInit(t, t.pm.token, { type: 'B' }).expect(201)).body;
    expect(draft).toMatchObject({ status: 'DRAFT', code: expect.stringMatching(/^LX-\d{4}-001$/) });
    const inc = await http().post(`/initiations/${draft.id}/submit`).set(bearer(t.pm.token)).expect(400);
    expect(inc.body.problems).toEqual(expect.arrayContaining(['项目编号', '客户', '成本上限']));
    await http().patch(`/initiations/${draft.id}`).set(bearer(t.member.token)).send({ customer: 'x' }).expect(403);
    await http().patch(`/initiations/${draft.id}`).set(bearer(t.pm.token)).send({
      projectCode: 'ZY-03', customer: '华南城轨（示例）', contractNo: 'HN-0917', proposedPmId: t.pm.id, startDate: '2026-11-02', requirements: reqB,
    }).expect(200);
    await http().post(`/initiations/${draft.id}/submit`).set(bearer(t.pm.token)).expect(200);
    await http().patch(`/initiations/${draft.id}`).set(bearer(t.pm.token)).send({ customer: 'y' }).expect(409); // 提交后锁定
    expect((await http().get('/notifications').set(bearer(t.top.token)).expect(200)).body.map((n: { kind: string }) => n.kind)).toContain('INITIATION_SUBMITTED');

    await http().post(`/initiations/${draft.id}/approve`).set(bearer(t.pm.token)).send({}).expect(403); // 不是批准人
    await http().post(`/initiations/${draft.id}/reject`).set(bearer(t.top.token)).send({}).expect(400); // 驳回要写原因
    const ok = (await http().post(`/initiations/${draft.id}/approve`).set(bearer(t.top.token)).send({ note: '同意' }).expect(200)).body;
    expect(ok.removed.map((r: { code: string }) => r.code)).toEqual(['3.3', '5.2']);
    await http().post(`/initiations/${draft.id}/approve`).set(bearer(t.top.token)).send({}).expect(409);

    const pid = ok.projectId;
    const p = (await http().get(`/projects/${pid}`).set(bearer(t.pm.token)).expect(200)).body;
    expect(p).toMatchObject({ code: 'ZY-03', type: 'B', status: 'PLANNING', requirementVersion: 1, customerDeliveryDate: expect.stringContaining('2027-09-30') });
    const phases = (await http().get(`/projects/${pid}/phases`).set(bearer(t.pm.token)).expect(200)).body.map((x: { name: string }) => x.name);
    expect(phases).toEqual(['项目策划', '技术准备', 'FAI 首件鉴定', '量产', '交付', '项目总结']);
    const wbs = (await http().get(`/projects/${pid}/wbs`).set(bearer(t.pm.token)).expect(200)).body;
    expect(wbs.items).toHaveLength(34);
    expect(wbs.items.find((w: { code: string }) => w.code === '5.3')).toMatchObject({ isPurchase: true, phaseId: null });
    expect(wbs.items.find((w: { code: string }) => w.code === '6.3')).toMatchObject({ isMilestone: true, deliverableId: expect.any(String) });
    expect(wbs.requiredEnd).toBe('2027-09-30');
    expect(wbs.gapDays).toBeLessThan(0);
    expect(wbs.items.find((w: { code: string }) => w.code === '1.1').latestStart).toMatch(/^2027-/);
    const versions = (await http().get(`/projects/${pid}/requirement-versions`).set(bearer(t.pm.token)).expect(200)).body;
    expect(versions[0]).toMatchObject({ version: 1, reason: '立项批准' });
    expect((await http().get(`/projects/${pid}/deliverables`).set(bearer(t.pm.token)).expect(200)).body).toHaveLength(2);
    expect((await http().get(`/projects/${pid}/risks`).set(bearer(t.pm.token)).expect(200)).body[0].title).toBe('焊接产能紧张');
    expect((await http().get('/notifications').set(bearer(t.pm.token)).expect(200)).body.map((n: { kind: string }) => n.kind)).toContain('INITIATION_DECIDED');

    // 由立项生成的项目不能由项目经理自己批准计划
    await http().post(`/projects/${pid}/baseline`).set(bearer(t.pm.token)).expect(409);
    let st = (await http().get(`/projects/${pid}/plan-approval`).set(bearer(t.pm.token)).expect(200)).body;
    expect(st).toMatchObject({ needsApproval: true, ok: false, can: { submit: true, approve: false } });
    expect(st.checks.find((c: { key: string }) => c.key === 'owner').ok).toBe(false);
    const fail = await http().post(`/projects/${pid}/plan-approval/submit`).set(bearer(t.pm.token)).expect(400);
    expect(fail.body.code).toBe('PLAN_CHECK_FAILED');

    await assignAll(t, pid, t.pm.id);
    st = (await http().get(`/projects/${pid}/plan-approval`).set(bearer(t.pm.token)).expect(200)).body;
    expect(st.checks.filter((c: { ok: boolean }) => !c.ok)).toEqual([]);
    await http().post(`/projects/${pid}/plan-approval/approve`).set(bearer(t.top.token)).expect(409); // 还没提交
    await http().post(`/projects/${pid}/plan-approval/submit`).set(bearer(t.pm.token)).expect(200);
    await http().post(`/projects/${pid}/plan-approval/approve`).set(bearer(t.pm.token)).expect(403);
    await http().post(`/projects/${pid}/plan-approval/return`).set(bearer(t.top.token)).send({ note: '采购计划再细化' }).expect(200);
    await http().post(`/projects/${pid}/plan-approval/submit`).set(bearer(t.pm.token)).expect(200);
    st = (await http().post(`/projects/${pid}/plan-approval/approve`).set(bearer(t.top.token)).expect(200)).body;
    expect(st).toMatchObject({ baselined: true, outdated: false, submittedAt: null });
    expect((await http().get(`/projects/${pid}`).set(bearer(t.pm.token)).expect(200)).body.status).toBe('ACTIVE');
    expect((await http().get(`/projects/${pid}/plan-versions`).set(bearer(t.pm.token)).expect(200)).body).toHaveLength(1);

    // 项目要求变更：B → A，交期调整；批准后补阶段、计划待重新批准
    const rc = (await http().post(`/projects/${pid}/requirement-changes`).set(bearer(t.pm.token)).send({ reason: '客户补充协议：增加结构设计', type: 'A', requirements: { deliveryDate: '2028-03-31' } }).expect(201)).body;
    expect(rc).toMatchObject({ code: expect.stringMatching(/^RC-\d{4}-001$/), status: 'DRAFT', fromVersion: 1 });
    await http().post(`/requirement-changes/${rc.id}/submit`).set(bearer(t.pm.token)).expect(200);
    await http().post(`/requirement-changes/${rc.id}/approve`).set(bearer(t.pm.token)).send({}).expect(403);
    const appr = (await http().post(`/requirement-changes/${rc.id}/approve`).set(bearer(t.top.token)).send({}).expect(200)).body;
    expect(appr).toEqual({ version: 2, addedPhases: ['产品设计开发', '工艺设计开发'] });
    const p2 = (await http().get(`/projects/${pid}`).set(bearer(t.pm.token)).expect(200)).body;
    expect(p2).toMatchObject({ type: 'A', requirementVersion: 2, planOutdated: true, customerDeliveryDate: expect.stringContaining('2028-03-31') });
    st = (await http().get(`/projects/${pid}/plan-approval`).set(bearer(t.pm.token)).expect(200)).body;
    expect(st.can.submit).toBe(true);
    await http().post(`/projects/${pid}/plan-approval/submit`).set(bearer(t.pm.token)).expect(200);
    st = (await http().post(`/projects/${pid}/plan-approval/approve`).set(bearer(t.top.token)).expect(200)).body;
    expect(st.outdated).toBe(false);
    const pv = (await http().get(`/projects/${pid}/plan-versions`).set(bearer(t.pm.token)).expect(200)).body;
    expect(pv[0].note).toBe('按项目要求 v2 重新批准计划');
    expect((await http().get('/requirement-changes').set(bearer(t.top.token)).expect(200)).body[0]).toMatchObject({ status: 'APPROVED', project: { code: 'ZY-03' } });
  });

  it('C 类 + 会签：指定申请人、会签人、批准人；会签完成才进入审批；不做 FAI 时去掉 FAI 阶段', async () => {
    const t = await setupTenant(app, 'in2');
    await http().patch('/tenant-settings').set(bearer(t.admin.token)).send({ requireCosign: true }).expect(200);
    await http().put('/approval-roles/INITIATOR').set(bearer(t.admin.token)).send({ entries: [{ userId: t.member.id, basis: '销售部' }] }).expect(200);
    await http().put('/approval-roles/COSIGNER').set(bearer(t.admin.token)).send({ entries: [{ userId: t.pqm.id }] }).expect(200);
    const adminId = (await http().get('/me').set(bearer(t.admin.token)).expect(200)).body.id as string;
    await http().put('/approval-roles/APPROVER').set(bearer(t.admin.token)).send({ entries: [{ userId: adminId, basis: '授权书 2026-01', validFrom: '2026-01-01', validTo: '2099-12-31' }, { userId: t.top.id, validTo: '2020-12-31' }] }).expect(200);
    await http().put('/approval-roles/APPROVER').set(bearer(t.pm.token)).send({ entries: [] }).expect(403);
    expect((await http().get('/approval-roles/mine').set(bearer(t.member.token)).expect(200)).body).toEqual({ initiator: true, approver: false, cosigner: false, planApprover: false });
    expect((await http().get('/approval-roles/mine').set(bearer(t.top.token)).expect(200)).body.approver).toBe(false); // 授权已过期
    await newInit(t, t.pm.token, { type: 'C' }).expect(403); // 项目经理已不是申请人

    const c = (await newInit(t, t.member.token, {
      name: '制动闸片 2027Q1 备货', type: 'C', projectCode: 'ZP-27Q1', proposedPmId: t.pm.id, startDate: '2026-11-02',
      requirements: { ...reqB, deliveryDate: undefined, deliverables: [], stockLines: [{ product: '制动闸片 ZP-220', quantity: 4000, date: '2027-03-31' }, { product: '制动闸片 ZP-180', quantity: 2500, date: '2027-04-30' }], quality: { ...quality, fai: false, faiReason: '工艺未变更' } },
    }).expect(201)).body;
    await http().post(`/initiations/${c.id}/submit`).set(bearer(t.member.token)).expect(200);
    expect((await http().get(`/initiations/${c.id}`).set(bearer(t.pqm.token)).expect(200)).body).toMatchObject({ status: 'COSIGN', can: { cosign: true, decide: false } });
    await http().post(`/initiations/${c.id}/approve`).set(bearer(t.admin.token)).send({}).expect(409);
    await http().post(`/initiations/${c.id}/opinions`).set(bearer(t.pm.token)).send({ agree: true, opinion: '同意' }).expect(403);
    await http().post(`/initiations/${c.id}/opinions`).set(bearer(t.pqm.token)).send({ agree: true, opinion: '同意，首批加严检验' }).expect(200);
    await http().post(`/initiations/${c.id}/opinions`).set(bearer(t.pqm.token)).send({ agree: true, opinion: '再签' }).expect(409);
    await http().post(`/initiations/${c.id}/approve`).set(bearer(t.top.token)).send({}).expect(403);
    const ok = (await http().post(`/initiations/${c.id}/approve`).set(bearer(t.admin.token)).send({}).expect(200)).body;
    const phases = (await http().get(`/projects/${ok.projectId}/phases`).set(bearer(t.pm.token)).expect(200)).body.map((x: { name: string }) => x.name);
    expect(phases).toEqual(['项目策划', '技术准备', '生产', '入库', '项目总结']);
    const p = (await http().get(`/projects/${ok.projectId}`).set(bearer(t.pm.token)).expect(200)).body;
    expect(p).toMatchObject({ type: 'C', customerDeliveryDate: expect.stringContaining('2027-04-30') });
    expect((await http().get(`/projects/${ok.projectId}/deliverables`).set(bearer(t.pm.token)).expect(200)).body.map((d: { name: string }) => d.name)).toEqual(['制动闸片 ZP-220（4000）', '制动闸片 ZP-180（2500）']);
    const logs = (await http().get(`/audit-logs?entity=Initiation&entityId=${c.id}`).set(bearer(t.admin.token)).expect(200)).body.map((l: { action: string }) => l.action);
    expect(logs).toEqual(expect.arrayContaining(['initiation.create', 'initiation.submit', 'initiation.cosign', 'initiation.approve']));

    // 驳回后申请人可以修改再提交；撤销后不能再提交
    const d = (await newInit(t, t.member.token, { name: '驳回演示', type: 'C', projectCode: 'RJ-1', proposedPmId: t.pm.id, startDate: '2026-11-02', requirements: c.requirements }).expect(201)).body;
    await http().post(`/initiations/${d.id}/submit`).set(bearer(t.member.token)).expect(200);
    await http().post(`/initiations/${d.id}/opinions`).set(bearer(t.pqm.token)).send({ agree: false, opinion: '库存够用' }).expect(200);
    await http().post(`/initiations/${d.id}/reject`).set(bearer(t.admin.token)).send({ note: '库存够用，暂不备货' }).expect(200);
    await http().patch(`/initiations/${d.id}`).set(bearer(t.member.token)).send({ name: '驳回演示（修改）' }).expect(200);
    await http().post(`/initiations/${d.id}/withdraw`).set(bearer(t.member.token)).expect(200);
    await http().post(`/initiations/${d.id}/submit`).set(bearer(t.member.token)).expect(409);
  });

  it('不开启小项目免立项时不能直接建项目；可见性和租户隔离', async () => {
    const admin = await signupTenant(app, 'in3');
    await http().post('/projects').set(bearer(admin.token)).send({ code: 'P-1', name: '直接建', riskLevel: 'LOW', startDate: '2026-01-05', endDate: '2026-02-05' }).expect(403);
    const t = await setupTenant(app, 'in4');
    const i = (await newInit(t, t.pm.token, { type: 'B' }).expect(201)).body;
    await http().get('/initiations').set(bearer(t.member.token)).expect(403);
    await http().get(`/initiations/${i.id}`).set(bearer(admin.token)).expect(404);
    await http().get('/initiations').set(bearer(t.top.token)).expect(200);
  });

  it('A/B/C 模板可改、可导出导入、可恢复默认；可选工作包库加到项目里', async () => {
    const t = await setupTenant(app, 'in5');
    const b = (await http().get('/plan-templates/B').set(bearer(t.pm.token)).expect(200)).body;
    expect(b).toMatchObject({ type: 'B', custom: false });
    await http().put('/plan-templates/B').set(bearer(t.pm.token)).send({ items: b.items }).expect(403);
    const cyc = b.items.map((r: { code: string; predecessors?: string[] }) => (r.code === '1.1' ? { ...r, predecessors: ['1.5'] } : r));
    expect((await http().put('/plan-templates/B').set(bearer(t.admin.token)).send({ items: cyc }).expect(400)).body.message).toContain('循环');
    const changed = b.items.map((r: { code: string; durationDays?: number }) => (r.code === '4.2' ? { ...r, durationDays: 22 } : r));
    await http().put('/plan-templates/B').set(bearer(t.admin.token)).send({ items: changed }).expect(200);

    const xlsx = await http().get('/plan-templates/B/export').set(bearer(t.admin.token)).buffer(true).parse((res, cb) => { const d: Buffer[] = []; res.on('data', (c: Buffer) => d.push(c)); res.on('end', () => cb(null, Buffer.concat(d))); }).expect(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(xlsx.body as ArrayBuffer);
    const ws = wb.worksheets[0];
    const row = ws.getRows(2, ws.rowCount)!.find((r) => r.getCell(1).value === '4.2')!;
    expect(row.getCell(4).value).toBe(22);
    row.getCell(4).value = 25;
    const out = Buffer.from(await wb.xlsx.writeBuffer());
    const imp = (await http().post('/plan-templates/B/import').set(bearer(t.admin.token)).attach('file', out, 'b.xlsx').expect(200)).body;
    expect(imp.items.find((r: { code: string }) => r.code === '4.2').durationDays).toBe(25);
    row.getCell(3).value = '不知道';
    const bad = Buffer.from(await wb.xlsx.writeBuffer());
    expect((await http().post('/plan-templates/B/import').set(bearer(t.admin.token)).attach('file', bad, 'b.xlsx').expect(400)).body.problems[0]).toContain('类别');
    expect((await http().post('/plan-templates/B/reset').set(bearer(t.admin.token)).expect(200)).body.custom).toBe(false);

    const lib = (await http().get('/optional-work-packages').set(bearer(t.pm.token)).expect(200)).body;
    expect(lib).toHaveLength(11);
    await http().post('/optional-work-packages').set(bearer(t.admin.token)).send({ name: '型式试验', durationDays: 20 }).expect(409);
    await http().post('/optional-work-packages').set(bearer(t.pm.token)).send({ name: '新项', durationDays: 3 }).expect(403);
    const proj = (await http().post('/projects').set(bearer(t.pm.token)).send({ code: 'LIB-1', name: '可选库项目', riskLevel: 'LOW', startDate: '2026-01-05', endDate: '2026-06-30' }).expect(201)).body;
    const parent = (await http().post(`/projects/${proj.id}/wbs`).set(bearer(t.pm.token)).send({ code: '2', name: '技术准备', durationDays: 1 }).expect(201)).body;
    const typeTest = lib.find((l: { name: string }) => l.name === '型式试验');
    const wp = (await http().post(`/projects/${proj.id}/wbs/from-library`).set(bearer(t.pm.token)).send({ libraryId: typeTest.id, parentId: parent.id }).expect(201)).body;
    expect(wp).toMatchObject({ code: '2.1', name: '型式试验', durationDays: 20, functionalRoleId: expect.any(String) });
    await http().post(`/projects/${proj.id}/wbs/from-library`).set(bearer(t.member.token)).send({ libraryId: typeTest.id }).expect(404);
  });
});
