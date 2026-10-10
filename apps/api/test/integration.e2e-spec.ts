import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { bearer, createApp, gateProject, setupTenant } from './helpers.js';

describe('整合：需求、工作包四要素、计划批准版本', () => {
  let app: INestApplication;
  beforeAll(async () => {
    app = await createApp();
  });
  afterAll(() => app.close());
  const http = () => request(app.getHttpServer());
  type T = Awaited<ReturnType<typeof setupTenant>>;

  /** 走完一个已批准（未实施）的变更，返回其 id */
  const approvedCr = async (t: T, pid: string, type: string, proposed?: Record<string, unknown>) => {
    const cr = await http().post(`/projects/${pid}/changes`).set(bearer(t.member.token))
      .send({ type, title: '变更', description: '说明', reason: '原因', impactAnalysis: '影响可控', proposed }).expect(201);
    await http().post(`/projects/${pid}/changes/${cr.body.id}/submit`).set(bearer(t.member.token)).expect(200);
    await http().post(`/projects/${pid}/changes/${cr.body.id}/approve`).set(bearer(t.top.token)).send({ note: '同意' }).expect(200);
    return cr.body.id as string;
  };

  it('需求：关联交付物，批准计划前可自由增删，批准后增删须引用已批准的范围变更', async () => {
    const t = await setupTenant(app, 'rq');
    const p = await gateProject(app, t, { baseline: false });
    const d = await http().post(`/projects/${p.id}/deliverables`).set(bearer(t.pm.token)).send({ name: '型式试验报告', kind: 'CUSTOMER_APPROVAL' }).expect(201);
    const r = await http().post(`/projects/${p.id}/requirements`).set(bearer(t.pqm.token))
      .send({ code: 'R-1', title: '最高运行速度 160 km/h', category: 'TECHNICAL', source: '技术规格书 3.1', verificationMethod: '型式试验', deliverableId: d.body.id }).expect(201);
    expect(r.body.status).toBe('OPEN');
    await http().post(`/projects/${p.id}/requirements`).set(bearer(t.member.token)).send({ code: 'R-2', title: 'x', category: 'OTHER' }).expect(403);
    await http().post(`/projects/${p.id}/requirements`).set(bearer(t.pm.token)).send({ code: 'R-1', title: '重复', category: 'OTHER' }).expect(409);

    await http().post(`/projects/${p.id}/baseline`).set(bearer(t.pm.token)).expect(200);
    const blocked = await http().post(`/projects/${p.id}/requirements`).set(bearer(t.pm.token)).send({ code: 'R-2', title: '新增', category: 'TIME' }).expect(409);
    expect(blocked.body.code).toBe('CHANGE_REQUEST_REQUIRED');
    // 状态更新不受限
    await http().patch(`/projects/${p.id}/requirements/${r.body.id}`).set(bearer(t.pqm.token)).send({ status: 'VERIFIED' }).expect(200);
    const crId = await approvedCr(t, p.id, 'SCOPE');
    await http().post(`/projects/${p.id}/requirements`).set(bearer(t.pm.token)).send({ code: 'R-2', title: '新增', category: 'TIME', changeRequestId: crId }).expect(201);
    await http().delete(`/projects/${p.id}/requirements/${r.body.id}`).set(bearer(t.pm.token)).expect(409);
    await http().delete(`/projects/${p.id}/requirements/${r.body.id}?changeRequestId=${crId}`).set(bearer(t.pm.token)).expect(204);
    const list = await http().get(`/projects/${p.id}/requirements`).set(bearer(t.member.token)).expect(200);
    expect(list.body.map((x: { code: string }) => x.code)).toEqual(['R-2']);
  });

  it('工作包四要素：阶段、成本科目、交付物、资源、外部供方与长周期标识；引用必须属于本项目', async () => {
    const t = await setupTenant(app, 'wp4');
    const p = await gateProject(app, t, { baseline: false });
    const other = await gateProject(app, t, { baseline: false });
    const acct = await http().post(`/projects/${p.id}/cost/accounts`).set(bearer(t.pm.token)).send({ code: 'CA1', name: '外购件', budget: 50000 }).expect(201);
    const d = await http().post(`/projects/${p.id}/deliverables`).set(bearer(t.pm.token)).send({ name: '转向架构架', kind: 'EXTERNAL_PROVIDER', supplier: '某铸造厂' }).expect(201);
    const wp = await http().post(`/projects/${p.id}/wbs`).set(bearer(t.pm.token)).send({
      code: '1', name: '构架采购', durationDays: 60, phaseId: p.phases[1].id, costAccountId: acct.body.id, deliverableId: d.body.id,
      budget: 40000, resourceDays: 12.5, externalProvider: '某铸造厂', longLead: true,
    }).expect(201);
    expect(wp.body).toMatchObject({ phaseId: p.phases[1].id, costAccountId: acct.body.id, deliverableId: d.body.id, externalProvider: '某铸造厂', longLead: true });
    expect(Number(wp.body.resourceDays)).toBe(12.5);

    const otherAcct = await http().post(`/projects/${other.id}/cost/accounts`).set(bearer(t.pm.token)).send({ code: 'X', name: 'x', budget: 1 }).expect(201);
    await http().patch(`/projects/${p.id}/wbs/${wp.body.id}`).set(bearer(t.pm.token)).send({ costAccountId: otherAcct.body.id }).expect(400);
    await http().patch(`/projects/${p.id}/wbs/${wp.body.id}`).set(bearer(t.pm.token)).send({ phaseId: other.phases[0].id }).expect(400);
    // 可以清除关联
    const cleared = await http().patch(`/projects/${p.id}/wbs/${wp.body.id}`).set(bearer(t.pm.token)).send({ phaseId: null, externalProvider: '', longLead: false }).expect(200);
    expect(cleared.body).toMatchObject({ phaseId: null, externalProvider: null, longLead: false });

    // 成本可以记到工作包；工作包必须属于本项目
    await http().post(`/projects/${p.id}/cost/entries`).set(bearer(t.pm.token)).send({ accountId: acct.body.id, workPackageId: wp.body.id, amount: 1000, entryDate: '2026-02-01', description: '首付款' }).expect(201);
    const otherWp = await http().post(`/projects/${other.id}/wbs`).set(bearer(t.pm.token)).send({ code: '1', name: 'x', durationDays: 1 }).expect(201);
    await http().post(`/projects/${p.id}/cost/entries`).set(bearer(t.pm.token)).send({ accountId: acct.body.id, workPackageId: otherWp.body.id, amount: 1, entryDate: '2026-02-01', description: 'x' }).expect(400);
  });

  it('批准计划保存第 1 版快照；实施预算变更后保存第 2 版，旧版本不变', async () => {
    const t = await setupTenant(app, 'pv');
    const p = await gateProject(app, t, { baseline: false });
    await http().post(`/projects/${p.id}/wbs`).set(bearer(t.pm.token)).send({ code: '1', name: '设计', durationDays: 10, budget: 1000 }).expect(201);
    await http().post(`/projects/${p.id}/baseline`).set(bearer(t.pm.token)).expect(200);
    let versions = (await http().get(`/projects/${p.id}/plan-versions`).set(bearer(t.member.token)).expect(200)).body;
    expect(versions).toHaveLength(1);
    expect(versions[0]).toMatchObject({ version: 1, note: '批准计划' });
    expect(versions[0].snapshot.project.budget).toBe('1000000');
    expect(versions[0].snapshot.workPackages[0]).toMatchObject({ code: '1', start: '2026-01-05', end: '2026-01-16', durationDays: 10 });

    const crId = await approvedCr(t, p.id, 'BUDGET', { budget: 1100000 });
    await http().post(`/projects/${p.id}/changes/${crId}/implement`).set(bearer(t.pm.token)).expect(200);
    versions = (await http().get(`/projects/${p.id}/plan-versions`).set(bearer(t.member.token)).expect(200)).body;
    expect(versions.map((v: { version: number }) => v.version)).toEqual([2, 1]);
    expect(versions[0].changeRequestId).toBe(crId);
    expect(versions[0].snapshot.project.budget).toBe('1100000');
    expect(versions[1].snapshot.project.budget).toBe('1000000');
  });

  it('证据包包含需求和计划版本', async () => {
    const t = await setupTenant(app, 'ev2');
    const p = await gateProject(app, t);
    const res = await http().get(`/projects/${p.id}/evidence-pack`).set(bearer(t.pm.token)).buffer(true)
      .parse((r, cb) => { const c: Buffer[] = []; r.on('data', (x: Buffer) => c.push(x)); r.on('end', () => cb(null, Buffer.concat(c))); }).expect(200);
    const text = (res.body as Buffer).toString('latin1');
    expect(text).toContain('requirements.json');
    expect(text).toContain('plan-versions.json');
  });
});
