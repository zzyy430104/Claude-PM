import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { withBypass, withTenant } from '../src/prisma/tenant-context.js';
import { bearer, createApp, createProject, gateProject, setupTenant } from './helpers.js';

/**
 * 数据库层的行级安全：即使业务代码漏掉了租户过滤，数据库也不会把别的租户的行交出来。
 * 这里的查询故意不带任何 tenantId 条件。
 */
describe('行级安全（第二道租户隔离）', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  beforeAll(async () => {
    app = await createApp();
    prisma = app.get(PrismaService);
  });
  afterAll(() => app.close());

  async function twoTenants() {
    const a = await setupTenant(app, 'rls-a');
    const b = await setupTenant(app, 'rls-b');
    const pa = await createProject(app, a.pm.token);
    const pb = await createProject(app, b.pm.token);
    const tenantOf = async (projectId: string) =>
      (await withBypass(() => prisma.project.findUniqueOrThrow({ where: { id: projectId } }))).tenantId;
    return { pa, pb, ta: await tenantOf(pa.id), tb: await tenantOf(pb.id) };
  }

  it('查询不带租户条件，也只能看到本租户的行；没有上下文一行都看不到', async () => {
    const { pa, pb, ta, tb } = await twoTenants();
    const ids = (rows: { id: string }[]) => rows.map((r) => r.id);

    const asA = ids(await withTenant(ta, () => prisma.project.findMany()));
    expect(asA).toContain(pa.id);
    expect(asA).not.toContain(pb.id);
    const asB = ids(await withTenant(tb, () => prisma.project.findMany()));
    expect(asB).toContain(pb.id);
    expect(asB).not.toContain(pa.id);

    expect(await prisma.project.findMany()).toEqual([]); // 没有上下文：默认拒绝
    const all = ids(await withBypass(() => prisma.project.findMany()));
    expect(all).toEqual(expect.arrayContaining([pa.id, pb.id])); // 平台级操作可以跨租户
  });

  it('按 ID 精确查询、修改、删除别的租户的行，都像不存在一样', async () => {
    const { pb, ta, tb } = await twoTenants();
    expect(await withTenant(ta, () => prisma.project.findUnique({ where: { id: pb.id } }))).toBeNull();
    await expect(withTenant(ta, () => prisma.project.update({ where: { id: pb.id }, data: { name: '篡改' } }))).rejects.toThrow();
    await expect(withTenant(ta, () => prisma.project.delete({ where: { id: pb.id } }))).rejects.toThrow();
    const still = await withBypass(() => prisma.project.findUniqueOrThrow({ where: { id: pb.id } }));
    expect(still.name).toBe('测试项目');
    // 用户表同样受约束：租户 A 上下文里查不到租户 B 的用户
    expect(await withTenant(ta, () => prisma.user.findFirst({ where: { tenantId: tb } }))).toBeNull();
  });

  it('不能以本租户身份写入属于别的租户的行', async () => {
    const { ta, tb } = await twoTenants();
    await expect(
      withTenant(ta, () =>
        prisma.project.create({ data: { tenantId: tb, code: 'HIJACK', name: 'x', startDate: new Date(), endDate: new Date(), createdById: 'x' } }),
      ),
    ).rejects.toThrow();
  });

  it('事务内同样受约束，并发请求互不串租户', async () => {
    const { pa, pb, ta } = await twoTenants();
    const seen = await withTenant(ta, () => prisma.txn(async (tx) => (await tx.project.findMany()).map((p) => p.id)));
    expect(seen).toContain(pa.id);
    expect(seen).not.toContain(pb.id);
    const results = await Promise.all(
      Array.from({ length: 20 }, () => withTenant(ta, () => prisma.project.count())),
    );
    expect(new Set(results).size).toBe(1);
  });

  it('每一张带 tenant_id 的表都启用并强制了行级安全策略（新增表忘了加策略会在这里失败）', async () => {
    const rows = await prisma.$queryRaw<{ table_name: string; forced: boolean; policies: number }[]>`
      SELECT c.relname AS table_name, c.relforcerowsecurity AS forced,
             (SELECT count(*)::int FROM pg_policies p WHERE p.tablename = c.relname AND p.schemaname = 'public') AS policies
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
      WHERE c.relkind = 'r'
        AND EXISTS (SELECT 1 FROM information_schema.columns col
                    WHERE col.table_schema = 'public' AND col.table_name = c.relname AND col.column_name = 'tenant_id')`;
    expect(rows.length).toBeGreaterThan(25);
    const bad = rows.filter((r) => !r.forced || r.policies < 1).map((r) => r.table_name);
    expect(bad).toEqual([]);
  });

  it('接口层：项目经理 A 直接访问租户 B 的项目仍然是 404', async () => {
    const a = await setupTenant(app, 'rls-c');
    const b = await setupTenant(app, 'rls-d');
    const pb = await gateProject(app, b);
    await request(app.getHttpServer()).get(`/projects/${pb.id}`).set(bearer(a.pm.token)).expect(404);
    await request(app.getHttpServer()).get(`/projects/${pb.id}/risks`).set(bearer(a.admin.token)).expect(404);
  });
});
