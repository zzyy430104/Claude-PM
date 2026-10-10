import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  // 迁移可以用有建表权限的账号（MIGRATION_DATABASE_URL），运行时用受行级安全约束的普通账号（DATABASE_URL）
  datasource: { url: process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL },
});
