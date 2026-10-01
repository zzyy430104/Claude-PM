import { Component, computed, inject, input, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { Api, errorMessage } from '../core/api';
import { AnnouncementRow, Member, Project } from '../core/models';

/** 公告：项目经理和管理层发布，发给全项目组或指定人员，可要求已读确认并提醒未读人员 */
@Component({
  selector: 'app-project-announcements',
  imports: [MatButtonModule],
  styles: `
    .lay { display: grid; grid-template-columns: 300px minmax(0, 1fr); gap: 16px; align-items: start; }
    @media (max-width: 900px) { .lay { grid-template-columns: 1fr; } }
    .list { display: flex; flex-direction: column; gap: 8px; }
    .mi { text-align: left; border: 1px solid var(--pm-line); background: var(--pm-card); border-radius: 12px; padding: 10px 12px; cursor: pointer; font: inherit; display: flex; flex-direction: column; gap: 3px; }
    .mi[aria-selected=true] { border-color: var(--pm-primary); box-shadow: 0 0 0 1px var(--pm-primary); }
    .mi b { font-size: 14.5px; } .mi small { color: var(--pm-muted); font-size: 12.5px; }
    .mi.unread b::before { content: '● '; color: var(--pm-primary); }
    .chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
    .chip { display: inline-flex; gap: 6px; align-items: center; background: var(--pm-bg-2); border-radius: 8px; padding: 4px 10px; font-size: 13.5px; }
    .chip.un { background: var(--pm-amber-bg); color: var(--pm-amber); }
    .track { height: 6px; background: var(--pm-bg-2); border-radius: 3px; overflow: hidden; margin: 8px 0 12px; } .track i { display: block; height: 100%; background: var(--pm-green); }
    .two { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
    textarea { min-height: 120px; }
    .tools { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-top: 12px; } .tools .sp { flex: 1; }
  `,
  template: `
    @if (error()) { <div class="error" role="alert">{{ error() }}</div> }
    <div class="lay">
      <div class="list">
        @if (canPublish()) { <button mat-flat-button type="button" (click)="composing.set(true)">+ 发布公告</button> }
        @for (a of items(); track a.id) {
          <button type="button" class="mi" [class.unread]="a.forMe && !a.readByMe" [attr.aria-selected]="cur()?.id === a.id && !composing()" (click)="open(a)" [attr.data-ann]="a.title">
            <b>{{ a.title }}</b><small>{{ a.author }} · {{ a.createdAt.slice(0, 10) }}</small>
            <span>@if (a.requireRead) { <span [class]="'pill ' + (a.readCount < a.total ? 'amber' : 'green')">已读 {{ a.readCount }}/{{ a.total }}</span> } @else { <span class="pill">无需确认</span> }</span>
          </button>
        } @empty { <p class="muted">还没有公告。@if (!canPublish()) { 项目经理和管理层可以向项目组发布公告。} </p> }
      </div>
      @if (composing()) {
        <section class="pcard">
          <header><h3>发布公告</h3></header>
          <div class="body">
            <label class="fld" style="display: block">标题 <span class="req">*</span><input #t aria-label="公告标题" /></label>
            <label class="fld" style="display: block; margin-top: 10px">内容 <span class="req">*</span><textarea #b aria-label="公告内容"></textarea></label>
            <div class="fld" style="display: block; margin-top: 10px">接收人
              <div class="chips">
                <label class="chip"><input type="radio" name="to" [checked]="toAll()" (change)="toAll.set(true)" /> 全项目组</label>
                <label class="chip"><input type="radio" name="to" [checked]="!toAll()" (change)="toAll.set(false)" aria-label="指定人员" /> 指定人员</label>
              </div>
              @if (!toAll()) { <div class="chips">@for (m of team(); track m.userId) { <label class="chip"><input type="checkbox" [checked]="picked().includes(m.userId)" (change)="pick(m.userId, $any($event.target).checked)" [attr.aria-label]="'接收 ' + m.user?.name" /> {{ m.user?.name }}</label> }</div> }
            </div>
            <label style="display: block; margin-top: 10px; font-size: 14px"><input #r type="checkbox" aria-label="要求已读确认" /> 要求已读确认</label>
            <div class="tools"><span class="sp"></span><button mat-button type="button" (click)="composing.set(false)">取消</button>
              <button mat-flat-button type="button" (click)="publish(t.value, b.value, r.checked)">发布</button></div>
          </div>
        </section>
      } @else if (cur(); as a) {
        <section class="pcard" [attr.data-detail]="a.title">
          <header><h3>{{ a.title }}</h3><span class="sub">{{ a.author }} · {{ a.createdAt.slice(0, 16).replace('T', ' ') }}</span></header>
          <div class="body">
            <p style="margin: 0 0 14px; max-width: 65ch; white-space: pre-line">{{ a.body }}</p>
            @if (a.requireRead) {
              @if (a.forMe && !a.readByMe) { <button mat-flat-button type="button" (click)="read(a)">我已阅读</button> }
              @else if (a.forMe) { <span class="pill green">你已确认阅读</span> }
              @if (a.unread) {
                <div style="margin-top: 14px">已读确认 {{ a.readCount }} / {{ a.total }}</div>
                <div class="track"><i [style.width.%]="a.total ? (a.readCount / a.total) * 100 : 0"></i></div>
                <div class="two">
                  <div><div class="muted" style="font-size: 13px">已读</div><div class="chips">@for (n of a.read; track $index) { <span class="chip">{{ n }}</span> }</div></div>
                  <div><div class="muted" style="font-size: 13px">未读</div><div class="chips">@for (n of a.unread; track $index) { <span class="chip un">{{ n }}</span> } @empty { <span class="muted" style="font-size: 13px">全部已读</span> }</div></div>
                </div>
                @if (a.unread.length && canPublish()) { <div class="tools"><button mat-stroked-button type="button" (click)="remind(a)">提醒未读人员</button>@if (a.remindedAt) { <span class="muted" style="font-size: 12.5px">上次提醒 {{ a.remindedAt.slice(0, 10) }}</span> }</div> }
              }
            } @else { <span class="muted" style="font-size: 13px">这条公告不要求已读确认。</span> }
          </div>
        </section>
      }
    </div>
  `,
})
export class ProjectAnnouncements {
  private readonly api = inject(Api);
  readonly project = input.required<Project>();
  readonly items = signal<AnnouncementRow[]>([]);
  readonly canPublish = signal(false);
  readonly curId = signal<string | null>(null);
  readonly cur = computed(() => this.items().find((a) => a.id === this.curId()) ?? this.items()[0] ?? null);
  readonly composing = signal(false);
  readonly team = signal<Member[]>([]);
  readonly toAll = signal(true);
  readonly picked = signal<string[]>([]);
  readonly error = signal('');
  private base = () => `/projects/${this.project().id}/announcements`;

  async ngOnInit() {
    try {
      const ms = await this.api.get<Member[]>(`/projects/${this.project().id}/members`);
      const seen = new Set<string>();
      this.team.set(ms.filter((m) => !seen.has(m.userId) && !!seen.add(m.userId)));
    } catch { /* 只读 */ }
    await this.load();
  }
  async load() {
    try { const x = await this.api.get<{ canPublish: boolean; items: AnnouncementRow[] }>(this.base()); this.items.set(x.items); this.canPublish.set(x.canPublish); } catch (e) { this.error.set(errorMessage(e, '加载失败')); }
  }
  /** 打开发给我、要求确认的公告时自动记为已读 */
  async open(a: AnnouncementRow) {
    this.composing.set(false);
    this.curId.set(a.id);
    if (a.forMe && !a.readByMe && !a.requireRead) await this.read(a);
  }
  pick(id: string, on: boolean) { this.picked.update((p) => (on ? [...p, id] : p.filter((x) => x !== id))); }
  async publish(title: string, body: string, requireRead: boolean) {
    if (!title.trim() || !body.trim()) { this.error.set('请填写标题和内容'); return; }
    if (!this.toAll() && !this.picked().length) { this.error.set('请选择接收人'); return; }
    this.error.set('');
    try {
      const a = await this.api.post<{ id: string }>(this.base(), { title: title.trim(), body: body.trim(), requireRead, recipients: this.toAll() ? undefined : this.picked() });
      this.composing.set(false); this.picked.set([]); this.toAll.set(true);
      await this.load();
      this.curId.set(a.id);
    } catch (e) { this.error.set(errorMessage(e, '发布失败')); }
  }
  async read(a: AnnouncementRow) {
    try { await this.api.post(`${this.base()}/${a.id}/read`, {}); await this.load(); } catch (e) { this.error.set(errorMessage(e, '操作失败')); }
  }
  async remind(a: AnnouncementRow) {
    try { await this.api.post(`${this.base()}/${a.id}/remind`, {}); await this.load(); } catch (e) { this.error.set(errorMessage(e, '提醒失败')); }
  }
}
