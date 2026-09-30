import { HttpException, HttpStatus, Injectable } from '@nestjs/common';

/**
 * 进程内的失败次数限流，防止暴力猜密码和批量注册。
 * 多实例部署时各实例各算各的，需要更严格的限制请在反向代理层（如 nginx limit_req）再加一层。
 */
@Injectable()
export class RateLimiter {
  private readonly hits = new Map<string, number[]>();

  private prune(key: string, windowMs: number) {
    const now = Date.now();
    const list = (this.hits.get(key) ?? []).filter((t) => now - t < windowMs);
    if (list.length) this.hits.set(key, list);
    else this.hits.delete(key);
    return list;
  }

  /** 超过上限就抛 429 */
  assertBelow(key: string, max: number, windowMs: number) {
    if (this.prune(key, windowMs).length >= max) {
      throw new HttpException('Too many attempts, please try again later', HttpStatus.TOO_MANY_REQUESTS);
    }
  }

  record(key: string, windowMs: number) {
    const list = this.prune(key, windowMs);
    list.push(Date.now());
    this.hits.set(key, list);
  }

  reset(key: string) {
    this.hits.delete(key);
  }
}

export const limits = () => ({
  windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS ?? 15 * 60_000),
  loginPerAccount: Number(process.env.RATE_LIMIT_LOGIN_PER_ACCOUNT ?? 8),
  loginPerIp: Number(process.env.RATE_LIMIT_LOGIN_PER_IP ?? 60),
  signupPerIp: Number(process.env.RATE_LIMIT_SIGNUP_PER_IP ?? 10),
});
