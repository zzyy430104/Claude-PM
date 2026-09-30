import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { bearer, createApp, createUser, gateProject, setupTenant } from './helpers.js';

const http = (app: INestApplication) => request(app.getHttpServer());
type T = Awaited<ReturnType<typeof setupTenant>>;

describe('文档管理', () => {
  let app: INestApplication;
  beforeAll(async () => {
    app = await createApp();
  });
  afterAll(() => app.close());

  const upload = (t: T, pid: string, token: string, file: { content: string; name: string }, fields: Record<string, string>) => {
    let r = http(app).post(`/projects/${pid}/documents`).set(bearer(token));
    for (const [k, v] of Object.entries(fields)) r = r.field(k, v);
    return r.attach('file', Buffer.from(file.content), file.name);
  };

  it('按标准目录归档，重复上传生成新版本，历史版本可下载，中文文件名不乱码', async () => {
    const t = await setupTenant(app, 'doc1');
    const p = await gateProject(app, t);
    const folders = await http(app).get(`/projects/${p.id}/documents/folders`).set(bearer(t.pm.token)).expect(200);
    expect(folders.body).toContain('06-评审记录');

    const v1 = await upload(t, p.id, t.member.token, { content: '第一版内容', name: '设计说明.txt' }, { folder: '03-设计与开发', name: '转向架设计说明', comment: '初稿' }).expect(201);
    expect(v1.body).toMatchObject({ currentVersion: 1, folder: '03-设计与开发' });
    const v2 = await upload(t, p.id, t.pm.token, { content: '第二版内容（修订）', name: '设计说明v2.txt' }, { folder: '03-设计与开发', name: '转向架设计说明', comment: '评审后修订' }).expect(201);
    expect(v2.body.currentVersion).toBe(2);

    const list = await http(app).get(`/projects/${p.id}/documents`).set(bearer(t.member.token)).expect(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0].latest.fileName).toBe('设计说明v2.txt');

    const versions = await http(app).get(`/projects/${p.id}/documents/${v1.body.id}/versions`).set(bearer(t.member.token)).expect(200);
    expect(versions.body.map((v: { version: number }) => v.version)).toEqual([2, 1]);
    expect(versions.body[1].sha256).toHaveLength(64);

    const cur = await http(app).get(`/projects/${p.id}/documents/${v1.body.id}/download`).set(bearer(t.member.token)).expect(200);
    expect(cur.text).toBe('第二版内容（修订）');
    expect(cur.headers['content-disposition']).toContain(encodeURIComponent('设计说明v2.txt'));
    expect(cur.headers['x-content-type-options']).toBe('nosniff');
    const old = await http(app).get(`/projects/${p.id}/documents/${v1.body.id}/download?version=1`).set(bearer(t.member.token)).expect(200);
    expect(old.text).toBe('第一版内容');
    await http(app).get(`/projects/${p.id}/documents/${v1.body.id}/download?version=9`).set(bearer(t.member.token)).expect(404);

    const logs = await http(app).get(`/audit-logs?entity=Document&entityId=${v1.body.id}`).set(bearer(t.admin.token)).expect(200);
    expect(logs.body.map((l: { action: string }) => l.action).sort()).toEqual(['document.create', 'document.newVersion']);
  });

  it('访问控制：非成员看不到也传不了；不合法目录、可执行文件、空文件被拒绝', async () => {
    const t = await setupTenant(app, 'doc2');
    const other = await setupTenant(app, 'doc2b');
    const p = await gateProject(app, t);
    const ok = { content: 'x', name: 'a.txt' };
    await upload(t, p.id, t.outsider.token, ok, { folder: '99-其他' }).expect(404);
    await upload(t, p.id, t.member.token, ok, { folder: '不存在的目录' }).expect(400);
    await upload(t, p.id, t.member.token, { content: 'MZ', name: 'setup.exe' }, { folder: '99-其他' }).expect(400);
    await upload(t, p.id, t.member.token, { content: '', name: 'empty.txt' }, { folder: '99-其他' }).expect(400);
    await http(app).post(`/projects/${p.id}/documents`).set(bearer(t.member.token)).field('folder', '99-其他').expect(400); // 没有文件

    const d = await upload(t, p.id, t.member.token, ok, { folder: '99-其他' }).expect(201);
    await http(app).get(`/projects/${p.id}/documents/${d.body.id}/download`).set(bearer(t.outsider.token)).expect(404);
    await http(app).get(`/projects/${p.id}/documents/${d.body.id}/download`).set(bearer(other.admin.token)).expect(404);
    await http(app).get(`/projects/${p.id}/documents`).set(bearer(other.pm.token)).expect(404);
    // 文件名中的路径被去掉，不会写到存储目录之外
    const evil = await upload(t, p.id, t.member.token, { content: 'x', name: '../../etc/passwd.txt' }, { folder: '99-其他', name: '' }).expect(201);
    expect(evil.body.name).toBe('passwd.txt');
  });
});

describe('经验教训与项目关闭', () => {
  let app: INestApplication;
  beforeAll(async () => {
    app = await createApp();
  });
  afterAll(() => app.close());

  async function runAllGates(t: T, p: { id: string; phases: { id: string }[] }) {
    for (const [i, ph] of p.phases.entries()) {
      const g = (await http(app).post(`/projects/${p.id}/phases/${ph.id}/gate-reviews`).set(bearer(t.pm.token)).expect(201)).body;
      await http(app).patch(`/projects/${p.id}/gate-reviews/${g.id}`).set(bearer(t.pm.token)).send({
        attendees: [t.pm.id, t.pqm.id], checklistResults: g.checklistResults.map((c: { item: string }) => ({ item: c.item, passed: true })),
      }).expect(200);
      await http(app).post(`/projects/${p.id}/gate-reviews/${g.id}/decision`).set(bearer(t.pm.token)).send({ decision: 'APPROVED', note: `第 ${i + 1} 阶段通过` }).expect(200);
    }
  }

  it('关闭项目需要：阶段全部关闭、无未关闭问题和不符合项、已登记经验教训', async () => {
    const t = await setupTenant(app, 'close1');
    const p = await gateProject(app, t);
    const blocked = await http(app).post(`/projects/${p.id}/close`).set(bearer(t.pm.token)).send({}).expect(409);
    expect(blocked.body.code).toBe('PROJECT_CLOSE_BLOCKED');
    expect(blocked.body.blockers[0]).toContain('3 个阶段未关闭');

    const issue = (await http(app).post(`/projects/${p.id}/issues`).set(bearer(t.pm.token)).send({ title: '遗留问题' }).expect(201)).body;
    await runAllGates(t, p);
    const still = await http(app).post(`/projects/${p.id}/close`).set(bearer(t.pm.token)).send({}).expect(409);
    expect(still.body.blockers.join()).toContain('未关闭的问题');
    expect(still.body.blockers.join()).toContain('尚未登记经验教训');

    await http(app).patch(`/projects/${p.id}/issues/${issue.id}`).set(bearer(t.pm.token)).send({ status: 'CLOSED', closureNote: '已处理' }).expect(200);
    await http(app).post(`/projects/${p.id}/lessons`).set(bearer(t.member.token)).send({
      kind: 'LESSON', title: '外协件到货检验要前置', description: '首批到货后才发现尺寸超差', recommendation: '合同中约定发货前见证检验',
    }).expect(201);
    await http(app).post(`/projects/${p.id}/close`).set(bearer(t.member.token)).send({}).expect(403);
    const closed = await http(app).post(`/projects/${p.id}/close`).set(bearer(t.pm.token)).send({}).expect(200);
    expect(closed.body.status).toBe('CLOSED');

    // 关闭后不能再改动项目
    await http(app).patch(`/projects/${p.id}`).set(bearer(t.pm.token)).send({ name: '改名' }).expect(403);
    await http(app).post(`/projects/${p.id}/issues`).set(bearer(t.pm.token)).send({ title: '关闭后新增' }).expect(403);
    await http(app).post(`/projects/${p.id}/close`).set(bearer(t.pm.token)).send({}).expect(409);
  });

  it('没有经验教训时必须说明原因；企业知识库可跨项目检索且不跨企业', async () => {
    const t = await setupTenant(app, 'close2');
    const other = await setupTenant(app, 'close2b');
    const p = await gateProject(app, t);
    await runAllGates(t, p);
    await http(app).post(`/projects/${p.id}/close`).set(bearer(t.pm.token)).send({ noLessonsReason: '短' }).expect(400);
    await http(app).post(`/projects/${p.id}/close`).set(bearer(t.pm.token)).send({ noLessonsReason: '标准重复订单，无新增经验' }).expect(200);

    const p2 = await gateProject(app, t);
    await http(app).post(`/projects/${p2.id}/lessons`).set(bearer(t.pm.token)).send({ kind: 'GOOD_PRACTICE', title: '焊接工艺评定提前完成', description: 'd', recommendation: 'r' }).expect(201);
    const own = await http(app).get('/lessons?q=焊接').set(bearer(t.outsider.token)).expect(200); // 非项目成员也能查企业知识库
    expect(own.body).toHaveLength(1);
    expect(own.body[0].project.code).toBe(p2.code);
    const foreign = await http(app).get('/lessons?q=焊接').set(bearer(other.admin.token)).expect(200);
    expect(foreign.body).toHaveLength(0);
    await http(app).post(`/projects/${p2.id}/lessons`).set(bearer(t.outsider.token)).send({ kind: 'LESSON', title: 'xx', description: 'd', recommendation: 'r' }).expect(404);
  });
});

describe('配置管理', () => {
  let app: INestApplication;
  beforeAll(async () => {
    app = await createApp();
  });
  afterAll(() => app.close());
  const item = (t: T, pid: string, body: Record<string, unknown>, token = t.pm.token) =>
    http(app).post(`/projects/${pid}/config/items`).set(bearer(token)).send({ kind: 'HARDWARE', ...body });

  it('PBS 必须分解到最低可更换单元才能建立基线；基线是只读快照', async () => {
    const t = await setupTenant(app, 'cfg1');
    const p = await gateProject(app, t);
    await http(app).post(`/projects/${p.id}/config/baselines`).set(bearer(t.pm.token)).send({ type: 'AS_DESIGNED', name: '空' }).expect(400);
    const bogie = (await item(t, p.id, { code: 'BOGIE', name: '转向架' }).expect(201)).body;
    const axle = (await item(t, p.id, { code: 'AXLE', name: '轮对', parentId: bogie.id, safetyRelated: true }).expect(201)).body;
    const inc = await http(app).post(`/projects/${p.id}/config/baselines`).set(bearer(t.pm.token)).send({ type: 'AS_DESIGNED', name: '设计基线' }).expect(409);
    expect(inc.body).toMatchObject({ code: 'PBS_INCOMPLETE', items: ['AXLE'] });

    await http(app).patch(`/projects/${p.id}/config/items/${axle.id}`).set(bearer(t.pm.token)).send({ lowestLevel: true }).expect(200);
    await item(t, p.id, { code: 'X', name: 'LLRU 的子项', parentId: axle.id }).expect(400); // LLRU 不能再分解
    await http(app).post(`/projects/${p.id}/config/baselines`).set(bearer(t.pm.token)).send({ type: 'AS_DESIGNED', name: '设计基线' }).expect(201);
    await http(app).post(`/projects/${p.id}/config/baselines`).set(bearer(t.member.token)).send({ type: 'AS_BUILT', name: '竣工基线' }).expect(403);
    const bl = await http(app).get(`/projects/${p.id}/config/baselines`).set(bearer(t.member.token)).expect(200);
    expect(bl.body[0]).toMatchObject({ name: '设计基线', itemCount: 2 });
  });

  it('基线后改版本、改安全属性必须引用已批准的变更；状态记录显示与基线的差异', async () => {
    const t = await setupTenant(app, 'cfg2');
    const p = await gateProject(app, t);
    const a = (await item(t, p.id, { code: 'AXLE', name: '轮对', safetyRelated: true, lowestLevel: true, serialNumber: 'SN-001', batchNumber: 'B-2026-01' }).expect(201)).body;
    // 基线前可以自由修改
    await http(app).patch(`/projects/${p.id}/config/items/${a.id}`).set(bearer(t.pm.token)).send({ revision: 'B' }).expect(200);
    await http(app).post(`/projects/${p.id}/config/baselines`).set(bearer(t.pm.token)).send({ type: 'AS_DESIGNED', name: '设计基线' }).expect(201);

    const patch = (body: Record<string, unknown>) => http(app).patch(`/projects/${p.id}/config/items/${a.id}`).set(bearer(t.pm.token)).send(body);
    const noCr = await patch({ revision: 'C' }).expect(409);
    expect(noCr.body.code).toBe('CHANGE_REQUEST_REQUIRED');
    await patch({ safetyRelated: false }).expect(409);
    await patch({ name: '轮对（改名）' }).expect(200); // 非受控字段可改

    // 未批准的变更不行；批准后可以
    const cr = (await http(app).post(`/projects/${p.id}/changes`).set(bearer(t.member.token)).send({
      type: 'TECHNICAL', title: '轮对改版', description: 'd', reason: 'r', impactAnalysis: 'i',
      technicalImpact: { deliveredParts: '无', customerSpec: '无', documents: '更新图纸', requirements: '不变', revalidation: '型式试验' },
    }).expect(201)).body;
    await patch({ revision: 'C', changeRequestId: cr.id }).expect(409);
    await http(app).post(`/projects/${p.id}/changes/${cr.id}/submit`).set(bearer(t.member.token)).expect(200);
    await http(app).post(`/projects/${p.id}/changes/${cr.id}/approve`).set(bearer(t.pm.token)).send({}).expect(200);
    await patch({ revision: 'C', changeRequestId: cr.id }).expect(200);

    const st = await http(app).get(`/projects/${p.id}/config/status`).set(bearer(t.member.token)).expect(200);
    expect(st.body.changed).toEqual([{ code: 'AXLE', from: 'B', to: 'C' }]);
    expect(st.body.safetyRelatedItems).toBe(1);
    const logs = await http(app).get(`/audit-logs?entity=ConfigItem&entityId=${a.id}`).set(bearer(t.admin.token)).expect(200);
    expect(JSON.stringify(logs.body)).toContain(cr.id); // 审计记录了依据的变更申请
  });

  it('非项目成员不能访问配置；编号唯一', async () => {
    const t = await setupTenant(app, 'cfg3');
    const p = await gateProject(app, t);
    await http(app).get(`/projects/${p.id}/config/items`).set(bearer(t.outsider.token)).expect(404);
    await item(t, p.id, { code: 'A', name: 'A' }).expect(201);
    await item(t, p.id, { code: 'A', name: '重复' }).expect(409);
    await item(t, p.id, { code: 'B', name: 'B' }, t.member.token).expect(403);
  });
});

describe('投标管理', () => {
  let app: INestApplication;
  beforeAll(async () => {
    app = await createApp();
  });
  afterAll(() => app.close());

  const full = {
    requirements: '客户要求 200km/h 动车组转向架，含 5 年质保',
    riskAssessment: '原材料涨价风险；外协交期风险', riskExposure: 500000,
    knowledgeInputs: '参考项目 HSR-001 经验教训：外协件检验前置',
    deliverablesPlan: '设计文件、样机 2 台、型式试验报告；成本见测算表', estimatedCost: 8000000,
    resourcePlan: '设计 6 人、工艺 3 人、质量 2 人', offerPrice: 9500000,
  };

  it('投标完整流程：内容齐全才能提交，最高管理层审批，中标后转为项目并带出预算', async () => {
    const t = await setupTenant(app, 'td1');
    const tender = (await http(app).post('/tenders').set(bearer(t.pm.token)).send({ code: 'T-2026-01', title: '动车组转向架投标', customer: '某某集团' }).expect(201)).body;

    const inc = await http(app).post(`/tenders/${tender.id}/submit`).set(bearer(t.pm.token)).expect(400);
    expect(inc.body.problems).toHaveLength(6);
    await http(app).patch(`/tenders/${tender.id}`).set(bearer(t.pm.token)).send(full).expect(200);
    await http(app).post(`/tenders/${tender.id}/submit`).set(bearer(t.pm.token)).expect(200);
    await http(app).patch(`/tenders/${tender.id}`).set(bearer(t.pm.token)).send({ offerPrice: 1 }).expect(409); // 提交后锁定

    await http(app).post(`/tenders/${tender.id}/approve`).set(bearer(t.pm.token)).send({ note: '自批' }).expect(403);
    await http(app).post(`/tenders/${tender.id}/approve`).set(bearer(t.admin.token)).send({ note: '管理员' }).expect(403);
    await http(app).post(`/tenders/${tender.id}/won`).set(bearer(t.pm.token)).expect(409); // 未批准不能标记中标
    await http(app).post(`/tenders/${tender.id}/approve`).set(bearer(t.top.token)).send({ note: '同意报价 950 万' }).expect(200);

    await http(app).post(`/tenders/${tender.id}/convert`).set(bearer(t.pm.token)).send({ code: 'HSR-100', riskLevel: 'HIGH', startDate: '2026-06-01', endDate: '2027-06-01' }).expect(409); // 未中标
    await http(app).post(`/tenders/${tender.id}/won`).set(bearer(t.pm.token)).expect(200);
    const proj = (await http(app).post(`/tenders/${tender.id}/convert`).set(bearer(t.pm.token)).send({ code: 'HSR-100', riskLevel: 'HIGH', startDate: '2026-06-01', endDate: '2027-06-01' }).expect(201)).body;
    expect(proj).toMatchObject({ name: '动车组转向架投标', budget: '8000000', reviewIntervalDays: 14, tenderId: tender.id });
    await http(app).post(`/tenders/${tender.id}/convert`).set(bearer(t.pm.token)).send({ code: 'HSR-101', riskLevel: 'HIGH', startDate: '2026-06-01', endDate: '2027-06-01' }).expect(409); // 只能转一次
    const phases = await http(app).get(`/projects/${proj.id}/phases`).set(bearer(t.pm.token)).expect(200);
    expect(phases.body).toHaveLength(7);
    const logs = await http(app).get(`/audit-logs?entity=Tender&entityId=${tender.id}`).set(bearer(t.admin.token)).expect(200);
    expect(logs.body.map((l: { action: string }) => l.action)).toEqual(expect.arrayContaining(['tender.submit', 'tender.approve', 'tender.won', 'tender.convert']));
  });

  it('驳回后不能再中标；权限与租户隔离', async () => {
    const t = await setupTenant(app, 'td2');
    const other = await setupTenant(app, 'td2b');
    const tender = (await http(app).post('/tenders').set(bearer(t.pm.token)).send({ code: 'T-1', title: '投标一号', customer: 'c' }).expect(201)).body;
    await http(app).patch(`/tenders/${tender.id}`).set(bearer(t.pm.token)).send(full).expect(200);
    await http(app).post(`/tenders/${tender.id}/submit`).set(bearer(t.pm.token)).expect(200);
    await http(app).post(`/tenders/${tender.id}/reject`).set(bearer(t.top.token)).send({}).expect(400);
    await http(app).post(`/tenders/${tender.id}/reject`).set(bearer(t.top.token)).send({ note: '毛利过低' }).expect(200);
    await http(app).post(`/tenders/${tender.id}/won`).set(bearer(t.pm.token)).expect(409);

    await http(app).get('/tenders').set(bearer(t.member.token)).expect(403);
    await http(app).post('/tenders').set(bearer(t.member.token)).send({ code: 'T-2', title: '未授权', customer: 'c' }).expect(403);
    await http(app).get(`/tenders/${tender.id}`).set(bearer(other.admin.token)).expect(404);
    await http(app).post('/tenders').set(bearer(t.pm.token)).send({ code: 'T-1', title: '重复编号', customer: 'c' }).expect(409);
    const fm = await createUser(app, t.admin, 'FUNCTION_MANAGER');
    await http(app).get('/tenders').set(bearer(fm.token)).expect(200); // 职能经理可查看
    await http(app).post('/tenders').set(bearer(fm.token)).send({ code: 'T-3', title: '职能经理不可建', customer: 'c' }).expect(403);
  });
});
