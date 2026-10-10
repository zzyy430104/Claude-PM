import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { Api, errorMessage } from '../core/api';
import { Member } from '../core/models';
import { askConfirm } from '../core/dialog';

export type CommentEntity = 'WORK_PACKAGE' | 'RISK' | 'CHANGE' | 'NONCONFORMITY' | 'DELIVERABLE';
interface CommentRow { id: string; body: string; deleted: boolean; createdAt: string; author: string; mine: boolean }

/** 讨论：在工作包、风险、变更、不符合项、交付物上讨论，输入“@姓名”提到项目成员 */
@Component({
  selector: 'app-discussion',
  imports: [MatButtonModule],
  styles: `
    .c { padding: 8px 0; border-bottom: 1px solid var(--pm-line); font-size: 14px; }
    .c:last-of-type { border-bottom: 0; }
    .c .h { display: flex; gap: 8px; align-items: baseline; font-size: 12.5px; color: var(--pm-muted); }
    .c .h b { color: var(--pm-text); font-size: 13.5px; }
    .c .t { white-space: pre-line; margin-top: 2px; }
    .c .t.del { color: var(--pm-muted); font-style: italic; }
    .x { border: 0; background: none; color: var(--pm-muted); cursor: pointer; font-size: 12px; margin-left: auto; }
    textarea { width: 100%; box-sizing: border-box; min-height: 60px; font: inherit; font-size: 14px; border: 1px solid var(--pm-line); border-radius: 8px; padding: 8px 10px; }
    .at { display: flex; flex-wrap: wrap; gap: 4px; margin: 6px 0; font-size: 12.5px; color: var(--pm-muted); align-items: center; }
    .at button { border: 1px solid var(--pm-line); background: #fff; border-radius: 12px; padding: 2px 8px; font: inherit; font-size: 12.5px; cursor: pointer; }
    .row { display: flex; gap: 8px; align-items: center; justify-content: flex-end; }
  `,
  template: `
    <div class="disc" [attr.data-discussion]="entityId()">
      @if (error()) { <div class="error" role="alert">{{ error() }}</div> }
      @for (c of items(); track c.id) {
        <div class="c">
          <div class="h"><b>{{ c.author }}</b><span>{{ c.createdAt.slice(0, 16).replace('T', ' ') }}</span>
            @if (c.mine && !c.deleted) { <button type="button" class="x" (click)="remove(c)" aria-label="删除这条讨论">删除</button> }</div>
          <div class="t" [class.del]="c.deleted">{{ c.deleted ? '（已删除）' : c.body }}</div>
        </div>
      } @empty { <p class="muted" style="margin: 0 0 8px; font-size: 13.5px">还没有讨论。</p> }
      @if (canPost()) {
        <textarea [value]="text()" (input)="text.set($any($event.target).value)" placeholder="写下讨论内容，输入 @姓名 提到项目成员" aria-label="讨论内容"></textarea>
        <div class="at">@ 提到：@for (m of team(); track m.userId) { <button type="button" (click)="mention(m)">{{ m.user?.name }}</button> }</div>
        <div class="row">@if (mentioned().length) { <span class="muted" style="font-size: 12.5px">将通知 {{ mentionedNames() }}</span> }<button mat-stroked-button type="button" (click)="post()">发表</button></div>
      }
    </div>
  `,
})
export class Discussion {
  private readonly api = inject(Api);
  readonly projectId = input.required<string>();
  readonly entityType = input.required<CommentEntity>();
  readonly entityId = input.required<string>();
  readonly canPost = input(true);
  readonly items = signal<CommentRow[]>([]);
  readonly team = signal<Member[]>([]);
  readonly text = signal('');
  readonly error = signal('');
  /** 正文里出现“@姓名”的项目成员 */
  readonly mentioned = computed(() => this.team().filter((m) => m.user?.name && this.text().includes(`@${m.user.name}`)));
  readonly mentionedNames = computed(() => this.mentioned().map((m) => m.user?.name).join('、'));

  constructor() {
    effect(() => { this.entityId(); void this.load(); });
  }
  async ngOnInit() {
    try {
      const ms = await this.api.get<Member[]>(`/projects/${this.projectId()}/members`);
      const seen = new Set<string>();
      this.team.set(ms.filter((m) => m.active !== false && !seen.has(m.userId) && !!seen.add(m.userId)));
    } catch { /* 只读 */ }
  }
  async load() {
    try {
      this.items.set(await this.api.get<CommentRow[]>(`/projects/${this.projectId()}/comments?type=${this.entityType()}&entityId=${this.entityId()}`));
    } catch (e) { this.error.set(errorMessage(e, '加载讨论失败')); }
  }
  mention(m: Member) {
    const t = this.text();
    if (!t.includes(`@${m.user?.name}`)) this.text.set(`${t}${t && !t.endsWith(' ') ? ' ' : ''}@${m.user?.name} `);
  }
  async post() {
    const body = this.text().trim();
    if (!body) return;
    this.error.set('');
    try {
      await this.api.post(`/projects/${this.projectId()}/comments`, { entityType: this.entityType(), entityId: this.entityId(), body, mentions: this.mentioned().map((m) => m.userId) });
      this.text.set('');
      await this.load();
    } catch (e) { this.error.set(errorMessage(e, '发表失败')); }
  }
  async remove(c: CommentRow) {
    if (!await askConfirm('删除这条讨论？')) return;
    try { await this.api.delete(`/projects/${this.projectId()}/comments/${c.id}`); await this.load(); } catch (e) { this.error.set(errorMessage(e, '删除失败')); }
  }
}
