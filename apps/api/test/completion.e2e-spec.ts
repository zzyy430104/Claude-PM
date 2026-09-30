import { INestApplication } from '@nestjs/common';
import ExcelJS from 'exceljs';
import request from 'supertest';
import { addMember, bearer, createApp, createProject, gateProject, setupTenant } from './helpers.js';

describe('补齐：日历、里程碑、资源负荷、Excel、WBS 模板、可选参与者、SWOT、偏离通报、风险增强、干系人与周报', () => {
  let app: INestApplication;
  beforeAll(async () => {
    app = await createApp();
  });
  afterAll(() => app.close());
  const http = () => request(app.getHttpServer());
  const binary = (res: request.Response, cb: (e: Error | null, b: Buffer) => void) => {
    const c: Buffer[] = []; res.on('data', (x: Buffer) => c.push(x)); res.on('end', () => cb(null, Buffer.concat(c)));
  };

  it('工作日历：企业设定节假日和调休后，日期按工作日计算；里程碑工期为 0', async () => {
    const t = await setupTenant(app, 'cal');
    await http().patch('/tenant-settings').set(bearer(t.admin.token))
      .send({ workWeek: [1, 2, 3, 4, 5], holidays: ['2026-10-01', '2026-10-02'], extraWorkdays: ['2026-10-10'] }).expect(200);
    const p = await createProject(app, t.pm.token, { startDate: '2026-09-28', endDate: '2026-12-31' });
    const a = await http().post(`/projects/${p.id}/wbs`).set(bearer(t.pm.token)).send({ code: 'A', name: '设计', durationDays: 5 }).expect(201);
    const m = await http().post(`/projects/${p.id}/wbs`).set(bearer(t.pm.token)).send({ code: 'M', name: '设计评审', durationDays: 0, isMilestone: true }).expect(201);
    await http().post(`/projects/${p.id}/wbs`).set(bearer(t.pm.token)).send({ code: 'B', name: '坏', durationDays: 0 }).expect(400);
    await http().post(`/projects/${p.id}/dependencies`).set(bearer(t.pm.token)).send({ predecessorId: a.body.id, successorId: m.body.id }).expect(201);
    const g = (await http().get(`/projects/${p.id}/wbs`).set(bearer(t.pm.token)).expect(200)).body;
    const by = Object.fromEntries(g.items.map((i: { code: string }) => [i.code, i]));
    // 9-28、29、30，10-1/2 放假，10-5、10-6 → 第 5 个工作日是 10-06
    expect(by.A).toMatchObject({ scheduledStart: '2026-09-28', scheduledEnd: '2026-10-06' });
    expect(by.M).toMatchObject({ isMilestone: true, durationDays: 0, scheduledStart: '2026-10-07', scheduledEnd: '2026-10-07' });
    const s = (await http().get('/tenant-settings').set(bearer(t.member.token)).expect(200)).body;
    expect(s).toMatchObject({ workWeek: [1, 2, 3, 4, 5], holidays: ['2026-10-01', '2026-10-02'], extraWorkdays: ['2026-10-10'] });
    await http().patch('/tenant-settings').set(bearer(t.admin.token)).send({ workWeek: [] }).expect(400);
  });

  it('资源负荷：按人按周汇总人天，超过可用工作日标为超负荷；普通成员无权查看', async () => {
    const t = await setupTenant(app, 'res');
    const p = await gateProject(app, t, { baseline: false });
    // 两个并行工作包都给同一个人，各 5 个工作日、全职 → 该周 10 人天，超过 5
    const monday = '2026-11-02';
    await http().patch(`/projects/${p.id}`).set(bearer(t.pm.token)).send({ startDate: monday }).expect(200);
    for (const code of ['X', 'Y']) {
      await http().post(`/projects/${p.id}/wbs`).set(bearer(t.pm.token)).send({ code, name: code, durationDays: 5, ownerId: t.member.id }).expect(201);
    }
    await http().post(`/projects/${p.id}/wbs`).set(bearer(t.pm.token)).send({ code: 'Z', name: 'Z', durationDays: 5, ownerId: t.pqm.id, resourceDays: 2.5 }).expect(201);
    const r = (await http().get(`/resource-load?from=${monday}&weeks=2`).set(bearer(t.pm.token)).expect(200)).body;
    expect(r.weeks).toEqual([{ start: '2026-11-02', capacity: 5 }, { start: '2026-11-09', capacity: 5 }]);
    const member = r.people.find((x: { userId: string }) => x.userId === t.member.id);
    const pqm = r.people.find((x: { userId: string }) => x.userId === t.pqm.id);
    expect(member).toMatchObject({ load: [10, 0], overloadedWeeks: 1 });
    expect(pqm).toMatchObject({ load: [2.5, 0], overloadedWeeks: 0 });
    await http().get('/resource-load').set(bearer(t.member.token)).expect(403);
  });

  it('Excel：导出进度表；导入新增和更新工作包及依赖；有错误时整表不写入', async () => {
    const t = await setupTenant(app, 'xl');
    const p = await gateProject(app, t, { baseline: false });
    await http().post(`/projects/${p.id}/wbs`).set(bearer(t.pm.token)).send({ code: '1', name: '旧名称', durationDays: 3 }).expect(201);

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('WBS');
    ws.addRow(['编号', '名称', '上级编号', '里程碑', '工期（工作日）', '负责人', '所属阶段', '前置工作包', '预算']);
    ws.addRow(['1', '设计', '', '', '', '', '', '', '']);
    ws.addRow(['1.1', '方案设计', '1', '', 10, 'member', p.phases[0].name, '', 5000]);
    ws.addRow(['1.2', '详细设计', '1', '', 15, '', '', '1.1', '']);
    ws.addRow(['M1', '设计评审', '', '是', '', '', '', '1.2', '']);
    const good = Buffer.from(await wb.xlsx.writeBuffer());
    const imp = await http().post(`/projects/${p.id}/wbs/import`).set(bearer(t.pm.token)).attach('file', good, 'wbs.xlsx').expect(200);
    expect(imp.body).toEqual({ created: 3, updated: 1, dependencies: 2 });
    const g = (await http().get(`/projects/${p.id}/wbs`).set(bearer(t.pm.token)).expect(200)).body;
    const by = Object.fromEntries(g.items.map((i: { code: string }) => [i.code, i]));
    expect(by['1'].name).toBe('设计');
    expect(by['1.1']).toMatchObject({ ownerId: t.member.id, phaseId: p.phases[0].id, budget: '5000' });
    expect(by.M1.isMilestone).toBe(true);
    expect(g.dependencies).toHaveLength(2);

    const bad = new ExcelJS.Workbook();
    const b = bad.addWorksheet('WBS');
    b.addRow(['编号', '名称', '上级编号', '工期（工作日）', '负责人', '前置工作包']);
    b.addRow(['2', '制造', '', 5, '不存在的人', '']);
    b.addRow(['3', '交付', '9', 5, '', '2']);
    b.addRow(['2', '重复', '', 1, '', '']);
    const r = await http().post(`/projects/${p.id}/wbs/import`).set(bearer(t.pm.token)).attach('file', Buffer.from(await bad.xlsx.writeBuffer()), 'bad.xlsx').expect(400);
    expect(r.body.code).toBe('EXCEL_INVALID');
    const msg = r.body.errors.join('\n');
    expect(msg).toContain('负责人“不存在的人”不是本项目的成员');
    expect(msg).toContain('上级编号“9”不存在');
    expect(msg).toContain('编号“2”与第 2 行重复');
    const after = (await http().get(`/projects/${p.id}/wbs`).set(bearer(t.pm.token)).expect(200)).body;
    expect(after.items).toHaveLength(4);
    await http().post(`/projects/${p.id}/wbs/import`).set(bearer(t.member.token)).attach('file', good, 'wbs.xlsx').expect(403);

    const exp = await http().get(`/projects/${p.id}/wbs/export`).set(bearer(t.member.token)).buffer(true).parse(binary).expect(200);
    expect(exp.headers['content-type']).toContain('spreadsheetml');
    const read = new ExcelJS.Workbook();
    await read.xlsx.load(exp.body as never);
    const rows: string[][] = [];
    read.getWorksheet('WBS')!.eachRow((row) => rows.push((row.values as unknown[]).slice(1).map((v) => String(v ?? ''))));
    expect(rows[0].slice(0, 5)).toEqual(['编号', '名称', '上级编号', '里程碑', '工期（工作日）']);
    expect(rows.map((x) => x[0])).toEqual(['编号', '1', '1.1', '1.2', 'M1']);
    const tpl = await http().get(`/projects/${p.id}/wbs/export?template=1`).set(bearer(t.pm.token)).buffer(true).parse(binary).expect(200);
    expect(tpl.headers['content-disposition']).toContain('wbs-import-template.xlsx');
  });

  it('Excel 导入：计划批准后新增须引用已批准的范围变更', async () => {
    const t = await setupTenant(app, 'xl2');
    const p = await gateProject(app, t);
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('WBS');
    ws.addRow(['编号', '名称', '工期（工作日）']);
    ws.addRow(['9', '新增', 3]);
    const r = await http().post(`/projects/${p.id}/wbs/import`).set(bearer(t.pm.token)).attach('file', Buffer.from(await wb.xlsx.writeBuffer()), 'x.xlsx').expect(400);
    expect(r.body.errors.join()).toContain('需要引用一项已批准的范围变更');
  });

  it('WBS 模板：另存为模板、应用到新项目，编号冲突时拒绝', async () => {
    const t = await setupTenant(app, 'wt');
    const a = await gateProject(app, t, { baseline: false });
    const w1 = await http().post(`/projects/${a.id}/wbs`).set(bearer(t.pm.token)).send({ code: '1', name: '设计', durationDays: 1 }).expect(201);
    await http().post(`/projects/${a.id}/wbs`).set(bearer(t.pm.token)).send({ code: '1.1', name: '方案', durationDays: 5, parentId: w1.body.id }).expect(201);
    await http().post(`/projects/${a.id}/wbs`).set(bearer(t.pm.token)).send({ code: 'M', name: '评审', durationDays: 0, isMilestone: true }).expect(201);
    const tpl = await http().post(`/projects/${a.id}/wbs/save-as-template`).set(bearer(t.pm.token)).send({ name: '转向架标准 WBS' }).expect(201);
    expect(tpl.body.items).toHaveLength(3);
    await http().post(`/projects/${a.id}/wbs/save-as-template`).set(bearer(t.pm.token)).send({ name: '转向架标准 WBS' }).expect(409);

    const b = await gateProject(app, t, { baseline: false });
    const applied = await http().post(`/projects/${b.id}/wbs/apply-template`).set(bearer(t.pm.token)).send({ templateId: tpl.body.id }).expect(200);
    expect(applied.body.created).toBe(3);
    const g = (await http().get(`/projects/${b.id}/wbs`).set(bearer(t.pm.token)).expect(200)).body;
    const child = g.items.find((i: { code: string }) => i.code === '1.1');
    const parent = g.items.find((i: { code: string }) => i.code === '1');
    expect(child.parentId).toBe(parent.id);
    const clash = await http().post(`/projects/${b.id}/wbs/apply-template`).set(bearer(t.pm.token)).send({ templateId: tpl.body.id }).expect(409);
    expect(clash.body.codes).toContain('1');
    const list = (await http().get('/wbs-templates').set(bearer(t.member.token)).expect(200)).body;
    expect(list.map((x: { name: string }) => x.name)).toContain('转向架标准 WBS');
    await http().delete(`/wbs-templates/${tpl.body.id}`).set(bearer(t.pm.token)).expect(403);
    await http().delete(`/wbs-templates/${tpl.body.id}`).set(bearer(t.admin.token)).expect(204);
  });

  it('阶段可选参与者；SWOT；偏离通报；风险增强字段；干系人；周报', async () => {
    const t = await setupTenant(app, 'eng');
    const tpl = await http().post('/phase-templates').set(bearer(t.admin.token)).send({
      name: 'opt', phases: [{ name: '设计', checklist: [], mandatoryRoles: ['PROJECT_MANAGER'], optionalRoles: ['FUNCTION_MANAGER'] }],
    }).expect(201);
    const p = await createProject(app, t.pm.token, { templateId: tpl.body.id });
    await addMember(app, t.pm.token, p.id, t.member.id, 'MEMBER');
    const ph = (await http().get(`/projects/${p.id}/phases`).set(bearer(t.pm.token)).expect(200)).body;
    expect(ph[0].optionalRoles).toEqual(['FUNCTION_MANAGER']);

    await http().post(`/projects/${p.id}/swot`).set(bearer(t.pm.token)).send({ reviewDate: '2026-03-01', participants: '客户技术部、某铸造厂', strengths: '经验丰富', threats: '原材料涨价' }).expect(201);
    expect((await http().get(`/projects/${p.id}/swot`).set(bearer(t.pm.token)).expect(200)).body[0].threats).toBe('原材料涨价');

    await http().post(`/projects/${p.id}/deviations`).set(bearer(t.member.token)).send({ dimension: 'SCHEDULE', noticeDate: '2026-03-02', audience: '客户', impact: '交期延后 1 周', countermeasures: '加班' }).expect(403);
    await http().post(`/projects/${p.id}/deviations`).set(bearer(t.pm.token)).send({ dimension: 'SCHEDULE', noticeDate: '2026-03-02', audience: '客户项目经理', impact: '交期延后 1 周', countermeasures: '增加班次' }).expect(201);

    const risk = await http().post(`/projects/${p.id}/risks`).set(bearer(t.pm.token)).send({
      kind: 'OPPORTUNITY', title: '国产化替代', probability: 3, impact: 3, exposureAmount: 50000, responseCost: 5000,
      costBenefitAnalysis: '收益大于成本', maturityLevel: 'TRL 7', functionalReviewers: '采购部张经理、技术部王经理', budgetRecovery: 30000,
    }).expect(201);
    expect(risk.body).toMatchObject({ maturityLevel: 'TRL 7', functionalReviewers: '采购部张经理、技术部王经理', budgetRecovery: '30000' });

    const s = await http().post(`/projects/${p.id}/stakeholders`).set(bearer(t.pm.token)).send({ name: '客户项目经理', organization: '某地铁公司', influence: 'HIGH', interest: 'HIGH' }).expect(201);
    await http().patch(`/projects/${p.id}/stakeholders/${s.body.id}`).set(bearer(t.pm.token)).send({ communication: '每周例会' }).expect(200);
    await http().post(`/projects/${p.id}/stakeholders`).set(bearer(t.pm.token)).send({ name: 'x', influence: 'HUGE' }).expect(400);

    const rep = (await http().get(`/projects/${p.id}/weekly-report`).set(bearer(t.member.token)).expect(200)).body;
    expect(rep.project.code).toBe(p.code);
    expect(rep.performance.triangle.schedule.health).toBeDefined();
    expect(rep.deviations).toHaveLength(0); // 通报日期在本周期之外
  });
});
