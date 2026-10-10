import { Component, computed, inject, input, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { Api, errorMessage } from '../core/api';
import { Ai } from '../core/ai';
import { AiMark } from './ai-mark';
import { askConfirm } from '../core/dialog';
import {
  MEETING_TYPE_LABELS, Member, MeetingAttendeeRow, MeetingRecurrence, MeetingRow, MeetingType, Project, RECURRENCE_LABELS, RsvpStatus,
} from '../core/models';

interface Stakeholder { id: string; name: string; organization: string; email: string }
interface Ext { name: string; org: string; email: string }
interface Form {
  id: string | null; type: MeetingType; title: string; date: string; start: string; end: string; location: string; link: string;
  recurrence: MeetingRecurrence; agenda: string; materials: string; members: string[]; externals: Ext[];
}
type Tab = 'notice' | 'rsvp' | 'minutes';
const pad = (n: number) => String(n).padStart(2, '0');
const localDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const localTime = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const WEEK = ['日', '一', '二', '三', '四', '五', '六'];
const RSVP: Record<RsvpStatus, [string, string]> = { ACCEPTED: ['参加', 'green'], DECLINED: ['不参加', ''], PENDING: ['未回复', 'amber'] };
const METHOD: Record<string, string> = { SYSTEM: '系统', EMAIL: '邮件', WECHAT: '微信', PHONE: '电话' };
const STATUS: Record<MeetingRow['status'], [string, string]> = { DRAFT: ['未发通知', ''], NOTIFIED: ['已通知', 'blue'], PUBLISHED: ['已发布纪要', 'green'], CANCELLED: ['已取消', ''] };

/** 会议：发起与通知（日历邀请）→ 参会确认 → 纪要（要点、决定、行动项）；例会生成下一次并带出未关闭的行动项 */
@Component({
  selector: 'app-project-meetings',
  imports: [MatButtonModule, AiMark],
  styles: `
    .lay { display: grid; grid-template-columns: 300px minmax(0, 1fr); gap: 16px; align-items: start; }
    @media (max-width: 900px) { .lay { grid-template-columns: 1fr; } }
    .list { display: flex; flex-direction: column; gap: 8px; }
    .mi { text-align: left; border: 1px solid var(--pm-line); background: var(--pm-card); border-radius: 12px; padding: 10px 12px; cursor: pointer; font: inherit; display: flex; flex-direction: column; gap: 3px; }
    .mi[aria-selected=true] { border-color: var(--pm-primary); box-shadow: 0 0 0 1px var(--pm-primary); }
    .mi b { font-size: 14.5px; } .mi small { color: var(--pm-muted); font-size: 12.5px; } .mi .rs { display: flex; gap: 6px; flex-wrap: wrap; }
    nav { display: flex; gap: 2px; border-bottom: 1px solid var(--pm-line); padding: 0 20px; }
    nav button { border: 0; background: none; padding: 9px 12px; font: inherit; color: var(--pm-muted); border-bottom: 2px solid transparent; cursor: pointer; }
    nav button[aria-selected=true] { color: var(--pm-text); font-weight: 700; border-bottom-color: var(--pm-primary); }
    dl.kv { display: grid; grid-template-columns: 90px 1fr; gap: 8px 12px; margin: 0 0 12px; font-size: 14px; } dl.kv dt { color: var(--pm-muted); } dl.kv dd { margin: 0; }
    ol { margin: 0; padding-left: 20px; }
    .tools { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-top: 12px; } .tools .sp { flex: 1; }
    .chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
    .chip { display: inline-flex; gap: 6px; align-items: center; background: var(--pm-bg-2); border-radius: 8px; padding: 4px 10px; font-size: 13.5px; }
    textarea { min-height: 80px; }
    td input, td select { font: inherit; font-size: 13.5px; border: 1px solid var(--pm-line); border-radius: 6px; padding: 4px 6px; width: 100%; box-sizing: border-box; background: #fff; }
    .carry { background: var(--pm-amber-bg); border-radius: 10px; padding: 10px 14px; margin: 0 0 12px; font-size: 14px; }
    .carry li { margin: 2px 0; }
    h4 { margin: 14px 0 6px; font-size: 14px; }
    .aibox { border: 1px dashed var(--pm-primary); border-radius: 10px; padding: 10px 12px; margin: 0 0 12px; }
  `,
  template: `
    @if (error()) { <div class="error" role="alert">{{ error() }}</div> }
    <div class="lay">
      <div class="list">
        <button mat-flat-button type="button" (click)="newMeeting()">+ 发起会议</button>
        @for (m of meetings(); track m.id) {
          <button type="button" class="mi" [attr.aria-selected]="selectedId() === m.id && !form()" (click)="select(m.id)" [attr.data-meeting]="m.title">
            <b>{{ m.title }}</b>
            <small>{{ when(m) }}@if (m.location) { · {{ m.location }} }</small>
            <span class="rs">
              <span class="pill">{{ m.typeLabel }}</span>
              <span [class]="'pill ' + st(m)[1]">{{ st(m)[0] }}</span>
              @if (m.status === 'NOTIFIED') { <span class="pill">确认 {{ m.stats.accepted }}/{{ m.stats.total }}</span> }
              @if (m.openActions) { <span class="pill amber">行动项 {{ m.openActions }} 未关闭</span> }
              @if (m.myResponse === 'PENDING' && m.status === 'NOTIFIED') { <span class="pill amber">待你确认</span> }
            </span>
          </button>
        } @empty { <p class="muted">还没有会议。</p> }
      </div>

      @if (form(); as f) {
        <section class="pcard">
          <header><h3>{{ f.id ? '编辑会议' : '发起会议' }}</h3></header>
          <div class="body">
            <div class="fgrid">
              <label class="fld">类型<select (change)="patch('type', $any($event.target).value)" aria-label="会议类型">@for (t of types; track t[0]) { <option [value]="t[0]" [selected]="t[0] === f.type">{{ t[1] }}</option> }</select></label>
              <label class="fld" style="grid-column: span 2">主题 <span class="req">*</span><input [value]="f.title" (input)="patch('title', $any($event.target).value)" aria-label="会议主题" /></label>
              <label class="fld">日期 <span class="req">*</span><input type="date" [value]="f.date" (change)="patch('date', $any($event.target).value)" aria-label="会议日期" /></label>
              <label class="fld">开始<input type="time" [value]="f.start" (change)="patch('start', $any($event.target).value)" aria-label="开始时间" /></label>
              <label class="fld">结束<input type="time" [value]="f.end" (change)="patch('end', $any($event.target).value)" aria-label="结束时间" /></label>
              <label class="fld">地点<input [value]="f.location" (input)="patch('location', $any($event.target).value)" aria-label="地点" /></label>
              <label class="fld">线上链接<input [value]="f.link" (input)="patch('link', $any($event.target).value)" aria-label="线上链接" /></label>
              @if (f.type === 'REGULAR') { <label class="fld">重复<select (change)="patch('recurrence', $any($event.target).value)" aria-label="重复">@for (r of recs; track r[0]) { <option [value]="r[0]" [selected]="r[0] === f.recurrence">{{ r[1] }}</option> }</select></label> }
            </div>
            <div class="fgrid">
              <label class="fld">议程（每行一项）<textarea [value]="f.agenda" (input)="patch('agenda', $any($event.target).value)" aria-label="议程"></textarea></label>
              <label class="fld">会前资料（文件名或存放位置）<textarea [value]="f.materials" (input)="patch('materials', $any($event.target).value)" aria-label="会前资料"></textarea></label>
            </div>
            <div class="fld" style="display: block">项目组参会人
              <div class="chips">@for (m of team(); track m.userId) { <label class="chip"><input type="checkbox" [checked]="f.members.includes(m.userId)" (change)="toggleMember(m.userId, $any($event.target).checked)" [attr.aria-label]="'参会 ' + m.user?.name" /> {{ m.user?.name }}</label> }</div>
            </div>
            <h4>外部参会人</h4>
            <div class="tblwrap"><table>
              <thead><tr><th>姓名</th><th>单位</th><th>邮箱（发日历邀请）</th><th></th></tr></thead>
              <tbody>
                @for (x of f.externals; track $index; let i = $index) {
                  <tr><td><input [value]="x.name" (change)="setExt(i, 'name', $any($event.target).value)" aria-label="外部姓名" /></td>
                    <td><input [value]="x.org" (change)="setExt(i, 'org', $any($event.target).value)" aria-label="外部单位" /></td>
                    <td><input [value]="x.email" (change)="setExt(i, 'email', $any($event.target).value)" aria-label="外部邮箱" /></td>
                    <td><button mat-button type="button" (click)="removeExt(i)">删除</button></td></tr>
                }
              </tbody>
            </table></div>
            <div class="tools">
              <button mat-button type="button" (click)="addExt()">+ 外部人员</button>
              @if (stakeholders().length) {
                <select (change)="addStakeholder($any($event.target).value); $any($event.target).value = ''" aria-label="从干系人添加"><option value="">从干系人添加…</option>@for (s of stakeholders(); track s.id) { <option [value]="s.id">{{ s.name }}（{{ s.organization }}）</option> }</select>
              }
              <span class="sp"></span>
              <button mat-button type="button" (click)="form.set(null)">取消</button>
              <button mat-flat-button type="button" (click)="saveForm()">保存</button>
            </div>
          </div>
        </section>
      } @else if (cur(); as m) {
        <section class="pcard" [attr.data-detail]="m.title">
          <header><h3>{{ m.title }}</h3><span class="sub grow">组织者 {{ m.organizer }}</span>
            @if (m.canManage && m.status !== 'PUBLISHED' && m.status !== 'CANCELLED') {
              <button mat-button type="button" (click)="edit(m)">编辑</button>
              <button mat-stroked-button type="button" (click)="notify(m)">{{ m.notifiedAt ? '再次发送通知' : '发送通知' }}</button>
            }
          </header>
          <nav role="tablist">@for (t of tabs; track t[0]) { <button type="button" role="tab" [attr.aria-selected]="tab() === t[0]" (click)="tab.set(t[0])">{{ t[1] }}</button> }</nav>
          <div class="body">
            @switch (tab()) {
              @case ('notice') {
                <dl class="kv">
                  <dt>时间</dt><dd>{{ when(m) }}</dd>
                  <dt>地点</dt><dd>{{ m.location || '—' }}@if (m.link) { · <a [href]="m.link" target="_blank" rel="noopener">线上链接</a> }</dd>
                  <dt>类型</dt><dd>{{ m.typeLabel }}@if (m.type === 'REGULAR') { · {{ recLabel(m.recurrence) }}，延续参会人和议程 }</dd>
                  <dt>状态</dt><dd><span [class]="'pill ' + st(m)[1]">{{ st(m)[0] }}</span>@if (m.notifiedAt) { <span class="muted">（{{ m.notifiedAt.slice(0, 10) }} 发出）</span> }</dd>
                  <dt>议程</dt><dd>@if (m.agenda.length) { <ol>@for (a of m.agenda; track $index) { <li>{{ a }}</li> }</ol> } @else { — }</dd>
                  <dt>会前资料</dt><dd>{{ m.materials || '—' }}</dd>
                </dl>
                <div class="tools">
                  @if (m.myResponse && m.status === 'NOTIFIED') {
                    <span>你的回复：<span [class]="'pill ' + rsvp(m.myResponse)[1]">{{ rsvp(m.myResponse)[0] }}</span></span>
                    <button mat-stroked-button type="button" (click)="respond(m, 'ACCEPTED')">参加</button>
                    <button mat-button type="button" (click)="respond(m, 'DECLINED')">不参加</button>
                  }
                  <span class="sp"></span>
                  <button mat-button type="button" (click)="downloadIcs(m)">下载日历文件</button>
                  @if (m.canManage && m.type === 'REGULAR') { <button mat-stroked-button type="button" (click)="next(m)">生成下一次</button> }
                  @if (m.canManage && m.status !== 'PUBLISHED' && m.status !== 'CANCELLED') { <button mat-button type="button" (click)="cancel(m)">取消会议</button> }
                </div>
              }
              @case ('rsvp') {
                <div class="tblwrap"><table>
                  <thead><tr><th>参会人</th><th>单位</th><th>状态</th><th>确认方式</th></tr></thead>
                  <tbody>
                    @for (a of m.attendees; track a.id) {
                      <tr [attr.data-att]="a.name">
                        <td>{{ a.name }}</td><td>{{ a.external ? a.org || '外部' : '本公司' }}</td>
                        <td>
                          @if (a.external && a.response === 'PENDING' && m.canManage) {
                            <span class="pill amber">外部 · 待登记</span>
                            <select (change)="registerExt(m, a, $any($event.target).value)" aria-label="登记确认方式"><option value="">登记确认方式…</option><option value="EMAIL">邮件确认参加</option><option value="WECHAT">微信确认参加</option><option value="PHONE">电话确认参加</option><option value="DECLINED">不参加</option></select>
                          } @else { <span [class]="'pill ' + rsvp(a.response)[1]">{{ rsvp(a.response)[0] }}</span> }
                        </td>
                        <td>{{ method(a.confirmMethod) }}</td>
                      </tr>
                    }
                  </tbody>
                </table></div>
                <div class="tools"><span class="muted" style="font-size: 13px">确认 {{ m.stats.accepted }} / {{ m.stats.total }}，不参加 {{ m.stats.declined }}，未回复 {{ m.stats.pending }}</span><span class="sp"></span>
                  @if (m.canManage && m.status === 'NOTIFIED' && m.stats.pending) { <button mat-stroked-button type="button" (click)="remind(m)">提醒未回复</button> }</div>
              }
              @case ('minutes') {
                @if (m.carryOver?.length) {
                  <div class="carry"><b>上次未关闭的行动项（自动带出）</b>
                    <ul>@for (a of m.carryOver; track a.id) { <li>{{ a.title }} · {{ a.owner ?? '未指定' }}@if (a.overdueDays) { · <span style="color: var(--pm-red)">已逾期 {{ a.overdueDays }} 天</span> } @else if (a.dueDate) { · {{ a.dueDate }} }</li> }</ul>
                  </div>
                }
                @if (m.status === 'PUBLISHED') {
                  <app-ai-mark entity="MEETING" [id]="m.id" />
                  <h4>讨论要点</h4><p style="white-space: pre-line; margin: 0">{{ m.points || '—' }}</p>
                  <h4>决定事项</h4><p style="white-space: pre-line; margin: 0">{{ m.decisions || '—' }}</p>
                  <h4>行动项（已进入「问题与行动」）</h4>
                  <div class="tblwrap"><table><thead><tr><th>内容</th><th>责任人</th><th>期限</th><th>状态</th></tr></thead><tbody>
                    @for (a of m.createdActions ?? []; track a.id) { <tr><td>{{ a.title }}</td><td>{{ a.owner ?? '—' }}</td><td>{{ a.dueDate ?? '—' }}</td><td>{{ a.status === 'CLOSED' ? '已关闭' : '打开' }}</td></tr> }
                    @empty { <tr><td colspan="4" class="muted">没有行动项</td></tr> }
                  </tbody></table></div>
                  <p class="muted" style="font-size: 13px">纪要已于 {{ m.publishedAt?.slice(0, 10) }} 发布。</p>
                } @else if (m.canManage && m.status !== 'CANCELLED') {
                  @if (ai.on('MINUTES')) {
                    <div class="aibox" data-ai="minutes">
                      <label class="fld" style="display: block"><span><span class="pill blue">AI</span> 粘贴会议记录或录音转写文字，AI 整理成要点、决定和行动项草稿</span>
                        <textarea [value]="notes()" (input)="notes.set($any($event.target).value)" aria-label="会议记录原文"></textarea></label>
                      <div class="tools"><span class="sp"></span><button mat-stroked-button type="button" [disabled]="!notes().trim() || aiBusy()" (click)="aiMinutes(m)">{{ aiBusy() ? 'AI 正在整理…' : 'AI 整理' }}</button></div>
                    </div>
                  }
                  <label class="fld" style="display: block">讨论要点<textarea [value]="points()" (input)="points.set($any($event.target).value)" aria-label="讨论要点"></textarea></label>
                  <label class="fld" style="display: block; margin-top: 10px">决定事项<textarea [value]="decisions()" (input)="decisions.set($any($event.target).value)" aria-label="决定事项"></textarea></label>
                  <h4>行动项（发布纪要后进入「问题与行动」）</h4>
                  <div class="tblwrap"><table><thead><tr><th>内容</th><th>责任人</th><th>期限</th><th></th></tr></thead><tbody>
                    @for (a of actions(); track $index; let i = $index) {
                      <tr><td><input [value]="a.title" (change)="setAction(i, 'title', $any($event.target).value)" aria-label="行动项内容" /></td>
                        <td><select (change)="setAction(i, 'ownerId', $any($event.target).value)" aria-label="行动项责任人"><option value="">—</option>@for (p of team(); track p.userId) { <option [value]="p.userId" [selected]="p.userId === a.ownerId">{{ p.user?.name }}</option> }</select></td>
                        <td><input type="date" [value]="a.dueDate ?? ''" (change)="setAction(i, 'dueDate', $any($event.target).value)" aria-label="行动项期限" /></td>
                        <td><button mat-button type="button" (click)="removeAction(i)">删除</button></td></tr>
                    } @empty { <tr><td colspan="4" class="muted">暂无，点“添加行动项”</td></tr> }
                  </tbody></table></div>
                  <div class="tools"><button mat-button type="button" (click)="addAction()">+ 添加行动项</button><span class="sp"></span>
                    <button mat-stroked-button type="button" (click)="saveMinutes(m)">保存草稿</button>
                    <button mat-flat-button type="button" (click)="publish(m)">发布纪要</button></div>
                } @else { <p class="muted">纪要由组织者或项目经理填写。</p> }
              }
            }
          </div>
        </section>
      } @else { <p class="muted">选择左侧会议，或发起新会议。</p> }
    </div>
  `,
})
export class ProjectMeetings {
  private readonly api = inject(Api);
  private readonly route = inject(ActivatedRoute);
  readonly project = input.required<Project>();
  readonly meetings = signal<MeetingRow[]>([]);
  readonly cur = signal<MeetingRow | null>(null);
  readonly selectedId = signal<string | null>(null);
  readonly team = signal<Member[]>([]);
  readonly stakeholders = signal<Stakeholder[]>([]);
  readonly form = signal<Form | null>(null);
  readonly tab = signal<Tab>('notice');
  readonly points = signal('');
  readonly decisions = signal('');
  readonly actions = signal<{ title: string; ownerId?: string; dueDate?: string }[]>([]);
  readonly error = signal('');
  readonly types = Object.entries(MEETING_TYPE_LABELS) as [MeetingType, string][];
  readonly recs = (Object.entries(RECURRENCE_LABELS) as [MeetingRecurrence, string][]).filter((r) => r[0] !== 'NONE');
  readonly tabs: [Tab, string][] = [['notice', '通知'], ['rsvp', '参会确认'], ['minutes', '纪要']];
  readonly teamIds = computed(() => [...new Set(this.team().map((m) => m.userId))]);
  private base = () => `/projects/${this.project().id}/meetings`;
  private draftFor: string | null = null;
  readonly ai = inject(Ai);
  readonly notes = signal('');
  readonly aiBusy = signal(false);
  /** AI 整理后待保存的使用记录 */
  private pendingAi: string | null = null;

  async aiMinutes(m: MeetingRow) {
    this.aiBusy.set(true); this.error.set('');
    try {
      const d = await this.ai.draft<{ points: string[]; decisions: string[]; actions: { title: string; owner: string; dueDate: string }[] }>('MINUTES', {
        notes: this.notes(), attendees: m.attendees.map((a) => a.name), agenda: m.agenda, date: m.startAt.slice(0, 10),
      }, this.project().id);
      this.points.set(d.draft.points.map((x) => `· ${x}`).join('\n'));
      this.decisions.set(d.draft.decisions.map((x) => `· ${x}`).join('\n'));
      this.actions.set(d.draft.actions.map((a) => ({ title: a.title, ownerId: this.team().find((t) => t.user?.name === a.owner)?.userId, dueDate: a.dueDate || undefined })));
      this.pendingAi = d.usageId;
    } catch (e) { this.error.set(errorMessage(e, 'AI 整理失败')); } finally { this.aiBusy.set(false); }
  }
  private async adoptAi(id: string) {
    if (!this.pendingAi) return;
    await this.ai.adopt(this.pendingAi, true, 'MEETING', id);
    this.pendingAi = null;
  }

  async ngOnInit() {
    void this.ai.load();
    const id = this.project().id;
    try {
      const [ms, sh] = await Promise.all([this.api.get<Member[]>(`/projects/${id}/members`), this.api.get<Stakeholder[]>(`/projects/${id}/stakeholders`).catch(() => [])]);
      const seen = new Set<string>();
      this.team.set(ms.filter((m) => m.active !== false && !seen.has(m.userId) && !!seen.add(m.userId)));
      this.stakeholders.set(sh);
    } catch (e) { this.error.set(errorMessage(e, '加载失败')); }
    await this.load(this.route.snapshot.queryParamMap.get('m'));
  }
  async load(select?: string | null) {
    try {
      const ms = await this.api.get<MeetingRow[]>(this.base());
      this.meetings.set(ms);
      const id = select ?? this.selectedId() ?? this.pickDefault(ms);
      if (id) await this.select(id, false); else this.cur.set(null);
    } catch (e) { this.error.set(errorMessage(e, '加载失败')); }
  }
  /** 默认选最近一次还没开完的会议，没有就选最新的 */
  private pickDefault(ms: MeetingRow[]) {
    const now = Date.now();
    const up = ms.filter((m) => Date.parse(m.endAt) >= now && m.status !== 'CANCELLED').sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt));
    return up[0]?.id ?? ms[0]?.id ?? null;
  }
  async select(id: string, resetTab = true) {
    this.form.set(null);
    this.selectedId.set(id);
    if (resetTab) this.tab.set('notice');
    try {
      const m = await this.api.get<MeetingRow>(`${this.base()}/${id}`);
      this.cur.set(m);
      // 重新加载同一个会议时，不覆盖正在填写的纪要草稿
      if (this.draftFor !== id || m.status === 'PUBLISHED') {
        this.points.set(m.points); this.decisions.set(m.decisions); this.actions.set([...(m.actions ?? [])]);
        this.draftFor = id;
      }
    } catch (e) { this.error.set(errorMessage(e, '加载失败')); }
  }

  when(m: MeetingRow) {
    const s = new Date(m.startAt), e = new Date(m.endAt);
    return `${s.getMonth() + 1}月${s.getDate()}日 周${WEEK[s.getDay()]} ${localTime(s)}–${localTime(e)}`;
  }
  st(m: MeetingRow) { return STATUS[m.status]; }
  rsvp(r: RsvpStatus) { return RSVP[r]; }
  method(m: string) { return METHOD[m] ?? '—'; }
  recLabel(r: MeetingRecurrence) { return RECURRENCE_LABELS[r]; }

  // ───── 发起 / 编辑 ─────
  newMeeting() {
    const d = new Date(Date.now() + 86_400_000);
    this.form.set({ id: null, type: 'GENERAL', title: '', date: localDate(d), start: '09:30', end: '10:30', location: '', link: '', recurrence: 'WEEKLY', agenda: '', materials: '', members: this.teamIds(), externals: [] });
  }
  edit(m: MeetingRow) {
    const s = new Date(m.startAt), e = new Date(m.endAt);
    this.form.set({
      id: m.id, type: m.type, title: m.title, date: localDate(s), start: localTime(s), end: localTime(e), location: m.location, link: m.link, recurrence: m.recurrence === 'NONE' ? 'WEEKLY' : m.recurrence,
      agenda: m.agenda.join('\n'), materials: m.materials, members: m.attendees.filter((a) => a.userId).map((a) => a.userId!),
      externals: m.attendees.filter((a) => a.external).map((a) => ({ name: a.name, org: a.org, email: a.email })),
    });
  }
  patch<K extends keyof Form>(k: K, v: Form[K]) { this.form.update((f) => (f ? { ...f, [k]: v } : f)); }
  toggleMember(id: string, on: boolean) { const f = this.form()!; this.patch('members', on ? [...f.members, id] : f.members.filter((x) => x !== id)); }
  addExt() { this.patch('externals', [...this.form()!.externals, { name: '', org: '', email: '' }]); }
  setExt(i: number, k: keyof Ext, v: string) { this.patch('externals', this.form()!.externals.map((x, j) => (j === i ? { ...x, [k]: v } : x))); }
  removeExt(i: number) { this.patch('externals', this.form()!.externals.filter((_, j) => j !== i)); }
  addStakeholder(id: string) {
    const s = this.stakeholders().find((x) => x.id === id);
    if (s) this.patch('externals', [...this.form()!.externals, { name: s.name, org: s.organization, email: s.email ?? '' }]);
  }
  async saveForm() {
    const f = this.form()!;
    if (!f.title.trim() || !f.date || !f.start || !f.end) { this.error.set('请填写主题、日期和时间'); return; }
    const startAt = new Date(`${f.date}T${f.start}`), endAt = new Date(`${f.date}T${f.end}`);
    if (!(endAt > startAt)) { this.error.set('结束时间应晚于开始时间'); return; }
    const body = {
      title: f.title.trim(), startAt: startAt.toISOString(), endAt: endAt.toISOString(), location: f.location, link: f.link,
      agenda: f.agenda.split('\n').map((x) => x.trim()).filter(Boolean), materials: f.materials,
      ...(f.type === 'REGULAR' ? { recurrence: f.recurrence } : {}),
      attendees: [...f.members.map((userId) => ({ userId })), ...f.externals.filter((x) => x.name.trim()).map((x) => ({ name: x.name.trim(), org: x.org.trim(), email: x.email.trim() }))],
    };
    this.error.set('');
    try {
      const r = f.id ? await this.api.patch<MeetingRow>(`${this.base()}/${f.id}`, body) : await this.api.post<MeetingRow>(this.base(), { ...body, type: f.type });
      this.form.set(null);
      await this.load(r.id);
    } catch (e) { this.error.set(errorMessage(e, '保存失败')); }
  }

  // ───── 操作 ─────
  private async run(m: MeetingRow, fn: () => Promise<unknown>, fallback: string) {
    this.error.set('');
    try { await fn(); } catch (e) { this.error.set(errorMessage(e, fallback)); }
    await this.load(m.id);
  }
  notify(m: MeetingRow) { return this.run(m, () => this.api.post(`${this.base()}/${m.id}/notify`, {}), '发送失败'); }
  respond(m: MeetingRow, response: RsvpStatus) { return this.run(m, () => this.api.post(`${this.base()}/${m.id}/rsvp`, { response }), '保存失败'); }
  registerExt(m: MeetingRow, a: MeetingAttendeeRow, v: string) {
    if (!v) return;
    const body = v === 'DECLINED' ? { response: 'DECLINED', method: 'PHONE' } : { response: 'ACCEPTED', method: v };
    return this.run(m, () => this.api.post(`${this.base()}/${m.id}/attendees/${a.id}/rsvp`, body), '登记失败');
  }
  remind(m: MeetingRow) { return this.run(m, () => this.api.post(`${this.base()}/${m.id}/remind`, {}), '提醒失败'); }
  downloadIcs(m: MeetingRow) { return this.api.download(`${this.base()}/${m.id}/ics`, 'meeting.ics').catch((e) => this.error.set(errorMessage(e, '下载失败'))); }
  async next(m: MeetingRow) {
    this.error.set('');
    try { const n = await this.api.post<MeetingRow>(`${this.base()}/${m.id}/next`, {}); await this.load(n.id); } catch (e) { this.error.set(errorMessage(e, '生成失败')); }
  }
  async cancel(m: MeetingRow) { if (await askConfirm(`取消“${m.title}”？已通知的参会人会收到取消通知。`)) return this.run(m, () => this.api.post(`${this.base()}/${m.id}/cancel`, {}), '取消失败'); return undefined; }

  addAction() { this.actions.update((a) => [...a, { title: '' }]); }
  setAction(i: number, k: 'title' | 'ownerId' | 'dueDate', v: string) { this.actions.update((a) => a.map((x, j) => (j === i ? { ...x, [k]: v || undefined } : x))); }
  removeAction(i: number) { this.actions.update((a) => a.filter((_, j) => j !== i)); }
  private minutesBody() { return { points: this.points(), decisions: this.decisions(), actions: this.actions().filter((a) => a.title?.trim()).map((a) => ({ title: a.title.trim(), ownerId: a.ownerId || undefined, dueDate: a.dueDate || undefined })) }; }
  saveMinutes(m: MeetingRow) { return this.run(m, () => this.api.put(`${this.base()}/${m.id}/minutes`, this.minutesBody()), '保存失败').then(() => this.tab.set('minutes')); }
  async publish(m: MeetingRow) {
    this.error.set('');
    try {
      await this.api.put(`${this.base()}/${m.id}/minutes`, this.minutesBody());
      await this.api.post(`${this.base()}/${m.id}/publish`, {});
      await this.adoptAi(m.id);
    } catch (e) { this.error.set(errorMessage(e, '发布失败')); }
    await this.load(m.id);
    this.tab.set('minutes');
  }
}
