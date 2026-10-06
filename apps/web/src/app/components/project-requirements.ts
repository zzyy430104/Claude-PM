import { Component, computed, inject, input, signal } from '@angular/core';
import { FormBuilder, FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { Api, errorMessage } from '../core/api';
import {
  ChangeRequest, Deliverable, Project, REQ_CATEGORY_LABELS, REQ_STATUS_LABELS, Requirement, RequirementCategory, RequirementStatus,
} from '../core/models';
import { approvedScopeChanges } from '../core/scope-change';
import { askConfirm } from '../core/dialog';

const CATEGORIES = Object.keys(REQ_CATEGORY_LABELS) as RequirementCategory[];
const STATUSES = Object.keys(REQ_STATUS_LABELS) as RequirementStatus[];

/** 项目需求（8.1.3.1.1 a、8.1.3.3 a）：每条需求关联交付物，并记录验证方式和验证状态 */
@Component({
  selector: 'app-project-requirements',
  imports: [ReactiveFormsModule, MatButtonModule, MatFormFieldModule, MatInputModule, MatSelectModule],
  styles: `
    .stats { grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); }
    .scope-cr { background: #eef3f9; border: 1px solid #cfdbea; border-radius: var(--pm-radius); padding: 10px 16px 0; margin: 0 0 12px; }
    .scope-cr p { margin: 0 0 6px; font-size: 13px; }
    .gap { color: var(--pm-red); }
    td mat-select { min-width: 140px; }
    .danger { color: var(--pm-red) !important; }
  `,
  template: `
    <div class="stats">
      <div class="stat"><b>{{ reqs().length }}</b><span>需求</span></div>
      <div class="stat" [class.red]="uncovered() > 0"><b>{{ uncovered() }}</b><span>未关联交付物</span></div>
      <div class="stat amber"><b>{{ count('OPEN') }}</b><span>未验证</span></div>
      <div class="stat green"><b>{{ count('VERIFIED') }}</b><span>已验证</span></div>
    </div>
    @if (error()) { <div class="error" role="alert">{{ error() }}</div> }

    @if (canEdit() && project().baselined) {
      <div class="scope-cr">
        <p>计划已批准：新增或删除需求需要引用一项已批准的范围变更；修改验证状态不受限制。</p>
        <mat-form-field style="min-width: 320px">
          <mat-label>依据的范围变更</mat-label>
          <mat-select [formControl]="crControl">
            <mat-option value="">（不引用）</mat-option>
            @for (c of scopeChanges(); track c.id) { <mat-option [value]="c.id">{{ c.code }} {{ c.title }}</mat-option> }
          </mat-select>
        </mat-form-field>
      </div>
    }

    @if (canEdit()) {
      <form class="row" [formGroup]="form" (ngSubmit)="add()">
        <mat-form-field style="width: 110px"><mat-label>编号</mat-label><input matInput formControlName="code" placeholder="R-001" /></mat-form-field>
        <mat-form-field style="min-width: 320px; flex: 1"><mat-label>需求内容</mat-label><input matInput formControlName="title" /></mat-form-field>
        <mat-form-field style="width: 120px">
          <mat-label>类别</mat-label>
          <mat-select formControlName="category">@for (c of categories; track c) { <mat-option [value]="c">{{ catLabel(c) }}</mat-option> }</mat-select>
        </mat-form-field>
        <mat-form-field><mat-label>来源（合同条款、规格书章节）</mat-label><input matInput formControlName="source" /></mat-form-field>
        <mat-form-field><mat-label>验证方式</mat-label><input matInput formControlName="verificationMethod" placeholder="试验 / 检验 / 分析 / 评审" /></mat-form-field>
        <mat-form-field>
          <mat-label>关联交付物</mat-label>
          <mat-select formControlName="deliverableId">
            <mat-option value="">暂不关联</mat-option>
            @for (d of deliverables(); track d.id) { <mat-option [value]="d.id">{{ d.name }}</mat-option> }
          </mat-select>
        </mat-form-field>
        <button mat-flat-button type="submit" [disabled]="form.invalid">添加需求</button>
      </form>
    }

    <table>
      <thead><tr><th>编号</th><th>需求</th><th>类别</th><th>来源</th><th>验证方式</th><th>交付物</th><th>状态</th><th></th></tr></thead>
      <tbody>
        @for (r of reqs(); track r.id) {
          <tr>
            <td>{{ r.code }}</td>
            <td>{{ r.title }}</td>
            <td>{{ catLabel(r.category) }}</td>
            <td>{{ r.source || '—' }}</td>
            <td>{{ r.verificationMethod || '—' }}</td>
            <td>
              @if (canEdit()) {
                <mat-select [value]="r.deliverableId ?? ''" (selectionChange)="patch(r, { deliverableId: $event.value || null })" [attr.aria-label]="'交付物 ' + r.code">
                  <mat-option value="">未关联</mat-option>
                  @for (d of deliverables(); track d.id) { <mat-option [value]="d.id">{{ d.name }}</mat-option> }
                </mat-select>
              } @else {
                @if (deliverableName(r)) { {{ deliverableName(r) }} } @else { <span class="gap">未关联</span> }
              }
            </td>
            <td>
              @if (canEdit()) {
                <mat-select [value]="r.status" (selectionChange)="patch(r, { status: $event.value })" [attr.aria-label]="'状态 ' + r.code">
                  @for (s of statuses; track s) { <mat-option [value]="s">{{ statusLabel(s) }}</mat-option> }
                </mat-select>
              } @else { {{ statusLabel(r.status) }} }
            </td>
            <td>@if (canEdit()) { <button mat-button class="danger" (click)="remove(r)">删除</button> }</td>
          </tr>
        }
      </tbody>
    </table>
    @if (reqs().length === 0) { <p class="muted">还没有登记需求。建议把合同和技术规格书里的要求逐条列出，并关联到负责交付的交付物。</p> }
  `,
})
export class ProjectRequirements {
  private readonly api = inject(Api);
  private readonly fb = inject(FormBuilder).nonNullable;
  readonly project = input.required<Project>();
  readonly reqs = signal<Requirement[]>([]);
  readonly deliverables = signal<Deliverable[]>([]);
  readonly scopeChanges = signal<ChangeRequest[]>([]);
  readonly error = signal('');
  readonly categories = CATEGORIES;
  readonly statuses = STATUSES;
  readonly crControl = new FormControl('', { nonNullable: true });
  readonly canEdit = computed(() => { const p = this.project().permissions; return !!p?.edit?.REQUIREMENTS && this.project().status !== 'CLOSED'; });
  readonly uncovered = computed(() => this.reqs().filter((r) => !r.deliverableId && r.status !== 'NOT_APPLICABLE').length);
  readonly form = this.fb.group({
    code: ['', Validators.required], title: ['', Validators.required], category: ['TECHNICAL' as RequirementCategory],
    source: [''], verificationMethod: [''], deliverableId: [''],
  });

  catLabel(c: RequirementCategory) { return REQ_CATEGORY_LABELS[c]; }
  statusLabel(s: RequirementStatus) { return REQ_STATUS_LABELS[s]; }
  count(s: RequirementStatus) { return this.reqs().filter((r) => r.status === s).length; }
  deliverableName(r: Requirement) { return this.deliverables().find((d) => d.id === r.deliverableId)?.name ?? ''; }

  async ngOnInit() {
    const id = this.project().id;
    this.deliverables.set(await this.api.get<Deliverable[]>(`/projects/${id}/deliverables`));
    if (this.canEdit() && this.project().baselined) this.scopeChanges.set(await approvedScopeChanges(this.api, id));
    await this.load();
  }

  async load() {
    this.reqs.set(await this.api.get<Requirement[]>(`/projects/${this.project().id}/requirements`));
  }

  private async run(fn: () => Promise<unknown>, fallback: string) {
    this.error.set('');
    try { await fn(); } catch (e) { this.error.set(errorMessage(e, fallback)); }
    await this.load();
  }

  add() {
    const v = this.form.getRawValue();
    return this.run(async () => {
      await this.api.post(`/projects/${this.project().id}/requirements`, {
        ...v, deliverableId: v.deliverableId || undefined, changeRequestId: this.crControl.value || undefined,
      });
      this.form.reset({ code: '', title: '', category: v.category, source: '', verificationMethod: '', deliverableId: '' });
    }, '添加失败');
  }

  patch(r: Requirement, body: Partial<Requirement>) {
    return this.run(() => this.api.patch(`/projects/${this.project().id}/requirements/${r.id}`, body), '更新失败');
  }

  async remove(r: Requirement) {
    if (!await askConfirm(`确定删除需求 ${r.code}？`)) return Promise.resolve();
    const cr = this.crControl.value;
    return this.run(() => this.api.delete(`/projects/${this.project().id}/requirements/${r.id}${cr ? `?changeRequestId=${cr}` : ''}`), '删除失败');
  }
}
