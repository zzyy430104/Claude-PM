import { Component, inject, input, output, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { Ai } from '../core/ai';
import { Api, errorMessage } from '../core/api';
import { Project, WbsResponse } from '../core/models';

interface Suggestion { action: 'ADD' | 'DURATION' | 'NOTE'; code: string; name: string; durationDays: number | null; parentCode: string; reason: string; source: string; done?: boolean }
const LABEL = { ADD: '新增工作包', DURATION: '调整工期', NOTE: '注意' } as const;

/** 计划调整建议：AI 对照项目要求（及合同原文）检查 WBS 草稿，逐条采纳 */
@Component({
  selector: 'app-ai-plan',
  imports: [MatButtonModule],
  styles: `
    .ai { border: 1px dashed var(--pm-primary); border-radius: var(--pm-radius); padding: 12px 16px; margin: 0 0 16px; background: var(--pm-card); }
    .ai h3 { margin: 0 0 4px; font-size: 15px; }
    .tools { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-top: 8px; }
    td small { display: block; color: var(--pm-muted); font-size: 12.5px; }
  `,
  template: `
    <div class="ai" data-ai="plan">
      <h3><span class="pill blue">AI</span> 计划调整建议</h3>
      <p class="muted" style="margin: 0; font-size: 13px">AI 对照项目要求（可附合同原文）检查当前 WBS，建议缺少的工作包和不合理的工期。逐条确认后才改计划。</p>
      @if (error()) { <div class="error" role="alert">{{ error() }}</div> }
      <div class="tools">
        <input type="file" multiple accept=".pdf,.docx,.xlsx,.txt" aria-label="附合同原文（可选）" (change)="files.set($any($event.target).files ? [].slice.call($any($event.target).files) : [])" />
        <button mat-stroked-button type="button" [disabled]="busy()" (click)="run()">{{ busy() ? 'AI 正在检查…' : '生成建议' }}</button>
      </div>
      @if (items().length) {
        <div class="tblwrap" style="margin-top: 10px"><table>
          <thead><tr><th>建议</th><th>内容</th><th>理由</th><th></th></tr></thead>
          <tbody>
            @for (s of items(); track $index; let i = $index) {
              <tr [attr.data-sug]="s.name || s.code">
                <td style="white-space: nowrap">{{ label(s) }}</td>
                <td>@switch (s.action) {
                  @case ('ADD') { {{ s.name }}（{{ s.durationDays ?? 1 }} 个工作日@if (s.parentCode) { ，放在 {{ s.parentCode }} 下 }） }
                  @case ('DURATION') { {{ s.code }} {{ s.name }}：工期改为 {{ s.durationDays }} 个工作日 }
                  @default { — }
                }</td>
                <td>{{ s.reason }}<small>{{ s.source }}</small></td>
                <td style="white-space: nowrap">@if (s.done) { <span class="pill green">已采纳</span> } @else if (s.action !== 'NOTE') { <button mat-button type="button" (click)="adopt(i)">采纳</button> }</td>
              </tr>
            }
          </tbody>
        </table></div>
      }
    </div>
  `,
})
export class AiPlan {
  private readonly api = inject(Api);
  private readonly ai = inject(Ai);
  readonly project = input.required<Project>();
  readonly changed = output<void>();
  readonly files = signal<File[]>([]);
  readonly items = signal<Suggestion[]>([]);
  readonly busy = signal(false);
  readonly error = signal('');
  private usageId = '';
  private adopted = false;
  private wbs: WbsResponse['items'] = [];

  label(s: Suggestion) { return LABEL[s.action]; }

  async run() {
    this.busy.set(true); this.error.set(''); this.items.set([]);
    try {
      const id = this.project().id;
      const [w, versions] = await Promise.all([this.api.get<WbsResponse>(`/projects/${id}/wbs`), this.api.get<{ version: number; data: unknown }[]>(`/projects/${id}/requirement-versions`).catch(() => [])]);
      this.wbs = w.items;
      const requirements = versions.length ? versions[versions.length - 1].data : null;
      const input = { requirements, wbs: w.items.map((x) => ({ code: x.code, name: x.name, durationDays: x.durationDays, isMilestone: x.isMilestone, isLeaf: x.isLeaf })) };
      const d = this.files().length
        ? await this.ai.draftFiles<{ suggestions: Suggestion[] }>('PLAN', this.files(), input, id)
        : await this.ai.draft<{ suggestions: Suggestion[] }>('PLAN', input, id);
      this.usageId = d.usageId; this.adopted = false;
      this.items.set(d.draft.suggestions);
      if (!d.draft.suggestions.length) this.error.set('AI 没有发现需要调整的地方');
    } catch (e) { this.error.set(errorMessage(e, 'AI 生成建议失败')); } finally { this.busy.set(false); }
  }

  /** 新增：放在建议的父级下，编号取下一个；调整工期：改对应工作包 */
  async adopt(i: number) {
    const s = this.items()[i];
    const id = this.project().id;
    this.error.set('');
    try {
      if (s.action === 'ADD') {
        const parent = this.wbs.find((w) => w.code === s.parentCode) ?? null;
        const prefix = parent ? `${parent.code}.` : '';
        const siblings = this.wbs.filter((w) => (parent ? w.parentId === parent.id : !w.parentId)).map((w) => Number(w.code.slice(prefix.length).split('.')[0]) || 0);
        const code = `${prefix}${(siblings.length ? Math.max(...siblings) : 0) + 1}`;
        await this.api.post(`/projects/${id}/wbs`, { code, name: s.name, durationDays: Math.max(0, Math.round(s.durationDays ?? 1)), parentId: parent?.id, phaseId: parent?.phaseId ?? undefined, description: `AI 建议：${s.reason}` });
      } else {
        const wp = this.wbs.find((w) => w.code === s.code);
        if (!wp) { this.error.set(`找不到工作包 ${s.code}`); return; }
        await this.api.patch(`/projects/${id}/wbs/${wp.id}`, { durationDays: Math.max(0, Math.round(s.durationDays ?? wp.durationDays)) });
      }
      this.items.update((xs) => xs.map((x, j) => (j === i ? { ...x, done: true } : x)));
      this.wbs = (await this.api.get<WbsResponse>(`/projects/${id}/wbs`)).items;
      if (!this.adopted) { await this.ai.adopt(this.usageId, true, 'PROJECT_PLAN', id); this.adopted = true; }
      this.changed.emit();
    } catch (e) { this.error.set(errorMessage(e, '采纳失败')); }
  }
}
