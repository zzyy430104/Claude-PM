import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { Prisma, PrismaClient } from '../generated/prisma/client.js';
import { tenantContext } from './tenant-context.js';

const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/**
 * 数据库访问入口。除了普通的 Prisma 客户端，还负责把请求的租户上下文交给 PostgreSQL：
 *  - 每次模型查询前，在同一个事务里先执行 set_config（官方推荐的行级安全做法）
 *  - 需要事务时用 txn()，同样先写入上下文
 * 数据库里的行级安全策略据此只放行本租户的行，是业务代码校验之外的第二道隔离。
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor() {
    super({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
    const base = this as PrismaClient;
    const scoped = base.$extends({
      query: {
        $allModels: {
          async $allOperations({ args, query }) {
            const ctx = tenantContext.getStore();
            const [, result] = await base.$transaction([
              base.$executeRaw`SELECT set_config('app.tenant_id', ${ctx?.tenantId ?? ''}, true), set_config('app.bypass_rls', ${ctx?.bypass ? 'on' : 'off'}, true)`,
              query(args),
            ]);
            return result;
          },
        },
      },
    });
    // 让 prisma.user、prisma.project 等模型入口都走带租户上下文的版本
    for (const model of Object.keys(Prisma.ModelName)) {
      const key = lowerFirst(model);
      Object.defineProperty(this, key, { value: (scoped as unknown as Record<string, unknown>)[key], configurable: true, enumerable: true });
    }
  }

  /** 交互式事务：事务内所有语句都在同一租户上下文下执行 */
  txn<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    const ctx = tenantContext.getStore();
    return this.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${ctx?.tenantId ?? ''}, true), set_config('app.bypass_rls', ${ctx?.bypass ? 'on' : 'off'}, true)`;
      return fn(tx);
    });
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
