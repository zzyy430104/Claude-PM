import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { bearer, createApp, gateProject, setupTenant } from './helpers.js';

describe('对比：挣值、计划与实际、三方面红黄绿', () => {
  let app: INestApplication;
  beforeAll(async () => {
    app = await createApp();
  });
  afterAll(() => app.close());
  const http = () => request(app.getHttpServer());

  /** 项目 2026-01-05 开始，两个并行工作包各 10 天、预算 1000；今天已过计划完成日，PV = BAC */
  const setup = async (label: string) => {
    const t = await setupTenant(app, label);
    const p = await gateProject(app, t, { baseline: false });
    const w1 = await http().post(`/projects/${p.id}/wbs`).set(bearer(t.pm.token)).send({ code: '1', name: '设计', durationDays: 10, budget: 1000, phaseId: p.phases[0].id }).expect(201);
    const w2 = await http().post(`/projects/${p.id}/wbs`).set(bearer(t.pm.token)).send({ code: '2', name: '采购', durationDays: 10, budget: 1000, phaseId: p.phases[0].id }).expect(201);
    return { t, p, w1: w1.body.id as string, w2: w2.body.id as string };
  };

  it('批准前没有基准：不计算 SPI / CPI', async () => {
    const { t, p } = await setup('pf0');
    const r = await http().get(`/projects/${p.id}/performance`).set(bearer(t.member.token)).expect(200);
    expect(r.body.baselineVersion).toBeNull();
    expect(r.body.evm.spi).toBeNull();
    expect(r.body.evm.cpi).toBeNull();
  });

  it('按批准快照计算 PV / EV / AC、SPI / CPI、EAC，并判断红黄绿', async () => {
    const { t, p, w1, w2 } = await setup('pf1');
    await http().post(`/projects/${p.id}/baseline`).set(bearer(t.pm.token)).expect(200);
    await http().patch(`/projects/${p.id}/wbs/${w1}`).set(bearer(t.pm.token)).send({ percentComplete: 100 }).expect(200);
    await http().patch(`/projects/${p.id}/wbs/${w2}`).set(bearer(t.pm.token)).send({ percentComplete: 50 }).expect(200);
    const acct = await http().post(`/projects/${p.id}/cost/accounts`).set(bearer(t.pm.token)).send({ code: 'A', name: '人工', budget: 5000 }).expect(201);
    await http().post(`/projects/${p.id}/cost/entries`).set(bearer(t.pm.token)).send({ accountId: acct.body.id, workPackageId: w1, amount: 1000, entryDate: '2026-01-10', description: '人工' }).expect(201);

    const r = (await http().get(`/projects/${p.id}/performance`).set(bearer(t.member.token)).expect(200)).body;
    expect(r.baselineVersion).toBe(1);
    expect(r.evm).toMatchObject({ basis: 'WORK_PACKAGE_BUDGET', bac: 2000, pv: 2000, ev: 1500, ac: 1000, spi: 0.75, cpi: 1.5 });
    expect(r.evm.eac).toBeCloseTo(1000000 / 1.5, 0);
    expect(r.triangle.schedule.health).toBe('RED');
    expect(r.triangle.schedule.reasons.join()).toContain('SPI 0.75');
    expect(r.triangle.cost.health).toBe('GREEN');
    expect(r.triangle.quality.health).toBe('AMBER'); // 设计已完成待验证
  });

  it('计划变化与基准对比：工期延长后给出延误天数；企业可调整预警阈值', async () => {
    const { t, p, w1 } = await setup('pf2');
    await http().post(`/projects/${p.id}/baseline`).set(bearer(t.pm.token)).expect(200);
    await http().patch(`/projects/${p.id}/wbs/${w1}`).set(bearer(t.pm.token)).send({ durationDays: 15 }).expect(200);
    const r = (await http().get(`/projects/${p.id}/performance`).set(bearer(t.pm.token)).expect(200)).body;
    expect(r.schedule).toMatchObject({ baselineEnd: '2026-01-15', projectedEnd: '2026-01-20', slipDays: 5 });
    expect(r.schedule.slips[0]).toMatchObject({ code: '1', slipDays: 5, critical: true });

    await http().patch('/tenant-settings').set(bearer(t.pm.token)).send({ evmAmber: 0.9 }).expect(403);
    await http().patch('/tenant-settings').set(bearer(t.admin.token)).send({ evmAmber: 0.8, evmRed: 0.85 }).expect(400);
    const s = await http().patch('/tenant-settings').set(bearer(t.admin.token)).send({ evmAmber: 0.9, evmRed: 0.8 }).expect(200);
    expect(s.body).toEqual({ evmAmber: 0.9, evmRed: 0.8 });
    const r2 = (await http().get(`/projects/${p.id}/performance`).set(bearer(t.pm.token)).expect(200)).body;
    expect(r2.thresholds).toEqual({ amber: 0.9, red: 0.8 });
  });

  it('项目评审自动带出对比数据；仪表盘给出三方面红黄绿；关口评审按 WBS 层级汇总', async () => {
    const { t, p, w1 } = await setup('pf3');
    await http().post(`/projects/${p.id}/baseline`).set(bearer(t.pm.token)).expect(200);
    await http().patch(`/projects/${p.id}/wbs/${w1}`).set(bearer(t.pm.token)).send({ percentComplete: 100 }).expect(200);
    const rv = await http().post(`/projects/${p.id}/reviews`).set(bearer(t.pm.token)).send({ reviewDate: '2026-02-01', attendees: [t.pm.id] }).expect(201);
    expect(rv.body.performance.evm).toMatchObject({ pv: 2000, ev: 1000, spi: 0.5 });
    expect(rv.body.performance.triangle.schedule.health).toBe('RED');

    const d = (await http().get('/dashboard').set(bearer(t.pm.token)).expect(200)).body;
    const row = d.projects.find((x: { id: string }) => x.id === p.id);
    expect(row).toMatchObject({ spi: 0.5, triangle: { schedule: 'RED' }, health: 'RED' });

    // 两级 WBS：层级 1 汇总到顶层工作包
    const parent = await http().post(`/projects/${p.id}/wbs`).set(bearer(t.pm.token)).send({ code: '3', name: '制造', durationDays: 1, changeRequestId: undefined });
    expect(parent.status).toBe(409); // 批准后新增须引用变更
    const ready = (await http().get(`/projects/${p.id}/phases/${p.phases[0].id}/readiness`).set(bearer(t.pm.token)).expect(200)).body;
    expect(ready.wbsLevel).toBe(1);
    expect(ready.wbsGroups.map((g: { code: string; leaves: number; done: number }) => [g.code, g.leaves, g.done])).toEqual([['1', 1, 1], ['2', 1, 0]]);
    await http().patch(`/projects/${p.id}`).set(bearer(t.pm.token)).send({ gateReviewWbsLevel: 2 }).expect(200);
  });
});
