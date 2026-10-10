import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * 当前请求的数据库租户上下文。每次从连接池取连接时，PrismaService 会把它写入
 * PostgreSQL 会话变量，行级安全策略据此只放行本租户的行：
 *  - 有 tenantId：只能读写该租户的行
 *  - bypass：平台级操作和登录前的查找，可以跨租户
 *  - 都没有：一行都看不到（默认拒绝）
 */
export interface TenantContext {
  tenantId?: string | null;
  bypass?: boolean;
  /** 只读请求的共享事务：整个请求只写一次租户上下文，查询都走这一个事务（见 PrismaService.readScope） */
  tx?: unknown;
  /** 同一请求内的小缓存（如工作日历），随请求结束丢弃 */
  memo?: Map<string, unknown>;
  /** 共享事务上的排队器：一条连接同一时间只能跑一条查询，Promise.all 的并发查询在这里排队 */
  queue?: SerialQueue;
}

/** 让同一事务上的查询逐条执行（pg 不支持在一个连接上并发查询，pg@9 会直接报错） */
export class SerialQueue {
  private tail: Promise<unknown> = Promise.resolve();
  run<T>(fn: () => PromiseLike<T>): Promise<T> {
    const next = this.tail.then(() => fn());
    this.tail = next.then(() => undefined, () => undefined);
    return next;
  }
}

type RawTx = { $executeRaw: (s: TemplateStringsArray, ...v: unknown[]) => Promise<unknown> };

export const tenantContext = new AsyncLocalStorage<TenantContext>();

/** 以“跨租户”身份执行：仅限登录、注册、平台管理员操作、启动引导等没有租户上下文的场景 */
export function withBypass<T>(fn: () => PromiseLike<T>): Promise<T> {
  const ctx = tenantContext.getStore();
  // 已经在只读请求的共享事务里：不能再去连接池拿第二条连接（并发时会把连接池耗尽、互相等待直到超时），
  // 改为在同一事务里临时打开 bypass，执行完再关掉。整个过程独占这条连接，期间请求里的其他查询排队等待，
  // 所以 bypass 不会泄漏给别的查询。
  if (ctx?.tx && ctx.queue) {
    const tx = ctx.tx as RawTx;
    const outer = ctx;
    return ctx.queue.run(async () => {
      if (outer.bypass) return await tenantContext.run({ ...outer, queue: new SerialQueue() }, async () => await fn());
      await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'on', true)`;
      try {
        return await tenantContext.run({ ...outer, bypass: true, queue: new SerialQueue() }, async () => await fn());
      } finally {
        await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'off', true)`;
      }
    });
  }
  // 必须在 run 里面 await：Prisma 的查询是惰性的，等到有人 then 才真正执行，
  // 如果把惰性对象原样返回，执行就会发生在上下文之外
  return tenantContext.run({ bypass: true }, async () => await fn());
}

/** 以指定租户身份执行（用于测试和后台任务） */
export function withTenant<T>(tenantId: string, fn: () => PromiseLike<T>): Promise<T> {
  return tenantContext.run({ tenantId }, async () => await fn());
}

/** 同一请求内只算一次（不在只读请求里时直接计算） */
export function requestMemo<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const memo = tenantContext.getStore()?.memo;
  if (!memo) return fn();
  if (!memo.has(key)) memo.set(key, fn());
  return memo.get(key) as Promise<T>;
}
