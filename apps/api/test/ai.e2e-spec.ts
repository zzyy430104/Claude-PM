import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { bearer, createApp, createProject, addMember, setupTenant } from './helpers.js';

describe('AI 辅助', () => {
  let app: INestApplication;
  const http = () => request(app.getHttpServer());
  beforeAll(async () => { app = await createApp(); });
  afterAll(() => app.close());

  it('设置（密钥加密、只显示掩码、测试连接）；未启用时不能用；起草、采纳并记录确认人；场景开关和次数上限；文件起草；使用记录', async () => {
    const t = await setupTenant(app, 'ai1');
    const p = await createProject(app, t.pm.token);
    await addMember(app, t.pm.token, p.id, t.member.id, 'MEMBER');

    expect((await http().get('/ai/status').set(bearer(t.member.token)).expect(200)).body).toMatchObject({ enabled: false });
    expect((await http().post('/ai/draft/QUICK').set(bearer(t.member.token)).send({ projectId: p.id, input: { text: 'x' } }).expect(409)).body.code).toBe('AI_DISABLED');

    // 设置：只有企业管理员；密钥不回传
    await http().get('/ai-settings').set(bearer(t.pm.token)).expect(403);
    let s = (await http().get('/ai-settings').set(bearer(t.admin.token)).expect(200)).body;
    expect(s.config).toMatchObject({ enabled: false, baseUrl: 'https://api.deepseek.com' });
    expect(s.keyHint).toBeNull();
    await http().put('/ai-settings').set(bearer(t.admin.token)).send({ baseUrl: 'ftp://x' }).expect(400);
    // 防 SSRF：内网地址、元数据地址、不在允许清单里的域名都不能保存
    for (const baseUrl of ['http://169.254.169.254', 'http://api:3000', 'https://127.0.0.1:5432', 'https://evil.example.com', 'http://api.deepseek.com']) {
      await http().put('/ai-settings').set(bearer(t.admin.token)).send({ baseUrl }).expect(400);
    }
    await http().put('/ai-settings').set(bearer(t.admin.token)).send({ baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1/' }).expect(200);
    await http().put('/ai-settings').set(bearer(t.admin.token)).send({ baseUrl: 'https://api.deepseek.com' }).expect(200);
    // 输入检查：类型不对、未知场景、未知字段都拒绝
    for (const body of [{ enabled: 'yes' }, { scenarios: { REPORT: 'no' } }, { scenarios: { NOPE: true } }, { perUserDaily: 1.5 }, { perUserDaily: 0 }, { model: '' }, { model: null }, { foo: 1 }, { apiKey: 123 }]) {
      await http().put('/ai-settings').set(bearer(t.admin.token)).send(body).expect(400);
    }
    s = (await http().put('/ai-settings').set(bearer(t.admin.token)).send({ enabled: true, apiKey: 'sk-test-0000000000abcd', model: 'deepseek-flash' }).expect(200)).body;
    expect(s.keyHint).toBe('sk-****abcd');
    expect(JSON.stringify(s)).not.toContain('sk-test-0000000000abcd');
    expect((await http().post('/ai-settings/test').set(bearer(t.admin.token)).expect(200)).body).toMatchObject({ ok: true, models: expect.arrayContaining(['deepseek-flash']) });
    expect((await http().get('/ai/status').set(bearer(t.member.token)).expect(200)).body).toMatchObject({ enabled: true, scenarios: { QUICK: true, CONTRACT: true } });

    // 一句话登记：起草 → 采纳并记下保存到的记录
    await http().post('/ai/draft/QUICK').set(bearer(t.outsider.token)).send({ projectId: p.id, input: { text: 'x' } }).expect(404);
    const d = (await http().post('/ai/draft/QUICK').set(bearer(t.member.token)).send({ projectId: p.id, input: { text: '二车间焊缝外观检验发现 3 件咬边不合格', members: ['王成员'], today: '2026-10-01' } }).expect(200)).body;
    expect(d.draft).toMatchObject({ type: 'NONCONFORMITY', severity: 'MAJOR', source: 'INSPECTION' });
    const nc = (await http().post(`/projects/${p.id}/nonconformities`).set(bearer(t.member.token)).send({ title: d.draft.title, description: d.draft.description, severity: 'MAJOR', source: 'INSPECTION' })).body;
    await http().post(`/ai/usage/${d.usageId}/adopt`).set(bearer(t.pm.token)).send({ adopted: true, entityType: 'NONCONFORMITY', entityId: nc.id }).expect(403);
    await http().post(`/ai/usage/${d.usageId}/adopt`).set(bearer(t.member.token)).send({ adopted: true, entityType: 'NONCONFORMITY', entityId: nc.id }).expect(200);
    const prov = (await http().get('/ai/provenance').set(bearer(t.pm.token)).query({ entityType: 'NONCONFORMITY', ids: nc.id }).expect(200)).body;
    expect(prov[nc.id]).toMatchObject({ by: expect.any(String), scenario: 'QUICK' });

    // 其他场景
    const m = (await http().post('/ai/draft/MINUTES').set(bearer(t.pm.token)).send({ projectId: p.id, input: { notes: '讨论了 PFMEA……', attendees: ['李经理', '王成员'], date: '2026-10-08' } }).expect(200)).body;
    expect(m.draft.actions[0]).toMatchObject({ title: expect.any(String), owner: '李经理' });
    const a = (await http().post('/ai/draft/ANALYSIS').set(bearer(t.pm.token)).send({ projectId: p.id, input: { kind: 'NONCONFORMITY', record: { title: '咬边' } } }).expect(200)).body;
    expect(a.draft.rootCause).toContain('→');
    await http().post('/ai/draft/NOPE').set(bearer(t.pm.token)).send({ input: {} }).expect(404);

    // 文件起草：取出文字后起草；不支持的格式拒绝
    const f = (await http().post('/ai/draft-file/CONTRACT').set(bearer(t.pm.token)).field('input', JSON.stringify({ projectType: 'B' })).attach('files', Buffer.from('合同第 3.1 条：2027-01-15 前全部交付。'), 'contract.txt').expect(200)).body;
    expect(f.draft).toMatchObject({ deliveryDate: { value: '2027-01-15', source: '合同第 3.1 条' } });
    expect(f.draft.deliverables[0]).toMatchObject({ kind: 'PRODUCT' });
    expect((await http().post('/ai/draft-file/CONTRACT').set(bearer(t.pm.token)).attach('files', Buffer.from('x'), 'a.exe').expect(400)).body.code).toBe('AI_FILE_TYPE');

    // 场景开关、每人每天上限
    await http().put('/ai-settings').set(bearer(t.admin.token)).send({ scenarios: { REPORT: false } }).expect(200);
    expect((await http().post('/ai/draft/REPORT').set(bearer(t.pm.token)).send({ input: { kind: 'WEEKLY', data: {} } }).expect(409)).body.code).toBe('AI_SCENARIO_DISABLED');
    expect((await http().get('/ai/status').set(bearer(t.pm.token)).expect(200)).body.scenarios.REPORT).toBe(false);
    await http().put('/ai-settings').set(bearer(t.admin.token)).send({ perUserDaily: 1 }).expect(200);
    expect((await http().post('/ai/draft/QUICK').set(bearer(t.member.token)).send({ projectId: p.id, input: { text: '再来一次' } }).expect(429)).body.code).toBe('AI_LIMIT');

    // 使用记录
    await http().get('/ai/usage').set(bearer(t.member.token)).expect(403);
    const u = (await http().get('/ai/usage').set(bearer(t.admin.token)).expect(200)).body;
    expect(u.stats.find((x: { scenario: string }) => x.scenario === 'QUICK')).toMatchObject({ calls: 1, adopted: 1 });
    expect(u.rows.length).toBeGreaterThanOrEqual(4);

    // 移除密钥后不可用
    await http().put('/ai-settings').set(bearer(t.admin.token)).send({ apiKey: null }).expect(200);
    expect((await http().get('/ai/status').set(bearer(t.pm.token)).expect(200)).body.enabled).toBe(false);
  });
});
