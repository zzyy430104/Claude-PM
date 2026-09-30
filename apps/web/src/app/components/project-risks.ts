import { Component, inject, input, signal } from '@angular/core';
import { askText } from '../core/i18n';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { Api, errorMessage } from '../core/api';
import { Member, Project, RISK_STATUS_LABELS, RiskRow } from '../core/models';

@Component({
  selector: 'app-project-risks',
  imports: [ReactiveFormsModule, MatButtonModule, MatFormFieldModule, MatInputModule, MatSelectModule],
  styles: `table { width: 100%; border-collapse: collapse; font-size: 14px; } th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--mat-sys-outline-variant); } .high { color: var(--mat-sys-error); font-weight: 500; } small { display: block; color: var(--mat-sys-on-surface-variant); }`,
  template: `
    <form class="row" [formGroup]="form" (ngSubmit)="add()">
      <mat-form-field><mat-label>类别</mat-label>
        <mat-select formControlName="kind"><mat-option value="RISK">风险</mat-option><mat-option value="OPPORTUNITY">机会</mat-option></mat-select>
      </mat-form-field>
      <mat-form-field style="min-width: 240px"><mat-label>标题</mat-label><input matInput formControlName="title" /></mat-form-field>
      <mat-form-field><mat-label>可能性 1–5</mat-label><input matInput type="number" min="1" max="5" formControlName="probability" /></mat-form-field>
      <mat-form-field><mat-label>影响 1–5</mat-label><input matInput type="number" min="1" max="5" formControlName="impact" /></mat-form-field>
      <mat-form-field><mat-label>潜在损失 / 收益金额</mat-label><input matInput type="number" formControlName="exposureAmount" /></mat-form-field>
      <mat-form-field><mat-label>应对成本</mat-label><input matInput type="number" formControlName="responseCost" /></mat-form-field>
      <mat-form-field style="min-width: 300px"><mat-label>成本收益分析</mat-label><input matInput formControlName="costBenefitAnalysis" /></mat-form-field>
      <mat-form-field><mat-label>负责人</mat-label>
        <mat-select formControlName="ownerId"><mat-option value="">未分配</mat-option>@for (m of members(); track m.userId) { <mat-option [value]="m.userId">{{ m.user?.name }}</mat-option> }</mat-select>
      </mat-form-field>
      <button mat-flat-button type="submit" [disabled]="form.invalid">登记</button>
    </form>
    @if (error()) { <div class="error" role="alert">{{ error() }}</div> }
    <table>
      <thead><tr><th>类别</th><th>标题</th><th>评分</th><th>期望价值 / 应对成本</th><th>负责人</th><th>应对行动</th><th>状态</th><th></th></tr></thead>
      <tbody>
        @for (r of rows(); track r.id) {
          <tr>
            <td>{{ r.kind === 'RISK' ? '风险' : '机会' }}</td>
            <td>{{ r.title }}<small>{{ r.costBenefitAnalysis }}</small></td>
            <td [class.high]="r.score >= 15">{{ r.score }}（{{ r.probability }}×{{ r.impact }}）</td>
            <td>{{ r.expectedValue }} / {{ r.responseCost }}<small>{{ r.netBenefitOfResponse >= 0 ? '应对划算' : '应对成本高于期望价值' }}</small></td>
            <td>{{ owner(r) }}</td>
            <td>{{ r.openActions }} 未完成 / {{ r.closedActions }} 已完成 <button mat-button (click)="addAction(r)">添加</button></td>
            <td>{{ statusLabel(r) }}</td>
            <td>
              @if (r.status !== 'CLOSED') {
                <button mat-button (click)="setStatus(r, 'MITIGATING')">应对中</button>
                <button mat-button (click)="close(r)">关闭</button>
              }
            </td>
          </tr>
        }
      </tbody>
    </table>
  `,
})
export class ProjectRisks {
  private readonly api = inject(Api);
  private readonly fb = inject(FormBuilder).nonNullable;
  readonly project = input.required<Project>();
  readonly rows = signal<RiskRow[]>([]);
  readonly members = signal<Member[]>([]);
  readonly error = signal('');
  readonly form = this.fb.group({
    kind: ['RISK'], title: ['', Validators.required], probability: [3, [Validators.min(1), Validators.max(5)]],
    impact: [3, [Validators.min(1), Validators.max(5)]], exposureAmount: [0], responseCost: [0],
    costBenefitAnalysis: ['', Validators.required], ownerId: [''],
  });

  statusLabel(r: RiskRow) { return RISK_STATUS_LABELS[r.status]; }
  owner(r: RiskRow) { return this.members().find((m) => m.userId === r.ownerId)?.user?.name ?? '—'; }

  async ngOnInit() {
    this.members.set(await this.api.get<Member[]>(`/projects/${this.project().id}/members`));
    await this.load();
  }
  async load() { this.rows.set(await this.api.get<RiskRow[]>(`/projects/${this.project().id}/risks`)); }

  private async run(fn: () => Promise<unknown>, fallback: string) {
    this.error.set('');
    try { await fn(); } catch (e) { this.error.set(errorMessage(e, fallback)); }
    await this.load();
  }

  add() {
    const v = this.form.getRawValue();
    return this.run(async () => {
      await this.api.post(`/projects/${this.project().id}/risks`, { ...v, ownerId: v.ownerId || undefined });
      this.form.reset({ kind: 'RISK', title: '', probability: 3, impact: 3, exposureAmount: 0, responseCost: 0, costBenefitAnalysis: '', ownerId: '' });
    }, '登记失败');
  }
  setStatus(r: RiskRow, status: string) { return this.run(() => this.api.patch(`/projects/${this.project().id}/risks/${r.id}`, { status }), '更新失败'); }
  close(r: RiskRow) {
    const closureNote = askText('请填写关闭结论');
    if (!closureNote?.trim()) return Promise.resolve();
    return this.run(() => this.api.patch(`/projects/${this.project().id}/risks/${r.id}`, { status: 'CLOSED', closureNote }), '关闭失败');
  }
  addAction(r: RiskRow) {
    const title = askText('应对行动内容');
    if (!title?.trim()) return Promise.resolve();
    return this.run(() => this.api.post(`/projects/${this.project().id}/risks/${r.id}/actions`, { title }), '添加失败');
  }
}
