import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { withBypass } from '../prisma/tenant-context.js';

/**
 * 失败次数限流，防止暴力猜密码和批量注册。
 * 计数存在数据库（auth_attempts），多进程、多实例部署时共用；反向代理层（nginx limit_req）另有一层。
 */
@Injectable()
export class RateLimiter {
  constructor(private readonly prisma: PrismaService) {}

  /** 超过上限就抛 429 */
  async assertBelow(key: string, max: number, windowMs: number) {
    const n = await withBypass(() => this.prisma.authAttempt.count({ where: { key, at: { gt: new Date(Date.now() - windowMs) } } }));
    if (n >= max) throw new HttpException('Too many attempts, please try again later', HttpStatus.TOO_MANY_REQUESTS);
  }

  async record(key: string) {
    await withBypass(() => this.prisma.authAttempt.create({ data: { key } }));
    // 顺带清理一天以前的记录（各窗口都不超过一天）
    if (Math.random() < 0.02) await withBypass(() => this.prisma.authAttempt.deleteMany({ where: { at: { lt: new Date(Date.now() - 86_400_000) } } }));
  }

  async reset(key: string) {
    await withBypass(() => this.prisma.authAttempt.deleteMany({ where: { key } }));
  }
}

export const limits = () => ({
  windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS ?? 15 * 60_000),
  loginPerAccount: Number(process.env.RATE_LIMIT_LOGIN_PER_ACCOUNT ?? 8),
  loginPerIp: Number(process.env.RATE_LIMIT_LOGIN_PER_IP ?? 60),
  signupPerIp: Number(process.env.RATE_LIMIT_SIGNUP_PER_IP ?? 10),
});
