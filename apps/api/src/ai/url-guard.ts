import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';

/**
 * AI 接口地址的访问限制（防止服务端请求伪造 SSRF）：企业管理员填的 baseUrl 会被服务器请求，
 * 不加限制就能让服务器去访问内网（数据库、其他服务、云厂商元数据 169.254.169.254 等）。
 *
 *  - 只允许平台配置的域名：环境变量 AI_ALLOWED_HOSTS（逗号分隔，含其子域名）；不设置时用下面的默认清单
 *  - 默认只允许 https，且域名解析出的地址不能是内网、回环、链路本地等地址
 *  - 私有部署要用内网模型时，平台方设置 AI_ALLOW_PRIVATE=true，并把内网地址加进 AI_ALLOWED_HOSTS
 *  - 请求时不跟随重定向（见 aiFetch）
 */
export const DEFAULT_AI_HOSTS = ['api.deepseek.com', 'dashscope.aliyuncs.com', 'api.openai.com', 'api.moonshot.cn', 'open.bigmodel.cn', 'ark.cn-beijing.volces.com', 'qianfan.baidubce.com'];

export function allowedHosts(): string[] {
  const raw = process.env.AI_ALLOWED_HOSTS?.trim();
  return raw ? raw.split(',').map((h) => h.trim().toLowerCase()).filter(Boolean) : DEFAULT_AI_HOSTS;
}
const allowPrivate = () => process.env.AI_ALLOW_PRIVATE === 'true';

const blocked = new BlockList();
for (const [net, bits] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24],
  ['224.0.0.0', 4], ['240.0.0.0', 4],
] as const) blocked.addSubnet(net, bits, 'ipv4');
for (const [net, bits] of [['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8], ['64:ff9b::', 96], ['2001:db8::', 32]] as const) blocked.addSubnet(net, bits, 'ipv6');

/** 是否内网 / 回环 / 链路本地 / 保留地址（含 IPv4 映射的 IPv6 地址） */
export function isPrivateAddress(ip: string): boolean {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (mapped) return isPrivateAddress(mapped[1]);
  const v = isIP(ip);
  if (!v) return true;
  return blocked.check(ip, v === 4 ? 'ipv4' : 'ipv6');
}

export class AiUrlError extends Error {}

/** 保存设置时检查（不解析 DNS）：协议、域名在允许清单里、不是内网 IP 字面量 */
export function checkAiBaseUrl(raw: string): URL {
  let u: URL;
  try { u = new URL(raw); } catch { throw new AiUrlError('baseUrl must be a valid URL'); }
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && allowPrivate())) throw new AiUrlError('baseUrl must use https');
  if (u.username || u.password) throw new AiUrlError('baseUrl must not contain credentials');
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  const list = allowedHosts();
  if (!list.includes('*') && !list.some((h) => host === h || host.endsWith(`.${h}`))) {
    throw new AiUrlError(`baseUrl host is not allowed; allowed: ${list.join(', ')}`);
  }
  if (isIP(host) && isPrivateAddress(host) && !allowPrivate()) throw new AiUrlError('baseUrl must not point to a private address');
  return u;
}

/** 请求前检查：除上面的规则外，解析域名，任何一个地址落在内网就拒绝 */
export async function assertAiUrlSafe(raw: string): Promise<void> {
  const u = checkAiBaseUrl(raw);
  if (allowPrivate()) return;
  const host = u.hostname.replace(/^\[|\]$/g, '');
  const addrs = isIP(host) ? [{ address: host }] : await lookup(host, { all: true, verbatim: true });
  if (!addrs.length || addrs.some((a) => isPrivateAddress(a.address))) throw new AiUrlError('baseUrl resolves to a private address');
}

/** 访问 AI 接口：先检查地址，不跟随重定向 */
export async function aiFetch(baseUrl: string, path: string, init: RequestInit): Promise<Response> {
  await assertAiUrlSafe(baseUrl);
  const r = await fetch(`${baseUrl}${path}`, { ...init, redirect: 'manual' });
  if (r.status >= 300 && r.status < 400) throw new AiUrlError(`AI service redirected (${r.status}); redirects are not followed`);
  return r;
}
