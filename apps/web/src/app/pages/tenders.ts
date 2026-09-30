import { Component, computed, inject, signal } from '@angular/core';
import { askText } from '../core/i18n';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { Api, errorMessage } from '../core/api';
import { AuthService } from '../core/auth.service';
import { TENDER_STATUS_LABELS, Tender } from '../core/models';

@Component({
  selector: 'app-tenders',
  imports: [ReactiveFormsModule, MatButtonModule, MatFormFieldModule, MatInputModule],
  styles: `.box { border: 1px solid var(--mat-sys-outline-variant); border-radius: 8px; padding: 12px 16px; margin: 12px 0; } .meta { font-size: 13px; color: var(--mat-sys-on-surface-variant); }`,
  template: `
    <div class="page">
      <h1>投标管理</h1>
      @if (canWrite()) {
        <form class="row" [formGroup]="createForm" (ngSubmit)="create()">
          <mat-form-field><mat-label>投标编号</mat-label><input matInput formControlName="code" /></mat-form-field>
          <mat-form-field style="min-width: 260px"><mat-label>标题</mat-label><input matInput formControlName="title" /></mat-form-field>
          <mat-form-field><mat-label>客户</mat-label><input matInput formControlName="customer" /></mat-form-field>
          <button mat-flat-button type="submit" [disabled]="createForm.invalid">新建投标</button>
        </form>
      }
      @if (error()) { <div class="error" role="alert">{{ error() }}</div> }
      @for (t of tenders(); track t.id) {
        <div class="box">
          <strong>{{ t.code }} · {{ t.title }}</strong>（{{ t.customer }}）— {{ statusLabels[t.status] }}
          <div class="meta">成本测算 {{ t.estimatedCost }}｜报价 {{ t.offerPrice }}｜风险金额评估 {{ t.riskExposure }}</div>
          @if (t.decisionNote) { <div class="meta">审批意见：{{ t.decisionNote }}</div> }
          @if (t.status === 'DRAFT' && canWrite()) {
            <button mat-button (click)="edit(t)">编辑内容</button>
            @if (editing() === t.id) {
              <form [formGroup]="editForm" (ngSubmit)="save(t)">
                @for (f of fields; track f.key) { <mat-form-field style="width: 100%"><mat-label>{{ f.label }}</mat-label><textarea matInput [formControlName]="f.key"></textarea></mat-form-field> }
                <div class="row">
                  <mat-form-field><mat-label>风险金额评估</mat-label><input matInput type="number" formControlName="riskExposure" /></mat-form-field>
                  <mat-form-field><mat-label>成本测算</mat-label><input matInput type="number" formControlName="estimatedCost" /></mat-form-field>
                  <mat-form-field><mat-label>报价</mat-label><input matInput type="number" formControlName="offerPrice" /></mat-form-field>
                </div>
                <button mat-flat-button type="submit">保存</button>
              </form>
            }
            <button mat-button (click)="act(t, 'submit')">提交审批</button>
          }
          @if (t.status === 'IN_REVIEW' && isTop()) { <button mat-button (click)="act(t, 'approve', true)">批准报价</button><button mat-button (click)="act(t, 'reject', true)">驳回</button> }
          @if (t.status === 'APPROVED' && canWrite()) { <button mat-button (click)="act(t, 'won')">标记中标</button><button mat-button (click)="act(t, 'lost')">标记未中标</button> }
          @if (t.status === 'WON' && canWrite() && !t.convertedProjectId) { <button mat-button (click)="convert(t)">转为项目</button> }
          @if (t.convertedProjectId) { <button mat-button (click)="open(t)">查看项目</button> }
        </div>
      }
    </div>
  `,
})
export class TendersPage {
  private readonly api = inject(Api);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly fb = inject(FormBuilder).nonNullable;
  readonly statusLabels = TENDER_STATUS_LABELS;
  readonly tenders = signal<Tender[]>([]);
  readonly error = signal('');
  readonly editing = signal<string | null>(null);
  readonly canWrite = computed(() => this.auth.hasRole('TENANT_ADMIN', 'PROJECT_MANAGER'));
  readonly isTop = computed(() => this.auth.hasRole('TOP_MANAGEMENT'));
  readonly fields = [
    { key: 'requirements', label: '客户需求' }, { key: 'riskAssessment', label: '风险与机会评估' },
    { key: 'knowledgeInputs', label: '组织知识输入（参考的经验教训）' }, { key: 'deliverablesPlan', label: '交付物策划（含成本）' },
    { key: 'resourcePlan', label: '合同执行资源计划' },
  ] as const;
  readonly createForm = this.fb.group({ code: ['', Validators.required], title: ['', [Validators.required, Validators.minLength(2)]], customer: ['', Validators.required] });
  readonly editForm = this.fb.group({
    requirements: [''], riskAssessment: [''], knowledgeInputs: [''], deliverablesPlan: [''], resourcePlan: [''],
    riskExposure: [0], estimatedCost: [0], offerPrice: [0],
  });

  constructor() { void this.load(); }
  async load() { this.tenders.set(await this.api.get<Tender[]>('/tenders')); }
  private async run(fn: () => Promise<unknown>, fallback: string) {
    this.error.set('');
    try { await fn(); } catch (e) { this.error.set(errorMessage(e, fallback)); }
    await this.load();
  }
  create() {
    return this.run(async () => { await this.api.post('/tenders', this.createForm.getRawValue()); this.createForm.reset({ code: '', title: '', customer: '' }); }, '创建失败');
  }
  edit(t: Tender) {
    this.editing.set(this.editing() === t.id ? null : t.id);
    this.editForm.patchValue({
      requirements: t.requirements, riskAssessment: t.riskAssessment, knowledgeInputs: t.knowledgeInputs, deliverablesPlan: t.deliverablesPlan,
      resourcePlan: t.resourcePlan, riskExposure: Number(t.riskExposure), estimatedCost: Number(t.estimatedCost), offerPrice: Number(t.offerPrice),
    });
  }
  save(t: Tender) { return this.run(async () => { await this.api.patch(`/tenders/${t.id}`, this.editForm.getRawValue()); this.editing.set(null); }, '保存失败'); }
  act(t: Tender, action: string, needNote = false) {
    const note = needNote ? askText('审批意见') : undefined;
    if (needNote && !note?.trim()) return Promise.resolve();
    return this.run(() => this.api.post(`/tenders/${t.id}/${action}`, needNote ? { note } : {}), '操作失败');
  }
  convert(t: Tender) {
    const code = askText('新项目编号');
    const startDate = code ? askText('项目开始日期（YYYY-MM-DD）') : null;
    const endDate = startDate ? askText('项目结束日期（YYYY-MM-DD）') : null;
    if (!code || !startDate || !endDate) return Promise.resolve();
    return this.run(async () => {
      const p = await this.api.post<{ id: string }>(`/tenders/${t.id}/convert`, { code, riskLevel: 'MEDIUM', startDate, endDate });
      await this.router.navigate(['/projects', p.id]);
    }, '转换失败');
  }
  open(t: Tender) { return this.router.navigate(['/projects', t.convertedProjectId]); }
}
