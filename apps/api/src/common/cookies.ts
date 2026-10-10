import type { Request, Response } from 'express';

export const REFRESH_COOKIE = 'pm_rt';
/** 刷新令牌接口要求带上这个请求头，浏览器跨站表单无法伪造自定义头，作为 SameSite 之外的第二道 CSRF 防线 */
export const CSRF_HEADER = 'x-requested-with';
export const CSRF_VALUE = 'claude-pm';

/** 只要站点通过 https 访问就必须带 Secure；本地 http 开发不带 */
function secure() {
  if (process.env.COOKIE_SECURE) return process.env.COOKIE_SECURE === 'true';
  return (process.env.APP_URL ?? '').startsWith('https://');
}

export function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return undefined;
}

export function setRefreshCookie(res: Response, token: string) {
  const days = Number(process.env.REFRESH_TOKEN_TTL_DAYS ?? 7);
  res.cookie(REFRESH_COOKIE, token, { httpOnly: true, sameSite: 'strict', secure: secure(), path: '/', maxAge: days * 86_400_000 });
}

export function clearRefreshCookie(res: Response) {
  res.clearCookie(REFRESH_COOKIE, { httpOnly: true, sameSite: 'strict', secure: secure(), path: '/' });
}
