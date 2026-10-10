import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { withBypass } from '../src/prisma/tenant-context.js';
import { createApp, signupTenant } from './helpers.js';

describe('审计日志只增不改（R8）', () => {
  let app: INestApplication;
  beforeAll(async () => {
    app = await createApp();
  });
  afterAll(() => app.close());

  it('数据库层拒绝修改、删除、清空审计记录', async () => {
    await signupTenant(app, 'append');
    const prisma = app.get(PrismaService);
    const log = await withBypass(() => prisma.auditLog.findFirstOrThrow());

    await expect(
      withBypass(() => prisma.auditLog.update({ where: { id: log.id }, data: { action: 'x' } })),
    ).rejects.toThrow(/append-only/);
    await expect(
      withBypass(() => prisma.auditLog.delete({ where: { id: log.id } })),
    ).rejects.toThrow(/append-only/);
    await expect(prisma.$executeRawUnsafe('TRUNCATE audit_logs')).rejects.toThrow(
      /append-only/,
    );
  });
});
