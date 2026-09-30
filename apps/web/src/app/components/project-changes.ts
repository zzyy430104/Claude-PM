import { Component, computed, inject, input, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { DatePipe } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { Api, errorMessage } from '../core/api';
import { AuthService } from '../core/auth.service';
import { CHANGE_STATUS_LABELS, CHANGE_TYPE_LABELS, ChangeRequest, ChangeType, Project } from '../core/models';

interface HistoryRow { id: string; action: string; createdAt: string; actorId: string | null }

@Component({
  selector: 'app-project-changes',
  imports: [ReactiveFormsModule, DatePipe, MatButtonModule, MatFormFieldModule, MatInputModule, MatSelectModule],
  styles: `.cr { border: 1px solid var(--mat-sys-outline-variant); border-radius: 8px; padding: 12px 16px; margin: 12px 0; } h3 { margin: 0 0 4px; } .meta { color: var(--mat-sys-on-surface-variant); font-size: 13px; } .hist { font-size: 12px; color: var(--mat-sys-on-surface-variant); }`,
  template: `
    <h2>提交变更申请</h2>
    <form [formGroup]="form" (ngSubmit)="create()">
      <div class="row">
        <mat-form-field><mat-label>类型</mat-label>
          <mat-select formControlName="type">@for (t of types; track t) { <mat-option [value]="t">{{ typeLabels[t] }}</mat-option> }</mat-select>
        </mat-form-field>
        <mat-form-field style="min-width: 260px"><mat-label>标题</mat-label><input matInput formControlName="title" /></mat-form-field>
        @if (form.controls.type.value === 'BUDGET') { <mat-form-field><mat-label>新预算</mat-label><input matInput type="number" formControlName="budget" /></mat-form-field> }
        @if (form.controls.type.value === 'DELIVERY_DATE') { <mat-form-field><mat-label>新客户交期</mat-label><input matInput type="date" formControlName="customerDeliveryDate" /></mat-form-field> }
        @if (form.controls.type.value === 'SCHEDULE') { <mat-form-field><mat-label>新结束日期</mat-label><input matInput type="date" formControlName="endDate" /></mat-form-field> }
      </div>
      <mat-form-field style="width: 100%"><mat-label>变更内容</mat-label><textarea matInput formControlName="description"></textarea></mat-form-field>
      <mat-form-field style="width: 100%"><mat-label>变更原因</mat-label><textarea matInput formControlName="reason"></textarea></mat-form-field>
      <mat-form-field style="width: 100%"><mat-label>影响分析（含风险与机会）</mat-label><textarea matInput formControlName="impactAnalysis"></textarea></mat-form-field>
      <mat-form-field style="width: 100%"><mat-label>原因分析（由故障引起时必填）</mat-label><textarea matInput formControlName="causeAnalysis"></textarea></mat-form-field>
      <label><input type="checkbox" formControlName="triggeredByFailure" /> 由故障 / 不合格引起</label>
      @if (form.controls.type.value === 'TECHNICAL') {
        <div class="row">
          <mat-form-field><mat-label>对已交付部件的影响</mat-label><input matInput formControlName="deliveredParts" /></mat-form-field>
          <mat-form-field><mat-label>对客户规格与配置的影响</mat-label><input matInput formControlName="customerSpec" /></mat-form-field>
          <mat-form-field><mat-label>需更新的文件</mat-label><input matInput formControlName="documents" /></mat-form-field>
          <mat-form-field><mat-label>技术要求再评估</mat-label><input matInput formControlName="requirements" /></mat-form-field>
          <mat-form-field><mat-label>再验证活动</mat-label><input matInput formControlName="revalidation" /></mat-form-field>
        </div>
      }
      <button mat-flat-button type="submit" [disabled]="form.invalid">保存为草稿</button>
    </form>
    @if (error()) { <div class="error" role="alert">{{ error() }}</div> }

    <h2>变更申请</h2>
    @for (c of rows(); track c.id) {
      <div class="cr">
        <h3>{{ c.code }} · {{ c.title }}（{{ typeLabels[c.type] }}）— {{ statusLabels[c.status] }}</h3>
        <div class="meta">{{ c.description }}｜原因：{{ c.reason }}</div>
        @if (c.impactAnalysis) { <div class="meta">影响分析：{{ c.impactAnalysis }}</div> }
        @if (c.proposed) { <div class="meta">拟变更：{{ proposed(c) }}</div> }
        @if (c.type === 'DELIVERY_DATE') {
          <div class="meta">已通知客户：{{ c.customerNotifiedAt ? (c.customerNotifiedAt | date: 'yyyy-MM-dd') : '否' }}；客户同意：{{ c.customerAgreedAt ? (c.customerAgreedAt | date: 'yyyy-MM-dd') : '否' }}</div>
        }
        @if (c.decisionNote) { <div class="meta">审批意见：{{ c.decisionNote }}</div> }
        @if (c.effectivenessNote) { <div class="meta">有效性验证：{{ c.effectivenessNote }}</div> }
        <div>
          @if (c.status === 'DRAFT' && (c.requestedById === me()?.id || manage())) { <button mat-button (click)="act(c, 'submit')">提交审批</button> }
          @if (c.status === 'SUBMITTED' || c.status === 'APPROVED') {
            @if (manage() && c.type === 'DELIVERY_DATE') {
              <button mat-button (click)="act(c, 'customer-contact', {})">记录已通知客户</button>
              <button mat-button (click)="act(c, 'customer-contact', { agreed: true })">记录客户已同意</button>
            }
          }
          @if (c.status === 'SUBMITTED' && canApprove(c)) {
            <button mat-button (click)="act(c, 'approve', {})">批准</button>
            <button mat-button (click)="reject(c)">驳回</button>
          }
          @if (c.status === 'APPROVED' && manage()) { <button mat-button (click)="act(c, 'implement')">实施</button> }
          @if (c.status === 'IMPLEMENTED' && (manage() || quality()) && c.implementedById !== me()?.id) { <button mat-button (click)="verify(c)">验证有效性</button> }
          @if (c.status === 'VERIFIED' && manage()) { <button mat-button (click)="act(c, 'close')">关闭</button> }
          <button mat-button (click)="toggleHistory(c)">{{ history()[c.id] ? '收起记录' : '变更记录' }}</button>
        </div>
        @if (history()[c.id]; as h) {
          @for (x of h; track x.id) { <div class="hist">{{ x.createdAt | date: 'yyyy-MM-dd HH:mm' }} · {{ x.action }}</div> }
        }
      </div>
    }
    @if (rows().length === 0) { <p>暂无变更申请。</p> }
  `,
})
export class ProjectChanges {
  private readonly api = inject(Api);
  private readonly auth = inject(AuthService);
  private readonly fb = inject(FormBuilder).nonNullable;
  readonly project = input.required<Project>();
  readonly types = Object.keys(CHANGE_TYPE_LABELS) as ChangeType[];
  readonly typeLabels = CHANGE_TYPE_LABELS;
  readonly statusLabels = CHANGE_STATUS_LABELS;
  readonly rows = signal<ChangeRequest[]>([]);
  readonly history = signal<Record<string, HistoryRow[]>>({});
  readonly error = signal('');
  readonly me = this.auth.user;
  readonly manage = computed(() => !!this.project().permissions?.manage);
  readonly quality = computed(() => !!this.project().permissions?.quality);
  readonly form = this.fb.group({
    type: ['SCOPE' as ChangeType], title: ['', [Validators.required, Validators.minLength(2)]],
    description: ['', Validators.required], reason: ['', Validators.required],
    impactAnalysis: [''], causeAnalysis: [''], triggeredByFailure: [false],
    budget: [null as number | null], customerDeliveryDate: [''], endDate: [''],
    deliveredParts: [''], customerSpec: [''], documents: [''], requirements: [''], revalidation: [''],
  });

  canApprove(c: ChangeRequest) {
    const p = this.project().permissions;
    return !!(p?.ccb || p?.topManagement) && c.requestedById !== this.me()?.id;
  }
  proposed(c: ChangeRequest) {
    const p = c.proposed ?? {};
    return [p.budget !== undefined && `预算 ${p.budget}`, p.customerDeliveryDate && `客户交期 ${p.customerDeliveryDate}`, p.startDate && `开始 ${p.startDate}`, p.endDate && `结束 ${p.endDate}`].filter(Boolean).join('，');
  }

  async ngOnInit() { await this.load(); }
  async load() { this.rows.set(await this.api.get<ChangeRequest[]>(`/projects/${this.project().id}/changes`)); }

  private async run(fn: () => Promise<unknown>, fallback: string) {
    this.error.set('');
    try { await fn(); } catch (e) { this.error.set(errorMessage(e, fallback)); }
    await this.load();
  }

  create() {
    const v = this.form.getRawValue();
    const proposed = {
      ...(v.type === 'BUDGET' && v.budget !== null ? { budget: v.budget } : {}),
      ...(v.type === 'DELIVERY_DATE' && v.customerDeliveryDate ? { customerDeliveryDate: v.customerDeliveryDate } : {}),
      ...(v.type === 'SCHEDULE' && v.endDate ? { endDate: v.endDate } : {}),
    };
    const technicalImpact = v.type === 'TECHNICAL'
      ? { deliveredParts: v.deliveredParts, customerSpec: v.customerSpec, documents: v.documents, requirements: v.requirements, revalidation: v.revalidation }
      : undefined;
    return this.run(async () => {
      await this.api.post(`/projects/${this.project().id}/changes`, {
        type: v.type, title: v.title, description: v.description, reason: v.reason,
        impactAnalysis: v.impactAnalysis || undefined, causeAnalysis: v.causeAnalysis || undefined,
        triggeredByFailure: v.triggeredByFailure, proposed: Object.keys(proposed).length ? proposed : undefined, technicalImpact,
      });
      this.form.reset({ type: 'SCOPE', title: '', description: '', reason: '', impactAnalysis: '', causeAnalysis: '', triggeredByFailure: false, budget: null, customerDeliveryDate: '', endDate: '', deliveredParts: '', customerSpec: '', documents: '', requirements: '', revalidation: '' });
    }, '保存失败');
  }

  act(c: ChangeRequest, action: string, body: unknown = {}) {
    return this.run(() => this.api.post(`/projects/${this.project().id}/changes/${c.id}/${action}`, body), '操作失败');
  }
  reject(c: ChangeRequest) {
    const note = window.prompt('驳回原因');
    return note?.trim() ? this.act(c, 'reject', { note }) : Promise.resolve();
  }
  verify(c: ChangeRequest) {
    const note = window.prompt('有效性验证结论');
    return note?.trim() ? this.act(c, 'verify', { note }) : Promise.resolve();
  }
  async toggleHistory(c: ChangeRequest) {
    const cur = this.history();
    if (cur[c.id]) { const { [c.id]: _drop, ...rest } = cur; this.history.set(rest); return; }
    this.history.set({ ...cur, [c.id]: await this.api.get<HistoryRow[]>(`/projects/${this.project().id}/changes/${c.id}/history`) });
  }
}
