import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { bearer, createApp, setupTenant } from './helpers.js';

type T = Awaited<ReturnType<typeof setupTenant>>;
const quality = { standards: ['ISO/TS 22163'], special: '', acceptance: '出厂检验', fai: true, faiReason: '', customerWitness: false, drawingApproval: false, rams: false };
const reqB = {
  deliveryDate: '2027-09-30', milestones: [], deliverables: [{ name: '牵引拉杆总成', quantity: '1200 件', kind: 'PRODUCT' }],
  stockLines: [], quality, cost: { cap: 3_000_000, target: 2_850_000 }, longLead: false, risks: [{ text: '铸件供应商产能', kind: 'RISK' }],
};
interface Wp { id: string; code: string; labor: number; budget: number; state: string; eac: number; commitment: number; rate: number; personDays: number }

describe('成本与质量的策划、执行与控制', () => {
  let app: INestApplication;
  const http = () => request(app.getHttpServer());
  beforeAll(async () => { app = await createApp(); });
  afterAll(() => app.close());

  async function project(t: T, code: string) {
    const i = (await http().post('/initiations').set(bearer(t.pm.token)).send({
      name: '地铁转向架牵引拉杆', type: 'B', projectCode: code, customer: '华南城轨', proposedPmId: t.pm.id, startDate: '2026-11-02', requirements: reqB,
    }).expect(201)).body;
    await http().post(`/initiations/${i.id}/submit`).set(bearer(t.pm.token)).expect(200);
    return (await http().post(`/initiations/${i.id}/approve`).set(bearer(t.top.token)).send({}).expect(200)).body.projectId as string;
  }
  const plan = async (t: T, pid: string) => (await http().get(`/projects/${pid}/cost-plan`).set(bearer(t.pm.token)).expect(200)).body;
  const wp = (p: { workPackages: Wp[] }, code: string) => p.workPackages.find((w) => w.code === code)!;
  const kinds = async (token: string) => (await http().get('/notifications').set(bearer(token)).expect(200)).body.map((n: { kind: string }) => n.kind);

  it('成本策划：人工按人天 × 角色费率自动算；费用行归科目；手工改费率要写原因；科目、目标成本、上限逐级检查', async () => {
    const t = await setupTenant(app, 'cq1');
    const pid = await project(t, 'LG-01');
    let p = await plan(t, pid);
    expect(p).toMatchObject({ cap: 3_000_000, target: 2_850_000 });
    expect(p.accounts.map((a: { name: string }) => a.name)).toEqual(['人工', '材料', '外协', '工装', '试验', '差旅', '其他']);
    expect(wp(p, '1.1')).toMatchObject({ personDays: 1, rate: 1600, labor: 1600, budget: 1600 });
    expect(wp(p, '2.5')).toMatchObject({ personDays: 15, rate: 1200, labor: 18_000 });
    expect(p.checks.every((c: { ok: boolean }) => c.ok)).toBe(true);

    const tooling = p.accounts.find((a: { name: string }) => a.name === '工装').id;
    const labor = p.accounts.find((a: { name: string }) => a.name === '人工').id;
    const w25 = wp(p, '2.5').id;
    await http().put(`/projects/${pid}/wbs/${w25}/cost`).set(bearer(t.member.token)).send({ personDays: 15 }).expect(404); // 不是项目成员
    await http().put(`/projects/${pid}/wbs/${w25}/cost`).set(bearer(t.pm.token)).send({ lines: [{ accountId: labor, amount: 1 }] }).expect(400); // 人工不走费用行
    const c = (await http().put(`/projects/${pid}/wbs/${w25}/cost`).set(bearer(t.pm.token)).send({ personDays: 15, lines: [{ accountId: tooling, description: '焊接夹具 2 套', amount: 150_000 }] }).expect(200)).body;
    expect(c).toMatchObject({ labor: 18_000, budget: 168_000 });
    const bad = await http().put(`/projects/${pid}/wbs/${w25}/cost`).set(bearer(t.pm.token)).send({ laborRate: 1500 }).expect(400);
    expect(bad.body.code).toBe('RATE_REASON_REQUIRED');
    expect((await http().put(`/projects/${pid}/wbs/${w25}/cost`).set(bearer(t.pm.token)).send({ laborRate: 1500, laborRateReason: '外聘工艺专家' }).expect(200)).body).toMatchObject({ rate: 1500, rateOverride: 1500, budget: 172_500 });

    p = await plan(t, pid);
    expect(p.checks.find((x: { key: string }) => x.key === 'costAccounts')).toMatchObject({ ok: false });
    const st = (await http().get(`/projects/${pid}/plan-approval`).set(bearer(t.pm.token)).expect(200)).body;
    expect(st.checks.find((x: { key: string }) => x.key === 'costAccounts').ok).toBe(false);
    p = (await http().post(`/projects/${pid}/cost-plan/sync-accounts`).set(bearer(t.pm.token)).expect(200)).body;
    expect(p.checks.every((x: { ok: boolean }) => x.ok)).toBe(true);
    expect(p.accounts.find((a: { name: string }) => a.name === '工装').budget).toBe(150_000);

    // 职能角色费率由企业管理员维护
    const roles = (await http().get('/functional-roles').set(bearer(t.pm.token)).expect(200)).body;
    const pmRole = roles.find((r: { name: string }) => r.name === '项目经理');
    expect(Number(pmRole.rate)).toBe(1600);
    await http().patch(`/functional-roles/${pmRole.id}`).set(bearer(t.pm.token)).send({ rate: 1800 }).expect(403);
    await http().patch(`/functional-roles/${pmRole.id}`).set(bearer(t.admin.token)).send({ rate: 1800 }).expect(200);
  });

  it('成本控制：工作包超支提醒项目经理和负责人；完工估算超目标成本报警到管理层；承诺成本计入预计完工', async () => {
    const t = await setupTenant(app, 'cq2');
    const pid = await project(t, 'LG-02');
    const roles = (await http().get('/functional-roles').set(bearer(t.pm.token)).expect(200)).body as { id: string }[];
    await http().post(`/projects/${pid}/wbs/assign-by-role`).set(bearer(t.pm.token)).send({ assignments: roles.map((r) => ({ functionalRoleId: r.id, userId: t.member.id })) }).expect(200);
    await http().post(`/projects/${pid}/members`).set(bearer(t.pm.token)).send({ userId: t.member.id, projectRole: 'MEMBER' }).expect(201);
    let p = await plan(t, pid);
    const w23 = wp(p, '2.3'); // 工艺 5 天 × 1200 = 6000
    await http().patch(`/projects/${pid}/wbs/${w23.id}`).set(bearer(t.member.token)).send({ percentComplete: 100 }).expect(200);
    const labor = p.accounts.find((a: { name: string }) => a.name === '人工').id;
    await http().post(`/projects/${pid}/cost/entries`).set(bearer(t.pm.token)).send({ accountId: labor, workPackageId: w23.id, amount: 6300, entryDate: '2026-11-20', description: '工艺工时' }).expect(201);
    p = await plan(t, pid);
    expect(wp(p, '2.3')).toMatchObject({ state: 'AMBER', eac: 6300 });
    expect(await kinds(t.member.token)).toContain('WP_COST_OVERRUN');
    expect(await kinds(t.pm.token)).toContain('WP_COST_OVERRUN');
    expect(await kinds(t.top.token)).not.toContain('PROJECT_COST_ALARM');

    await http().post(`/projects/${pid}/cost/commitments`).set(bearer(t.pm.token)).send({ accountId: labor, workPackageId: w23.id, amount: 2000, entryDate: '2026-11-21', description: '外聘工时订单' }).expect(201);
    p = await plan(t, pid);
    expect(wp(p, '2.3')).toMatchObject({ commitment: 2000, eac: 8300, state: 'RED' });

    // 负责人填“还需多少”；完工估算超过目标成本 → 报警管理层
    await http().put(`/projects/${pid}/wbs/${w23.id}/etc`).set(bearer(t.outsider.token)).send({ etc: 1 }).expect(404);
    await http().put(`/projects/${pid}/wbs/${w23.id}/etc`).set(bearer(t.member.token)).send({ etc: 3_000_000 }).expect(200);
    expect(await kinds(t.top.token)).toContain('PROJECT_COST_ALARM');
    expect((await plan(t, pid)).alarm).toBe('RED');
    await http().put(`/projects/${pid}/wbs/${w23.id}/etc`).set(bearer(t.member.token)).send({ etc: null }).expect(200);
    expect((await plan(t, pid)).alarm).toBeNull();
  });

  it('质量：工作包上自定义检验项；验证人记录结果；不合格开不符合项；核验前全部有结果、无不合格、不符合项已关闭', async () => {
    const t = await setupTenant(app, 'cq3');
    const pid = await project(t, 'LG-03');
    const roles = (await http().get('/functional-roles').set(bearer(t.pm.token)).expect(200)).body as { id: string }[];
    await http().post(`/projects/${pid}/wbs/assign-by-role`).set(bearer(t.pm.token)).send({ assignments: roles.map((r) => ({ functionalRoleId: r.id, userId: t.member.id })) }).expect(200);
    await http().post(`/projects/${pid}/members`).set(bearer(t.pm.token)).send({ userId: t.pqm.id, projectRole: 'PROJECT_QUALITY_MANAGER' }).expect(201);
    await http().post(`/projects/${pid}/members`).set(bearer(t.pm.token)).send({ userId: t.member.id, projectRole: 'MEMBER' }).expect(201);

    // 模板带出的默认检验项
    let all = (await http().get(`/projects/${pid}/inspections`).set(bearer(t.pm.token)).expect(200)).body;
    expect(all.find((i: { workPackage: { code: string } }) => i.workPackage.code === '2.3')).toMatchObject({ name: 'PFMEA、控制计划', category: '文件', result: 'PENDING' });
    const w25 = (await plan(t, pid)).workPackages.find((w: Wp) => w.code === '2.5').id;

    await http().post(`/projects/${pid}/wbs/${w25}/inspections`).set(bearer(t.pm.token)).send({ name: '包装防护', category: '包装' }).expect(400);
    await http().patch('/tenant-settings').set(bearer(t.admin.token)).send({ inspectionCategories: ['产品', '过程', '文件', '评审', '试验', '包装'] }).expect(200);
    await http().post(`/projects/${pid}/wbs/${w25}/inspections`).set(bearer(t.member.token)).send({ name: '检具 MSA', category: '过程' }).expect(403);
    const msa = (await http().post(`/projects/${pid}/wbs/${w25}/inspections`).set(bearer(t.pm.token)).send({ name: '检具 MSA', category: '过程', requirement: 'GR&R ≤ 10%', method: 'MSA 分析', record: 'MSA 报告', verifierId: t.pqm.id, isKey: true }).expect(201)).body;
    const tpls = (await http().get('/inspection-templates').set(bearer(t.pm.token)).expect(200)).body;
    expect(tpls).toHaveLength(8);
    const dim = (await http().post(`/projects/${pid}/wbs/${w25}/inspections/from-template`).set(bearer(t.pm.token)).send({ templateId: tpls[0].id }).expect(201)).body;
    expect(dim).toMatchObject({ name: '尺寸检验', category: '产品' });

    await http().post(`/projects/${pid}/inspections/${msa.id}/result`).set(bearer(t.member.token)).send({ result: 'PASS' }).expect(403);
    await http().post(`/projects/${pid}/inspections/${dim.id}/result`).set(bearer(t.pqm.token)).send({ result: 'NA' }).expect(400);
    await http().post(`/projects/${pid}/inspections/${msa.id}/result`).set(bearer(t.pqm.token)).send({ result: 'FAIL', recordNo: 'MSA-001', note: 'GR&R 14%' }).expect(200);
    await http().post(`/projects/${pid}/inspections/${dim.id}/result`).set(bearer(t.pqm.token)).send({ result: 'PASS', recordNo: 'QR-101' }).expect(200);
    const nc = (await http().post(`/projects/${pid}/inspections/${msa.id}/nonconformity`).set(bearer(t.pqm.token)).expect(201)).body;
    expect(nc).toMatchObject({ workPackageId: w25, severity: 'MAJOR', source: 'INSPECTION' });
    await http().post(`/projects/${pid}/inspections/${msa.id}/nonconformity`).set(bearer(t.pqm.token)).expect(409);
    await http().delete(`/projects/${pid}/inspections/${msa.id}`).set(bearer(t.pm.token)).expect(409); // 有结果的不能删

    // 负责人完成后，核验被挡住
    await http().patch(`/projects/${pid}/wbs/${w25}`).set(bearer(t.member.token)).send({ percentComplete: 100 }).expect(200);
    const blocked = await http().post(`/projects/${pid}/wbs/${w25}/verify`).set(bearer(t.pqm.token)).expect(409);
    expect(blocked.body.code).toBe('INSPECTION_INCOMPLETE');
    expect(blocked.body.blockers.join()).toContain('不合格');
    expect(blocked.body.blockers.join()).toContain(nc.code);

    // 返工后复检合格：一次合格率仍按第一次结果算
    await http().post(`/projects/${pid}/inspections/${msa.id}/result`).set(bearer(t.pqm.token)).send({ result: 'PASS', recordNo: 'MSA-002' }).expect(200);
    const stats = (await http().get(`/projects/${pid}/inspections/stats`).set(bearer(t.pm.token)).expect(200)).body;
    expect(stats).toMatchObject({ failed: 0, firstPassYield: 50 });
    all = (await http().get(`/projects/${pid}/inspections`).set(bearer(t.pm.token)).expect(200)).body;
    expect(all.find((i: { id: string }) => i.id === msa.id)).toMatchObject({ result: 'PASS', firstResult: 'FAIL', ncId: nc.id });
    const dflt = all.find((i: { workPackage: { code: string }; id: string }) => i.workPackage.code === '2.5' && i.id !== msa.id && i.id !== dim.id);
    await http().post(`/projects/${pid}/inspections/${dflt.id}/result`).set(bearer(t.pm.token)).send({ result: 'PASS', recordNo: 'TL-01' }).expect(200);
    const still = await http().post(`/projects/${pid}/wbs/${w25}/verify`).set(bearer(t.pqm.token)).expect(409);
    expect(still.body.blockers).toEqual([`关联的不符合项未关闭：${nc.code}`]);

    // 计划批准检查包含质量项
    const st = (await http().get(`/projects/${pid}/plan-approval`).set(bearer(t.pm.token)).expect(200)).body;
    expect(st.checks.find((x: { key: string }) => x.key === 'quality')).toMatchObject({ ok: true });
    expect(st.checks.find((x: { key: string }) => x.key === 'qualityKey')).toMatchObject({ ok: true });
  });
});
