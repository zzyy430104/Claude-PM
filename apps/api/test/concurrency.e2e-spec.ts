import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { bearer, createApp, signupTenant } from './helpers.js';

/**
 * 并发只读请求不能把数据库连接池耗尽（审查报告 H1）：
 * 以前 GET 请求占着一条连接，里面的 withBypass 又要第二条连接，并发数超过连接池大小就互相等待直到 P2028。
 */
describe('并发只读请求', () => {
  let app: INestApplication;
  beforeAll(async () => { app = await createApp(); await app.listen(0); });
  afterAll(async () => { await app.close(); });

  it('60 个并发 GET /project-permissions 全部返回 200', async () => {
    const t = await signupTenant(app, 'conc');
    const server = app.getHttpServer();
    const res = await Promise.all(Array.from({ length: 60 }, () => request(server).get('/project-permissions').set(bearer(t.token))));
    expect(res.map((r) => r.status).filter((s) => s !== 200)).toEqual([]);
    // 共享事务里临时打开的 bypass 必须关回去：普通查询仍只能看到本租户
    const other = await signupTenant(app, 'conc2');
    const mine = await request(server).get('/project-permissions').set(bearer(other.token)).expect(200);
    expect(mine.body).toBeTruthy();
  }, 120_000);
});
