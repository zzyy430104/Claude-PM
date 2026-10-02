import { Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { Api } from '../core/api';
import { AuthService } from '../core/auth.service';
import { Dashboard, MeetingRow, Todo } from '../core/models';
import { I18n } from '../core/i18n';

const HEALTH = { RED: '告警', AMBER: '关注', GREEN: '正常' } as const;
const TAG: Record<string, string> = { CHANGE_APPROVAL: '审批', GATE_REVIEW: '评审', NONCONFORMITY: '不符合项', TRAINING: '培训' };

@Component({
  selector: 'app-home',
  imports: [RouterLink],
  styles: `
    .dot3 { display: inline-block; width: 12px; height: 12px; border-radius: 50%; background: var(--pm-green); }
    .dot3.RED { background: var(--pm-red); } .dot3.AMBER { background: var(--pm-amber); }
    .idx { font-size: 11.5px; color: var(--pm-muted); margin-top: 2px; white-space: nowrap; }
    .reasons { font-size: 12px; color: var(--pm-muted); margin-top: 4px; }
    .todo { list-style: none; margin: 0; padding: 0; }
    .todo li { padding: 10px 0; border-bottom: 1px solid var(--pm-line); }
    .todo li:last-child { border-bottom: 0; }
    .wb { display: grid; grid-template-columns: repeat(auto-fit, minmax(380px, 1fr)); gap: 16px; margin: 0 0 8px; }
    .wb .pcard { margin: 0; } .wb .body { padding-top: 4px; padding-bottom: 4px; }
    ul.body { padding: 4px 20px; } .meet li.muted { display: block; }
    @media (max-width: 760px) { .wb { grid-template-columns: 1fr; } ul.body { padding: 4px 14px; } }
    .todo small { color: var(--pm-muted); } .todo small.late { color: var(--pm-red); } .todo small.soon { color: var(--pm-amber); }
    .meet { list-style: none; margin: 0; padding: 0; }
    .meet li { display: grid; grid-template-columns: 52px minmax(0, 1fr); gap: 12px; padding: 10px 0; border-bottom: 1px solid var(--pm-line); }
    .meet li:last-child { border-bottom: 0; }
    .meet .d { text-align: center; } .meet .d b { display: block; font-size: 20px; } .meet .d small, .meet small { color: var(--pm-muted); font-size: 12.5px; display: block; }
    .meet .rs { display: flex; gap: 8px; align-items: center; margin-top: 4px; }
    .lnk { border: 0; background: none; color: var(--pm-primary); cursor: pointer; font: inherit; font-size: 13px; padding: 0; text-decoration: underline; }
    .bar { height: 6px; background: #e4e9f0; border-radius: 3px; width: 90px; margin-top: 6px; overflow: hidden; }
    .bar i { display: block; height: 100%; background: var(--pm-accent); }
  `,
  template: `
    <div class="page">
      <h1>{{ i18n.t('欢迎，') }}{{ i18n.lang() === 'en' ? ' ' : '' }}{{ auth.user()?.name }}</h1>
      @if (!auth.hasRole('PLATFORM_ADMIN')) {
        <div class="wb">
          <section class="pcard" data-box="pending">
            <header><h3>{{ i18n.t('待我处理') }}</h3><span class="sub">{{ pending().length }}</span></header>
            <ul class="todo body">
              @for (t of pending(); track $index) {
                <li><span class="pill">{{ i18n.t(t.tag) }}</span> <a [href]="t.link" (click)="go($event, t.link)">{{ t.title }}</a>@if (t.sub) { <small> · {{ t.sub }}</small> }</li>
              } @empty { <li class="muted">{{ i18n.t('没有待处理的事项') }}</li> }
            </ul>
          </section>
          <section class="pcard" data-box="meetings">
            <header><h3>{{ i18n.t('近期会议') }}</h3></header>
            <ul class="meet body">
              @for (m of meetings(); track m.id) {
                <li [attr.data-meeting]="m.title">
                  <div class="d"><b>{{ day(m.startAt) }}</b><small>周{{ week(m.startAt) }}</small></div>
                  <div><a [href]="meetingLink(m)" (click)="go($event, meetingLink(m))">{{ m.title }}</a>
                    <small>{{ time(m.startAt) }}–{{ time(m.endAt) }}@if (m.location) { · {{ m.location }} } · {{ m.project?.code }} · {{ m.stats.total }} 人</small>
                    <div class="rs">
                      @if (m.myResponse === 'PENDING') { <span class="pill amber">{{ i18n.t('待你确认') }}</span>
                        <button type="button" class="lnk" (click)="rsvp(m, 'ACCEPTED')">{{ i18n.t('参加') }}</button><button type="button" class="lnk" (click)="rsvp(m, 'DECLINED')">{{ i18n.t('不参加') }}</button>
                      } @else if (m.myResponse === 'ACCEPTED') { <span class="pill green">{{ i18n.t('已确认') }}</span> } @else { <span class="pill">{{ i18n.t('不参加') }}</span> }
                    </div>
                  </div>
                </li>
              } @empty { <li class="muted">{{ i18n.t('近两周没有会议') }}</li> }
            </ul>
          </section>
          <section class="pcard" data-box="actions">
            <header><h3>{{ i18n.t('我的行动项') }}</h3><span class="sub">{{ actions().length }}</span></header>
            <ul class="todo body">
              @for (t of actions(); track $index) {
                <li><a [href]="t.link" (click)="go($event, t.link)">{{ t.projectCode }}</a> · {{ t.title }}@if (t.dueDate) { <small [class.late]="t.dueDate < today"> · {{ t.dueDate }}{{ t.dueDate < today ? ' ' + i18n.t('已逾期') : '' }}</small> }</li>
              } @empty { <li class="muted">{{ i18n.t('没有未关闭的行动项') }}</li> }
            </ul>
          </section>
          <section class="pcard" data-box="wps">
            <header><h3>{{ i18n.t('我负责的工作包') }}</h3><span class="sub">{{ wps().length }}</span></header>
            <ul class="todo body">
              @for (t of wps(); track $index) {
                <li><a [href]="t.link" (click)="go($event, t.link)">{{ t.projectCode }}</a> · {{ t.title }}@if (t.dueDate) { <small [class.late]="t.dueDate < today" [class.soon]="t.dueDate >= today && t.dueDate <= weekEnd"> · {{ i18n.t('计划完成') }} {{ t.dueDate }}</small> }</li>
              } @empty { <li class="muted">{{ i18n.t('没有进行中的工作包') }}</li> }
            </ul>
          </section>
        </div>
        @if (data(); as d) {
          <h2>{{ i18n.t('项目组合') }}</h2>
          <div class="stats">
            <div class="stat"><b>{{ d.totals.projects }}</b><span>{{ i18n.t('项目') }}</span></div>
            <div class="stat red"><b>{{ d.totals.red }}</b><span>{{ i18n.t('告警') }}</span></div>
            <div class="stat amber"><b>{{ d.totals.amber }}</b><span>{{ i18n.t('关注') }}</span></div>
            <div class="stat green"><b>{{ d.totals.green }}</b><span>{{ i18n.t('正常') }}</span></div>
          </div>
          <div class="tbl">
          <table>
            <thead><tr><th>{{ i18n.t('健康度') }}</th><th>{{ i18n.t('项目') }}</th><th>{{ i18n.t('质量') }}</th><th>{{ i18n.t('进度') }}</th><th>{{ i18n.t('成本') }}</th><th>{{ i18n.t('当前阶段') }}</th><th>{{ i18n.t('完成') }}</th><th>{{ i18n.t('预计完工') }}</th><th>{{ i18n.t('未关闭问题') }}</th></tr></thead>
            <tbody>
              @for (p of d.projects; track p.id) {
                <tr>
                  <td><span [class]="'badge ' + p.health">{{ i18n.t(healthLabel[p.health]) }}</span><div class="reasons">{{ reasonText(p.reasons) }}</div></td>
                  <td><a [routerLink]="['/projects', p.id]">{{ p.code }}</a> {{ p.name }}</td>
                  <td><span [class]="'dot3 ' + (p.triangle?.quality ?? 'GREEN')" [attr.title]="i18n.t('质量')"></span></td>
                  <td><span [class]="'dot3 ' + (p.triangle?.schedule ?? 'GREEN')"></span><div class="idx">SPI {{ p.spi ?? '—' }}</div></td>
                  <td><span [class]="'dot3 ' + (p.triangle?.cost ?? 'GREEN')"></span><div class="idx">CPI {{ p.cpi ?? '—' }}</div></td>
                  <td>{{ p.activePhase ? i18n.t(p.activePhase) : '—' }}</td>
                  <td>{{ p.progress.actual }}% / {{ p.progress.planned }}%<div class="bar"><i [style.width.%]="p.progress.actual"></i></div></td>
                  <td style="white-space: nowrap">{{ p.progress.projectedEnd }}</td>
                  <td>{{ p.openIssues }}</td>
                </tr>
              }
            </tbody>
          </table>
          </div>
          @if (d.projects.length === 0) { <p>{{ i18n.t('暂无可见的项目。') }}</p> }
        }
      }
    </div>
  `,
})
export class HomePage {
  private readonly api = inject(Api);
  readonly auth = inject(AuthService);
  readonly i18n = inject(I18n);
  readonly data = signal<Dashboard | null>(null);
  readonly todos = signal<Todo[]>([]);
  readonly healthLabel = HEALTH;
  readonly hasProjects = computed(() => (this.data()?.projects.length ?? 0) > 0);

  /** 健康度原因是服务端生成的中文句子，英文界面下经词典翻译；翻不了的保持原文 */
  reasonText(rs: string[]) { return rs.map((r) => this.i18n.t(r)).join(' · '); }

  private readonly router = inject(Router);
  readonly meetings = signal<(MeetingRow & { project?: { id: string; code: string; name: string }; projectId: string })[]>([]);
  readonly extra = signal<{ tag: string; title: string; link: string; sub?: string }[]>([]);
  readonly today = new Date().toISOString().slice(0, 10);
  readonly weekEnd = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
  readonly actions = computed(() => this.todos().filter((t) => t.kind === 'ISSUE'));
  readonly wps = computed(() => this.todos().filter((t) => t.kind === 'WORK_PACKAGE'));
  /** 待我处理：审批、关口评审、不符合项措施、培训、待确认会议、待读公告、@我的讨论、待接收的交接 */
  readonly pending = computed(() => [
    ...this.todos().filter((t) => t.kind !== 'ISSUE' && t.kind !== 'WORK_PACKAGE').map((t) => ({ tag: TAG[t.kind] ?? '待办', title: t.title, link: t.link, sub: t.projectCode + (t.dueDate ? ' · ' + t.dueDate : '') })),
    ...this.meetings().filter((m) => m.myResponse === 'PENDING').map((m) => ({ tag: '会议', title: `请确认是否参加：${m.title}`, link: this.meetingLink(m), sub: `${m.project?.code ?? ''} · ${this.day(m.startAt)} ${this.time(m.startAt)}` })),
    ...this.extra(),
  ]);

  async ngOnInit() {
    if (this.auth.hasRole('PLATFORM_ADMIN')) return;
    const [d, todos, meetings, ann, mentions, handovers] = await Promise.all([
      this.api.get<Dashboard>('/dashboard'),
      this.api.get<Todo[]>('/me/todos'),
      this.api.get<(MeetingRow & { projectId: string })[]>('/meetings/mine').catch(() => []),
      this.api.get<{ id: string; title: string; project?: { id: string; code: string } }[]>('/announcements/unread').catch(() => []),
      this.api.get<{ id: string; body: string; author: string; project: string; link: string; createdAt: string }[]>('/me/mentions').catch(() => []),
      this.api.get<{ projectId: string; project?: { code: string; name: string }; status: string }[]>('/handovers/mine').catch(() => []),
    ]);
    this.data.set(d);
    this.todos.set(todos);
    this.meetings.set(meetings);
    const recent = new Date(Date.now() - 7 * 86_400_000).toISOString();
    this.extra.set([
      ...ann.map((a) => ({ tag: '公告', title: `请阅读并确认：${a.title}`, link: `/projects/${a.project?.id}?g=comm&s=announcements`, sub: a.project?.code })),
      ...mentions.filter((m) => m.createdAt >= recent).map((m) => ({ tag: '@我', title: `${m.author}：${m.body}`, link: m.link, sub: m.project })),
      ...handovers.filter((h) => h.status === 'PENDING').map((h) => ({ tag: '交接', title: `确认接收售后交接：${h.project?.code} ${h.project?.name}`, link: '/handovers' })),
    ]);
  }

  go(e: Event, link: string) { e.preventDefault(); void this.router.navigateByUrl(link); }
  meetingLink(m: { projectId: string; id: string }) { return `/projects/${m.projectId}?g=comm&s=meetings&m=${m.id}`; }
  day(iso: string) { const d = new Date(iso); return `${d.getMonth() + 1}/${d.getDate()}`; }
  week(iso: string) { return '日一二三四五六'[new Date(iso).getDay()]; }
  time(iso: string) { const d = new Date(iso); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; }
  async rsvp(m: { projectId: string; id: string }, response: 'ACCEPTED' | 'DECLINED') {
    try {
      await this.api.post(`/projects/${m.projectId}/meetings/${m.id}/rsvp`, { response });
      this.meetings.set(await this.api.get<(MeetingRow & { projectId: string })[]>('/meetings/mine'));
    } catch { /* 忽略 */ }
  }
}
