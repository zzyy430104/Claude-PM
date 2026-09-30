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
}

export const tenantContext = new AsyncLocalStorage<TenantContext>();

/** 以“跨租户”身份执行：仅限登录、注册、平台管理员操作、启动引导等没有租户上下文的场景 */
export function withBypass<T>(fn: () => PromiseLike<T>): Promise<T> {
  // 必须在 run 里面 await：Prisma 的查询是惰性的，等到有人 then 才真正执行，
  // 如果把惰性对象原样返回，执行就会发生在上下文之外
  return tenantContext.run({ bypass: true }, async () => await fn());
}

/** 以指定租户身份执行（用于测试和后台任务） */
export function withTenant<T>(tenantId: string, fn: () => PromiseLike<T>): Promise<T> {
  return tenantContext.run({ tenantId }, async () => await fn());
}
