import { BadRequestException, ConflictException, ForbiddenException, HttpException, HttpStatus, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.js';
import { Role } from '../generated/prisma/enums.js';
import { AuditService } from '../audit/audit.service.js';
import { requireTenantId } from '../common/auth.types.js';
import type { AuthUser } from '../common/auth.types.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { type AiConfig, decryptKey, DEFAULT_AI, encryptKey, loadAiConfig, maskKey, type Scenario, SCENARIO_LABELS, SCENARIOS } from './ai-config.js';
import { type ChatMessage, SCENARIO_DEFS } from './scenarios.js';
import { aiFetch, AiUrlError, checkAiBaseUrl } from './url-guard.js';

export interface AiSettingsInput extends Partial<Omit<AiConfig, 'scenarios'>> { scenarios?: Record<string, unknown>; apiKey?: string | null }

const isMgmt = (u: AuthUser) => u.role === Role.TOP_MANAGEMENT || u.role === Role.TENANT_ADMIN;
const startOfDay = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
const mock = () => process.env.AI_TRANSPORT === 'mock';

/**
 * AI 辅助（第 7 章）：AI 只起草，人确认后才保存；不自动审批、关闭、发送。
 * 接口按 OpenAI 兼容格式实现（默认 DeepSeek），换通义千问或内网模型只改设置；密钥加密保存在服务器端。
 * 按场景开关；有调用次数和输入长度上限；每次调用都有使用记录（谁、时间、场景、是否采纳）。
 * 测试环境设置 AI_TRANSPORT=mock 时不调用外部接口，返回固定的起草结果。
 */
@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  // ───── 设置 ─────

  /** 前端用：哪些场景可用（不可用时隐藏 AI 按钮） */
  async status(actor: AuthUser) {
    const { config, keyEnc } = await loadAiConfig(this.prisma, requireTenantId(actor));
    const on = config.enabled && !!keyEnc;
    return { enabled: on, scenarios: Object.fromEntries(SCENARIOS.map((s) => [s, on && config.scenarios[s]])) };
  }

  async getSettings(actor: AuthUser) {
    const { config, keyEnc } = await loadAiConfig(this.prisma, requireTenantId(actor));
    let keyHint: string | null = null;
    if (keyEnc) { try { keyHint = maskKey(decryptKey(keyEnc)); } catch { keyHint = '（无法解密，请重新填写）'; } }
    return { config, keyHint, labels: SCENARIO_LABELS, defaults: DEFAULT_AI };
  }

  async saveSettings(actor: AuthUser, body: AiSettingsInput) {
    const tenantId = requireTenantId(actor);
    const { config: cur } = await loadAiConfig(this.prisma, tenantId);
    if (body.scenarios !== undefined) {
      for (const [k, v] of Object.entries(body.scenarios)) {
        if (!SCENARIOS.includes(k as Scenario)) throw new BadRequestException(`Unknown scenario ${k}`);
        if (typeof v !== 'boolean') throw new BadRequestException(`scenarios.${k} must be a boolean`);
      }
    }
    // 只取已知字段，避免把请求里的其他内容写进企业配置
    const pick = <K extends keyof AiConfig>(k: K) => (body[k] !== undefined ? body[k] : cur[k]) as AiConfig[K];
    const next: AiConfig = {
      enabled: pick('enabled'), baseUrl: pick('baseUrl'), model: pick('model'),
      scenarios: { ...cur.scenarios, ...body.scenarios },
      perUserDaily: pick('perUserDaily'), perTenantDaily: pick('perTenantDaily'), maxFileMb: pick('maxFileMb'), maxInputChars: pick('maxInputChars'),
    };
    if (typeof next.enabled !== 'boolean') throw new BadRequestException('enabled must be a boolean');
    next.baseUrl = String(next.baseUrl ?? '').trim().replace(/\/+$/, '');
    if (body.baseUrl !== undefined) {
      try { checkAiBaseUrl(next.baseUrl); } catch (e) { throw new BadRequestException((e as Error).message); }
    }
    if (typeof next.model !== 'string' || !next.model.trim() || next.model.length > 100) throw new BadRequestException('model is required');
    for (const k of ['perUserDaily', 'perTenantDaily', 'maxFileMb', 'maxInputChars'] as const) {
      if (!Number.isInteger(next[k]) || next[k] < 1 || next[k] > 1_000_000) throw new BadRequestException(`${k} must be a positive integer`);
    }
    const data: Prisma.TenantUpdateInput = { aiConfig: next as unknown as Prisma.InputJsonValue };
    if (body.apiKey !== undefined) data.aiKeyEnc = body.apiKey ? encryptKey(body.apiKey.trim()) : null;
    await this.audit.tx(actor, { action: 'tenant.aiSettings', entity: 'Tenant', entityId: () => tenantId, before: cur as unknown as Prisma.InputJsonValue, after: () => ({ ...next, apiKey: body.apiKey === undefined ? 'unchanged' : body.apiKey ? 'set' : 'removed' }) as unknown as Prisma.InputJsonValue },
      (tx) => tx.tenant.update({ where: { id: tenantId }, data }));
    return this.getSettings(actor);
  }

  /** 测试连接：列出这个密钥能用的模型 */
  async test(actor: AuthUser) {
    const { config, keyEnc } = await loadAiConfig(this.prisma, requireTenantId(actor));
    if (!keyEnc) throw new BadRequestException({ code: 'AI_NOT_CONFIGURED', message: 'API key is not set' });
    if (mock()) return { ok: true, models: ['deepseek-flash', 'deepseek-v4-pro'] };
    try {
      const r = await aiFetch(config.baseUrl, '/models', { headers: { Authorization: `Bearer ${decryptKey(keyEnc)}` }, signal: AbortSignal.timeout(20_000) });
      const text = await r.text();
      // 不回显对方的响应正文（防止借测试连接读取内网服务的内容），只给状态码
      if (!r.ok) return { ok: false, status: r.status, message: r.status === 401 || r.status === 403 ? 'API key was rejected' : 'AI service returned an error' };
      const j = JSON.parse(text) as { data?: { id: string }[] };
      return { ok: true, models: (j.data ?? []).map((m) => m.id) };
    } catch (e) {
      if (e instanceof AiUrlError) return { ok: false, message: e.message };
      this.logger.warn(`AI test failed: ${(e as Error).message}`);
      return { ok: false, message: 'Could not reach the AI service' };
    }
  }

  // ───── 起草 ─────

  private async guard(actor: AuthUser, scenario: Scenario) {
    const tenantId = requireTenantId(actor);
    const { config, keyEnc } = await loadAiConfig(this.prisma, tenantId);
    if (!config.enabled || !keyEnc) throw new ConflictException({ code: 'AI_DISABLED', message: 'AI is not enabled' });
    if (!config.scenarios[scenario]) throw new ConflictException({ code: 'AI_SCENARIO_DISABLED', message: 'This AI scenario is turned off' });
    const since = startOfDay();
    const [mine, all] = await Promise.all([
      this.prisma.aiUsage.count({ where: { tenantId, userId: actor.id, createdAt: { gte: since } } }),
      this.prisma.aiUsage.count({ where: { tenantId, createdAt: { gte: since } } }),
    ]);
    if (mine >= config.perUserDaily || all >= config.perTenantDaily) throw new HttpException({ code: 'AI_LIMIT', message: 'Daily AI limit reached' }, HttpStatus.TOO_MANY_REQUESTS);
    return { tenantId, config, key: decryptKey(keyEnc) };
  }

  private async call(config: AiConfig, key: string, messages: ChatMessage[]) {
    const r = await aiFetch(config.baseUrl, '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: config.model, messages, temperature: 0.2, response_format: { type: 'json_object' }, max_tokens: 8000 }),
      signal: AbortSignal.timeout(180_000),
    });
    const text = await r.text();
    if (!r.ok) throw new Error(`AI service returned ${r.status}`);
    const j = JSON.parse(text) as { model?: string; choices?: { message?: { content?: string } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } };
    const content = j.choices?.[0]?.message?.content ?? '';
    const json = content.replace(/^```(?:json)?\s*|\s*```$/g, '');
    return { out: JSON.parse(json) as Record<string, unknown>, model: j.model ?? config.model, usage: j.usage ?? {} };
  }

  /** 起草：返回草稿和使用记录 id；采纳时调用 adopt 记录确认人 */
  async draft(actor: AuthUser, scenario: Scenario, input: Record<string, unknown>, projectId?: string) {
    if (!SCENARIOS.includes(scenario)) throw new NotFoundException('Unknown scenario');
    if (projectId) await this.checkProject(actor, projectId);
    const { tenantId, config, key } = await this.guard(actor, scenario);
    const def = SCENARIO_DEFS[scenario];
    const messages = def.build(input);
    const chars = messages.reduce((n, m) => n + m.content.length, 0);
    if (chars > config.maxInputChars + 8000) throw new BadRequestException({ code: 'AI_INPUT_TOO_LONG', message: `Input too long (${chars} characters)` });
    try {
      const r = mock() ? { out: def.mock(input), model: `mock:${config.model}`, usage: {} as { prompt_tokens?: number; completion_tokens?: number } } : await this.call(config, key, messages);
      const draft = def.normalize(r.out);
      const u = await this.prisma.aiUsage.create({
        data: { tenantId, userId: actor.id, projectId: projectId ?? null, scenario, model: r.model, inputChars: chars, promptTokens: r.usage.prompt_tokens ?? 0, completionTokens: r.usage.completion_tokens ?? 0, output: draft as Prisma.InputJsonValue },
      });
      return { usageId: u.id, model: r.model, draft };
    } catch (e) {
      this.logger.warn(`AI ${scenario} failed: ${(e as Error).message}`);
      await this.prisma.aiUsage.create({ data: { tenantId, userId: actor.id, projectId: projectId ?? null, scenario, model: config.model, inputChars: chars, status: 'ERROR', error: (e as Error).message.slice(0, 500) } });
      throw new HttpException({ code: 'AI_FAILED', message: 'The AI service did not return a usable draft; try again or fill in manually' }, HttpStatus.BAD_GATEWAY);
    }
  }

  private async checkProject(actor: AuthUser, projectId: string) {
    const tenantId = requireTenantId(actor);
    const p = await this.prisma.project.findFirst({ where: { id: projectId, tenantId } });
    if (!p) throw new NotFoundException('Project not found');
    if (!isMgmt(actor) && !(await this.prisma.projectMember.findFirst({ where: { projectId, userId: actor.id, active: true } }))) throw new NotFoundException('Project not found');
    return p;
  }

  /** 采纳（或放弃）：记录确认人、时间、保存到的记录 */
  async adopt(actor: AuthUser, usageId: string, body: { adopted: boolean; entityType?: string; entityId?: string }) {
    const u = await this.prisma.aiUsage.findFirst({ where: { id: usageId, tenantId: requireTenantId(actor) } });
    if (!u) throw new NotFoundException('AI usage not found');
    if (u.userId !== actor.id) throw new ForbiddenException('Only the person who asked for the draft can confirm it');
    return this.prisma.aiUsage.update({ where: { id: usageId }, data: { adopted: body.adopted, adoptedAt: new Date(), entityType: body.entityType ?? null, entityId: body.entityId ?? null } });
  }

  /** 记录上的“AI 起草，某某确认” */
  async provenance(actor: AuthUser, entityType: string, ids: string[]) {
    if (!ids.length) return {};
    const rows = await this.prisma.aiUsage.findMany({ where: { tenantId: requireTenantId(actor), adopted: true, entityType, entityId: { in: ids.slice(0, 500) } }, orderBy: { adoptedAt: 'desc' } });
    const users = await this.prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.userId))] } }, select: { id: true, name: true } });
    const out: Record<string, { by: string; at: Date | null; scenario: string }> = {};
    for (const r of rows) if (r.entityId && !out[r.entityId]) out[r.entityId] = { by: users.find((u) => u.id === r.userId)?.name ?? '—', at: r.adoptedAt, scenario: r.scenario };
    return out;
  }

  /** 使用记录与统计（企业管理员、管理层） */
  async usage(actor: AuthUser, days = 30) {
    if (!isMgmt(actor)) throw new ForbiddenException('Management only');
    const tenantId = requireTenantId(actor);
    const since = new Date(Date.now() - days * 86_400_000);
    const rows = await this.prisma.aiUsage.findMany({ where: { tenantId, createdAt: { gte: since } }, orderBy: { createdAt: 'desc' }, take: 500 });
    const users = await this.prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.userId))] } }, select: { id: true, name: true } });
    const by = (s: string) => rows.filter((r) => r.scenario === s);
    return {
      stats: SCENARIOS.map((s) => ({ scenario: s, label: SCENARIO_LABELS[s], calls: by(s).length, errors: by(s).filter((r) => r.status === 'ERROR').length, adopted: by(s).filter((r) => r.adopted).length, tokens: by(s).reduce((n, r) => n + r.promptTokens + r.completionTokens, 0) })),
      rows: rows.slice(0, 200).map((r) => ({ id: r.id, at: r.createdAt, user: users.find((u) => u.id === r.userId)?.name ?? '—', scenario: r.scenario, label: SCENARIO_LABELS[r.scenario as Scenario] ?? r.scenario, model: r.model, status: r.status, error: r.error, adopted: r.adopted, tokens: r.promptTokens + r.completionTokens })),
    };
  }
}
