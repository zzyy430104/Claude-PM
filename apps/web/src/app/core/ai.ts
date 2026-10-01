import { Injectable, inject, signal } from '@angular/core';
import { Api } from './api';

export type AiScenario = 'CONTRACT' | 'PLAN' | 'QUICK' | 'MINUTES' | 'ANALYSIS' | 'REPORT';
export interface AiDraft<T> { usageId: string; model: string; draft: T }
export interface AiProvenance { by: string; at: string; scenario: string }

/**
 * AI 辅助（第 7 章）：AI 只起草，人确认后才保存。
 * 起草后拿到 usageId；用户确认保存时调用 adopt，把保存到的记录记下来，记录上显示“AI 起草，某某确认”。
 */
@Injectable({ providedIn: 'root' })
export class Ai {
  private readonly api = inject(Api);
  readonly scenarios = signal<Record<AiScenario, boolean>>({ CONTRACT: false, PLAN: false, QUICK: false, MINUTES: false, ANALYSIS: false, REPORT: false });
  private loaded: Promise<void> | null = null;

  /** 读取一次可用场景；不可用时 AI 按钮隐藏 */
  load(force = false) {
    if (!this.loaded || force) {
      this.loaded = this.api.get<{ enabled: boolean; scenarios: Record<AiScenario, boolean> }>('/ai/status')
        .then((s) => this.scenarios.set(s.scenarios))
        .catch(() => undefined);
    }
    return this.loaded;
  }
  on(s: AiScenario) { return this.scenarios()[s]; }

  draft<T>(scenario: AiScenario, input: Record<string, unknown>, projectId?: string) {
    return this.api.post<AiDraft<T>>(`/ai/draft/${scenario}`, { input, projectId });
  }
  draftFiles<T>(scenario: AiScenario, files: File[], input: Record<string, unknown>, projectId?: string) {
    const f = new FormData();
    for (const x of files) f.append('files', x, x.name);
    f.append('input', JSON.stringify(input));
    if (projectId) f.append('projectId', projectId);
    return this.api.upload<AiDraft<T>>(`/ai/draft-file/${scenario}`, f);
  }
  /** 采纳（保存了 AI 起草的内容）或放弃 */
  adopt(usageId: string, adopted: boolean, entityType?: string, entityId?: string) {
    return this.api.post(`/ai/usage/${usageId}/adopt`, { adopted, entityType, entityId }).catch(() => undefined);
  }

  // ───── “AI 起草，某某确认”：同一时刻的查询合并成一次请求 ─────
  private queue = new Map<string, { ids: Set<string>; waiters: ((m: Record<string, AiProvenance>) => void)[] }>();
  provenance(entityType: string, id: string): Promise<AiProvenance | null> {
    let q = this.queue.get(entityType);
    if (!q) {
      q = { ids: new Set(), waiters: [] };
      this.queue.set(entityType, q);
      queueMicrotask(async () => {
        const cur = this.queue.get(entityType)!;
        this.queue.delete(entityType);
        let map: Record<string, AiProvenance> = {};
        try { map = await this.api.get<Record<string, AiProvenance>>(`/ai/provenance?entityType=${entityType}&ids=${[...cur.ids].join(',')}`); } catch { /* 忽略 */ }
        cur.waiters.forEach((w) => w(map));
      });
    }
    q.ids.add(id);
    return new Promise((resolve) => q!.waiters.push((m) => resolve(m[id] ?? null)));
  }
}
