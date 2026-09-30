import { Component, inject, input, output, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { Api, errorMessage } from '../core/api';
import { I18n } from '../core/i18n';
import { Project, RISK_LABELS } from '../core/models';

interface Plan {
  objectives: string; frameConditions: string; exclusions: string;
  responsibilities: string; executionRules: string; version: number;
}

@Component({
  selector: 'app-project-overview',
  imports: [ReactiveFormsModule, MatButtonModule, MatFormFieldModule, MatInputModule],
  styles: `.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 8px 24px; margin: 12px 0 24px; } dt { font-size: 12px; color: var(--mat-sys-on-surface-variant); } dd { margin: 0 0 8px; } textarea { min-height: 72px; }`,
  template: `
    <dl class="grid">
      <div><dt>风险等级</dt><dd>{{ risk(project().riskLevel) }}（评审周期 {{ project().reviewIntervalDays }} 天）</dd></div>
      <div><dt>项目周期</dt><dd>{{ project().startDate.slice(0, 10) }} → {{ project().endDate.slice(0, 10) }}</dd></div>
      <div><dt>客户交期</dt><dd>{{ project().customerDeliveryDate?.slice(0, 10) ?? '—' }}</dd></div>
      <div><dt>预算</dt><dd>{{ project().budget ?? '—' }}</dd></div>
    </dl>
    @if (!project().baselined && project().permissions?.manage) {
      <p>策划完成后建立基线。此后范围、预算和客户交期的修改必须经过已批准的变更申请。</p>
      <button mat-flat-button (click)="baseline()">建立基线并启动项目</button>
    }
    @if (error()) { <div class="error" role="alert">{{ error() }}</div> }
    @if (canExport()) { <button mat-stroked-button (click)="exportPack()">导出审核证据包</button> }

    <h2>项目管理计划（第 {{ plan()?.version ?? 0 }} 版）</h2>
    <form [formGroup]="form" (ngSubmit)="save()">
      @for (f of fields; track f.key) {
        <mat-form-field style="width: 100%">
          <mat-label>{{ f.label }}</mat-label>
          <textarea matInput [formControlName]="f.key" [readonly]="!project().permissions?.manage"></textarea>
        </mat-form-field>
      }
      @if (project().permissions?.manage) { <button mat-flat-button type="submit">保存计划</button> }
      @if (saved()) { <span> 已保存</span> }
    </form>
  `,
})
export class ProjectOverview {
  private readonly api = inject(Api);
  private readonly fb = inject(FormBuilder).nonNullable;
  readonly i18n = inject(I18n);
  readonly project = input.required<Project>();
  readonly canExport = () => { const p = this.project().permissions; return !!(p?.manage || p?.quality || p?.topManagement); };
  readonly changed = output<void>();
  readonly plan = signal<Plan | null>(null);
  readonly error = signal('');
  readonly saved = signal(false);
  readonly fields = [
    { key: 'objectives', label: '项目目标' },
    { key: 'frameConditions', label: '框架条件与假设' },
    { key: 'exclusions', label: '范围排除项' },
    { key: 'responsibilities', label: '职责与权限' },
    { key: 'executionRules', label: '项目执行规则' },
  ] as const;
  readonly form = this.fb.group({ objectives: [''], frameConditions: [''], exclusions: [''], responsibilities: [''], executionRules: [''] });

  risk(r: Project['riskLevel']) { return RISK_LABELS[r]; }

  async ngOnInit() {
    const plan = await this.api.get<Plan>(`/projects/${this.project().id}/plan`);
    this.plan.set(plan);
    this.form.patchValue(plan);
  }

  async baseline() {
    this.error.set('');
    try {
      await this.api.post(`/projects/${this.project().id}/baseline`);
      this.changed.emit();
    } catch (e) {
      this.error.set(errorMessage(e, '建立基线失败'));
    }
  }

  async exportPack() {
    this.error.set('');
    try {
      await this.api.download(`/projects/${this.project().id}/evidence-pack`, `evidence-${this.project().code}.zip`);
    } catch (e) {
      this.error.set(errorMessage(e, '导出失败'));
    }
  }

  async save() {
    this.error.set('');
    try {
      this.plan.set(await this.api.put<Plan>(`/projects/${this.project().id}/plan`, this.form.getRawValue()));
      this.saved.set(true);
    } catch (e) {
      this.error.set(errorMessage(e, '保存失败'));
    }
  }
}
