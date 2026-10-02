import { Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { Api, errorMessage } from '../core/api';
import { askText } from '../core/i18n';
import {
  INITIATION_STATUS_LABELS, Initiation, InitiationStatus, MyApprovalRoles, RC_STATUS_LABELS, RequirementChange, RequirementChangeStatus,
} from '../core/models';
import { RequirementsView } from '../components/requirements-view';

interface Person { id: string; name: string }
const TABS: { key: string; label: string; statuses?: InitiationStatus[] }[] = [
  { key: 'all', label: '全部' },
  { key: 'draft', label: '草稿', statuses: ['DRAFT', 'WITHDRAWN'] },
  { key: 'cosign', label: '待会签', statuses: ['COSIGN'] },
  { key: 'pending', label: '待审批', statuses: ['PENDING'] },
  { key: 'approved', label: '已批准', statuses: ['APPROVED'] },
  { key: 'rejected', label: '驳回', statuses: ['REJECTED'] },
  { key: 'rc', label: '项目要求变更' },
];

/** 立项管理：立项申请列表；“项目要求变更”页签里审批项目要求的变更 */
@Component({
  selector: 'app-initiations',
  imports: [RouterLink, MatButtonModule, RequirementsView],
  styles: `
    .tp { display: inline-block; font-size: 11.5px; font-weight: 800; border-radius: 6px; padding: 1px 7px; background: var(--pm-blue-bg); color: var(--pm-blue); }
    td.note { color: var(--pm-muted); font-size: 13px; }
    .rc-detail td { background: #fcfbf8; }
    .rc-actions { display: flex; gap: 8px; flex-wrap: wrap; margin: 10px 0 0; }
    .rowlink { background: none; border: 0; color: var(--pm-primary); cursor: pointer; text-decoration: underline; font: inherit; padding: 0; }
  `,
  template: `
    <div class="page">
      <div class="head">
        <div><h1>立项管理</h1><p class="lead">立项申请批准后生成项目；项目要求的变更也在这里审批。</p></div>
        @if (roles()?.initiator) {
          <div class="actions"><a mat-flat-button routerLink="/initiations/new">+ 新建立项申请</a></div>
        }
      </div>
      <nav class="stabs" role="tablist" aria-label="立项分类">
        @for (t of tabs; track t.key) {
          <button type="button" role="tab" [attr.aria-selected]="tab() === t.key" (click)="go(t.key)">{{ t.label }}@if (count(t.key); as n) { （{{ n }}）}</button>
        }
      </nav>
      @if (error()) { <div class="error" role="alert">{{ error() }}</div> }

      @if (tab() !== 'rc') {
        <div class="pcard">
          <div class="tblwrap">
            <table>
              <thead><tr><th>编号</th><th>项目名称</th><th>类型</th><th>申请人</th><th>提交</th><th>状态</th><th>说明</th></tr></thead>
              <tbody>
                @for (i of shown(); track i.id) {
                  <tr>
                    <td class="mono">{{ i.code }}</td>
                    <td><a [routerLink]="['/initiations', i.id]">{{ i.name }}</a></td>
                    <td><span class="tp">{{ i.type }}</span></td>
                    <td>{{ person(i.applicantId) }}</td>
                    <td>{{ i.submittedAt?.slice(5, 10) ?? '—' }}</td>
                    <td><span class="pill" [class]="pillClass(i.status)">{{ statusLabel(i.status) }}</span></td>
                    <td class="note">{{ note(i) }}</td>
                  </tr>
                }
                @if (!shown().length) { <tr><td colspan="7" class="muted">暂无立项申请。</td></tr> }
              </tbody>
            </table>
          </div>
        </div>
      } @else {
        <p class="lead">项目要求变更由项目经理在项目的「计划 → 项目要求与需求」里发起，立项批准人在这里审批。批准后生成新的项目要求版本，项目计划需要重新批准。</p>
        <div class="pcard">
          <div class="tblwrap">
            <table>
              <thead><tr><th>编号</th><th>项目</th><th>原因</th><th>申请人</th><th>状态</th><th></th></tr></thead>
              <tbody>
                @for (c of changes(); track c.id) {
                  <tr>
                    <td class="mono">{{ c.code }}</td>
                    <td>@if (c.project) { <a [routerLink]="['/projects', c.project.id]" [queryParams]="{ g: 'plan', s: 'requirements' }">{{ c.project.code }} {{ c.project.name }}</a> }</td>
                    <td>{{ c.reason }}</td>
                    <td>{{ person(c.applicantId) }}</td>
                    <td><span class="pill" [class]="rcPill(c.status)">{{ rcLabel(c.status) }}</span></td>
                    <td><button type="button" class="rowlink" (click)="toggle(c)">{{ openId() === c.id ? '收起' : '查看' }}</button></td>
                  </tr>
                  @if (openId() === c.id && detail(); as d) {
                    <tr class="rc-detail">
                      <td colspan="6">
                        <app-requirements-view [value]="d.data" [type]="d.data.type ?? d.project?.type ?? 'B'" [before]="d.current ?? null" [beforeType]="d.current?.type ?? null"
                          [beforeLabel]="'v' + d.fromVersion + '（当前）'" [afterLabel]="'变更后'" />
                        @if ((d.data.type ?? d.project?.type) !== (d.current?.type ?? d.project?.type)) {
                          <p>项目类型：{{ d.current?.type ?? d.project?.type }} 类 → <b>{{ d.data.type }} 类</b>（批准后补上新类型需要的阶段）</p>
                        }
                        @if (d.decisionNote) { <p class="muted">审批意见：{{ d.decisionNote }}</p> }
                        @if (d.can?.decide) {
                          <div class="rc-actions">
                            <button mat-flat-button type="button" (click)="decideRc(d, true)">批准变更</button>
                            <button mat-stroked-button type="button" (click)="decideRc(d, false)">驳回</button>
                          </div>
                        }
                      </td>
                    </tr>
                  }
                }
                @if (!changes().length) { <tr><td colspan="6" class="muted">暂无项目要求变更。</td></tr> }
              </tbody>
            </table>
          </div>
        </div>
      }
    </div>
  `,
})
export class InitiationsPage {
  private readonly api = inject(Api);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  readonly tabs = TABS;
  readonly list = signal<Initiation[]>([]);
  readonly changes = signal<RequirementChange[]>([]);
  readonly people = signal<Person[]>([]);
  readonly roles = signal<MyApprovalRoles | null>(null);
  readonly error = signal('');
  readonly detail = signal<RequirementChange | null>(null);
  readonly openId = signal<string | null>(null);
  private readonly query = toSignal(this.route.queryParamMap);
  readonly tab = computed(() => {
    const t = this.query()?.get('tab') ?? 'all';
    return TABS.some((x) => x.key === t) ? t : 'all';
  });
  readonly shown = computed(() => {
    const st = TABS.find((t) => t.key === this.tab())?.statuses;
    return st ? this.list().filter((i) => st.includes(i.status)) : this.list();
  });

  constructor() { void this.load(); }

  async load() {
    try {
      const [list, people, roles] = await Promise.all([
        this.api.get<Initiation[]>('/initiations'),
        this.api.get<Person[]>('/users/directory'),
        this.api.get<MyApprovalRoles>('/approval-roles/mine'),
      ]);
      this.list.set(list); this.people.set(people); this.roles.set(roles);
      this.changes.set(await this.api.get<RequirementChange[]>('/requirement-changes').catch(() => []));
      const id = this.query()?.get('id');
      if (this.tab() === 'rc' && id) await this.open(id);
    } catch (e) { this.error.set(errorMessage(e, '加载失败')); }
  }

  go(tab: string) { void this.router.navigate([], { relativeTo: this.route, queryParams: { tab: tab === 'all' ? null : tab }, replaceUrl: true }); }
  count(key: string) {
    if (key === 'rc') return this.changes().filter((c) => c.status === 'PENDING').length;
    const st = TABS.find((t) => t.key === key)?.statuses;
    return key === 'cosign' || key === 'pending' ? this.list().filter((i) => st!.includes(i.status)).length : 0;
  }
  person(id: string | null) { return this.people().find((p) => p.id === id)?.name ?? '—'; }
  statusLabel(s: InitiationStatus) { return INITIATION_STATUS_LABELS[s]; }
  pillClass(s: InitiationStatus) { return { APPROVED: 'green', PENDING: 'amber', COSIGN: 'amber', REJECTED: 'red', DRAFT: '', WITHDRAWN: '' }[s]; }
  rcLabel(s: RequirementChangeStatus) { return RC_STATUS_LABELS[s]; }
  rcPill(s: RequirementChangeStatus) { return { APPROVED: 'green', PENDING: 'amber', REJECTED: 'red', DRAFT: '' }[s]; }
  note(i: Initiation) {
    if (i.status === 'APPROVED') return '已生成项目';
    if (i.status === 'REJECTED') return `驳回：${i.decisionNote ?? ''}`;
    if (i.status === 'COSIGN') return `已会签 ${i.opinions.length} 人`;
    if (i.status === 'PENDING') return i.opinions.length ? '会签已完成' : '';
    return '';
  }

  async toggle(c: RequirementChange) {
    if (this.openId() === c.id) { this.openId.set(null); return; }
    await this.open(c.id);
  }
  async open(id: string) {
    try {
      this.detail.set(await this.api.get<RequirementChange>(`/requirement-changes/${id}`));
      this.openId.set(id);
    } catch (e) { this.error.set(errorMessage(e, '加载失败')); }
  }
  async decideRc(c: RequirementChange, approve: boolean) {
    const note = await askText(approve ? '审批意见（可不填）' : '驳回理由');
    if (note === null || (!approve && !note.trim())) return;
    this.error.set('');
    try {
      await this.api.post(`/requirement-changes/${c.id}/${approve ? 'approve' : 'reject'}`, note.trim() ? { note: note.trim() } : {});
      this.changes.set(await this.api.get<RequirementChange[]>('/requirement-changes'));
      await this.open(c.id);
    } catch (e) { this.error.set(errorMessage(e, '操作失败')); }
  }
}
