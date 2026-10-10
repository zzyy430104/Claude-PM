import { afterEach, describe, expect, it, vi } from 'vitest';
import { aiFetch, assertAiUrlSafe, checkAiBaseUrl, isPrivateAddress } from './url-guard.js';

describe('AI 接口地址限制（SSRF）', () => {
  afterEach(() => { delete process.env.AI_ALLOWED_HOSTS; delete process.env.AI_ALLOW_PRIVATE; vi.restoreAllMocks(); });

  it('识别内网、回环、链路本地和保留地址', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fe80::1', 'fd00::1', '::ffff:127.0.0.1', '::ffff:169.254.169.254']) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
    for (const ip of ['8.8.8.8', '1.1.1.1', '2606:4700::1111']) expect(isPrivateAddress(ip), ip).toBe(false);
  });

  it('默认只允许内置清单里的域名（含子域名）和 https', () => {
    expect(() => checkAiBaseUrl('https://api.deepseek.com')).not.toThrow();
    expect(() => checkAiBaseUrl('https://dashscope.aliyuncs.com/compatible-mode/v1')).not.toThrow();
    for (const u of ['http://api.deepseek.com', 'https://evil.example.com', 'https://api.deepseek.com.evil.com', 'http://169.254.169.254', 'http://api:3000', 'https://127.0.0.1', 'https://user:pw@api.deepseek.com', 'ftp://api.deepseek.com', 'not a url']) {
      expect(() => checkAiBaseUrl(u), u).toThrow();
    }
  });

  it('平台可配置允许的域名；私有部署允许内网地址', () => {
    process.env.AI_ALLOWED_HOSTS = 'llm.internal.example, 10.0.0.5';
    expect(() => checkAiBaseUrl('https://llm.internal.example/v1')).not.toThrow();
    expect(() => checkAiBaseUrl('https://api.deepseek.com')).toThrow();
    expect(() => checkAiBaseUrl('https://10.0.0.5')).toThrow();
    process.env.AI_ALLOW_PRIVATE = 'true';
    expect(() => checkAiBaseUrl('http://10.0.0.5:8000/v1')).not.toThrow();
  });

  it('请求前解析域名：解析到内网地址就拒绝', async () => {
    process.env.AI_ALLOWED_HOSTS = 'localhost';
    await expect(assertAiUrlSafe('https://localhost')).rejects.toThrow(/private/);
  });

  it('不跟随重定向', async () => {
    process.env.AI_ALLOWED_HOSTS = '*';
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/' } }));
    await expect(aiFetch('https://8.8.8.8', '/models', {})).rejects.toThrow(/redirect/);
    expect(vi.mocked(fetch).mock.calls[0][1]).toMatchObject({ redirect: 'manual' });
  });
});
