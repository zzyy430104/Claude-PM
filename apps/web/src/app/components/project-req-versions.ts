import { Component, computed, inject, input, output, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { Api, errorMessage } from '../core/api';
import {
  PROJECT_TYPE_LABELS, Project, ProjectType, RC_STATUS_LABELS, RequirementChange, RequirementChangeStatus, RequirementVersion, Requirements, emptyRequirements,
} from '../core/models';
import { RequirementsEditor, cleanRequirements } from './requirements-editor';
import { RequirementsView } from './requirements-view';

/**
 * 项目要求（立项批准的时间、交付物、质量、成本）：按版本保存，可对比上一版。
 * 项目经理发起“项目要求变更”，立项批准人批准后生成新版本，计划需要重新批准。
 */
@Component({
  selector: 'app-project-req-versions',
  imports: [MatButtonModule, RequirementsEditor, RequirementsView],
  styles: `
    .bar { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin: 0 0 12px; }
    .bar .grow { flex: 1; }
    .seg { display: inline-flex; border: 1px solid var(--pm-line); border-radius: 10px; background: #fff; padding: 2px; }
    .seg button { border: 0; background: none; font: inherit; font-size: 13px; padding: 4px 10px; border-radius: 8px; cursor: pointer; color: var(--pm-muted); }
    .seg button[aria-pressed=true] { background: var(--pm-primary); color: #fff; }
    .rc-list td { font-size: 13.5px; }
  `,
  template: `
    @if (!project().requirementVersion) {
      <div class="banner">本项目没有经过立项（“小项目免立项”直接建立），没有项目要求版本；下面的细化需求照常使用。</div>
    } @else {
      @if (error()) { <div class="error" role="alert">{{ error() }}</div> }
      <div class="bar">
        @if (previous()) {
          <div class="seg" role="group" aria-label="显示方式">
            <button type="button" [attr.aria-pressed]="!compare()" (click)="compare.set(false)">只看当前 v{{ current()?.version }}</button>
            <button type="button" [attr.aria-pressed]="compare()" (click)="compare.set(true)">对比 v{{ previous()!.version }} → v{{ current()?.version }}</button>
          </div>
        }
        <span class="grow"></span>
        @if (canRequest() && !editing()) { <button mat-stroked-button type="button" (click)="startChange()">发起项目要求变更</button> }
      </div>

      @if (editing(); as ed) {
        <section class="pcard">
          <header><h2>项目要求变更{{ ed.code ? ' ' + ed.code : '' }}</h2><span class="sub">基于当前 v{{ project().requirementVersion }}；只改需要变的项</span></header>
          <div class="body">
            <div class="fgrid">
              <label class="fld">变更原因 <span class="req">*</span><input [value]="reason()" (change)="reason.set($any($event.target).value)" placeholder="如：客户补充协议，首批交期提前" aria-label="变更原因" /></label>
              <label class="fld" style="max-width: 260px">项目类型
                <select [value]="type()" (change)="type.set($any($event.target).value)">@for (t of types; track t) { <option [value]="t" [selected]="t === type()">{{ typeLabel(t) }}</option> }</select></label>
            </div>
            <app-requirements-editor [(value)]="draft" [type]="type()" />
            <div class="bar" style="margin-top: 12px">
              <button mat-flat-button type="button" (click)="saveChange(true)" [disabled]="busy()">提交审批</button>
              <button mat-stroked-button type="button" (click)="saveChange(false)" [disabled]="busy()">保存草稿</button>
              <button mat-button type="button" (click)="editing.set(null)">取消</button>
            </div>
          </div>
        </section>
      }

      @if (current(); as c) {
        <section class="pcard">
          <header>
            <h2>项目要求 v{{ c.version }}</h2>
            <span class="sub">{{ c.approvedAt.slice(0, 10) }} 批准 · {{ c.reason }} · {{ typeLabel(c.data.type ?? project().type ?? 'B') }}</span>
            <span class="grow"></span><span class="sub">只能通过“项目要求变更”修改</span>
          </header>
          <app-requirements-view [value]="c.data" [type]="c.data.type ?? project().type ?? 'B'"
            [before]="compare() ? (previous()?.data ?? null) : null" [beforeType]="previous()?.data?.type ?? null"
            [beforeLabel]="'v' + (previous()?.version ?? '')" [afterLabel]="'v' + c.version + '（当前）'" />
        </section>
      }

      @if (changes().length) {
        <section class="pcard rc-list">
          <header><h3>项目要求变更记录</h3></header>
          <div class="tblwrap">
            <table>
              <thead><tr><th>编号</th><th>原因</th><th>基于</th><th>状态</th><th>审批意见</th><th></th></tr></thead>
              <tbody>
                @for (r of changes(); track r.id) {
                  <tr>
                    <td class="mono">{{ r.code }}</td><td>{{ r.reason }}</td><td>v{{ r.fromVersion }}</td>
                    <td><span class="pill" [class]="pill(r.status)">{{ rcLabel(r.status) }}</span></td>
                    <td class="muted">{{ r.decisionNote ?? '' }}</td>
                    <td>@if (canRequest() && (r.status === 'DRAFT' || r.status === 'REJECTED')) { <button mat-button type="button" (click)="editChange(r)">修改</button> }</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </section>
      }
    }
  `,
})
export class ProjectReqVersions {
  private readonly api = inject(Api);
  readonly project = input.required<Project>();
  readonly changed = output<void>();
  readonly types: ProjectType[] = ['A', 'B', 'C'];
  readonly versions = signal<RequirementVersion[]>([]);
  readonly changes = signal<RequirementChange[]>([]);
  readonly compare = signal(false);
  readonly editing = signal<{ id: string | null; code: string } | null>(null);
  readonly reason = signal('');
  readonly type = signal<ProjectType>('B');
  readonly draft = signal<Requirements>(emptyRequirements());
  readonly error = signal('');
  readonly busy = signal(false);
  readonly current = computed<RequirementVersion | null>(() => this.versions().find((v) => v.version === this.project().requirementVersion) ?? this.versions()[0] ?? null);
  readonly previous = computed(() => { const c = this.current(); return c ? this.versions().find((v) => v.version === c.version - 1) ?? null : null; });
  readonly canRequest = computed(() => !!this.project().permissions?.manage && this.project().status !== 'CLOSED');

  ngOnInit() { void this.load(); }

  async load() {
    if (!this.project().requirementVersion) return;
    try {
      const [v, c] = await Promise.all([
        this.api.get<RequirementVersion[]>(`/projects/${this.project().id}/requirement-versions`),
        this.api.get<RequirementChange[]>(`/projects/${this.project().id}/requirement-changes`),
      ]);
      this.versions.set(v); this.changes.set(c);
      this.compare.set(!!this.previous());
    } catch (e) { this.error.set(errorMessage(e, '加载失败')); }
  }

  typeLabel(t: ProjectType) { return PROJECT_TYPE_LABELS[t]; }
  rcLabel(s: RequirementChangeStatus) { return RC_STATUS_LABELS[s]; }
  pill(s: RequirementChangeStatus) { return { APPROVED: 'green', PENDING: 'amber', REJECTED: 'red', DRAFT: '' }[s]; }

  private fill(data: Requirements & { type?: ProjectType }) {
    const e = emptyRequirements();
    this.draft.set({ ...e, ...structuredClone(data), quality: { ...e.quality, ...data.quality }, cost: { ...e.cost, ...data.cost } });
    this.type.set(data.type ?? this.project().type ?? 'B');
  }
  startChange() {
    const c = this.current();
    if (!c) return;
    this.fill(c.data);
    this.reason.set('');
    this.editing.set({ id: null, code: '' });
  }
  editChange(r: RequirementChange) {
    this.fill(r.data);
    this.reason.set(r.reason);
    this.editing.set({ id: r.id, code: r.code });
  }

  async saveChange(submit: boolean) {
    if (!this.reason().trim()) { this.error.set('请填写变更原因'); return; }
    this.error.set(''); this.busy.set(true);
    const body = { reason: this.reason().trim(), type: this.type(), requirements: cleanRequirements(this.draft(), this.type()) };
    try {
      let id = this.editing()!.id;
      if (id) await this.api.patch(`/requirement-changes/${id}`, body);
      else id = (await this.api.post<RequirementChange>(`/projects/${this.project().id}/requirement-changes`, body)).id;
      if (submit) await this.api.post(`/requirement-changes/${id}/submit`);
      this.editing.set(null);
      await this.load();
      this.changed.emit();
    } catch (e) { this.error.set(errorMessage(e, '保存失败')); } finally { this.busy.set(false); }
  }
}
