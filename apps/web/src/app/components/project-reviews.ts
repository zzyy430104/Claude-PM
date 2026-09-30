import { Component, inject, input, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { Api, errorMessage } from '../core/api';
import { Member, Project, ProjectReview, UserRow } from '../core/models';

type Prep = ProjectReview['performance'];

@Component({
  selector: 'app-project-reviews',
  imports: [ReactiveFormsModule, MatButtonModule, MatFormFieldModule, MatInputModule, MatSelectModule],
  styles: `.box { border: 1px solid var(--mat-sys-outline-variant); border-radius: 8px; padding: 12px 16px; margin: 12px 0; } .warn { color: var(--mat-sys-error); } .meta { font-size: 13px; color: var(--mat-sys-on-surface-variant); }`,
  template: `
    @if (prep(); as p) {
      <div class="box">
        <h3>评审准备：当前绩效</h3>
        <div>计划进度 {{ p.progress.plannedPercent }}% · 实际进度 {{ p.progress.actualPercent }}% · 偏差 {{ p.progress.varianceDays }} 天</div>
        <div>预计完工 {{ p.progress.projectedEnd }}（计划 {{ p.progress.plannedEnd }}）
          @if (p.progress.exceedsPlannedEnd) { <span class="warn">预计超期</span> }
        </div>
        <div>未关闭问题 / 行动项 {{ p.openIssues.length }} 个（逾期 {{ p.overdueActions }} 个）；未关闭风险 / 机会 {{ p.openRisks.length }} 个</div>
      </div>
    }
    @if (project().permissions?.manage) {
      <form [formGroup]="form">
        <div class="row">
          <mat-form-field><mat-label>评审日期</mat-label><input matInput type="date" formControlName="reviewDate" /></mat-form-field>
          <mat-form-field style="min-width: 320px"><mat-label>出席者（须含项目经理）</mat-label>
            <mat-select formControlName="attendees" multiple>@for (m of members(); track m.userId) { <mat-option [value]="m.userId">{{ m.user?.name }}</mat-option> }</mat-select>
          </mat-form-field>
          <mat-form-field><mat-label>上报给</mat-label>
            <mat-select formControlName="reportedToId"><mat-option value="">不上报</mat-option>@for (u of managers(); track u.id) { <mat-option [value]="u.id">{{ u.name }}</mat-option> }</mat-select>
          </mat-form-field>
        </div>
        <mat-form-field style="width: 100%"><mat-label>评审纪要</mat-label><textarea matInput formControlName="notes"></textarea></mat-form-field>
        <mat-form-field style="width: 100%"><mat-label>需决策 / 升级事项</mat-label><textarea matInput formControlName="escalations"></textarea></mat-form-field>
        <mat-form-field style="width: 100%"><mat-label>行动项（每行一项）</mat-label><textarea matInput formControlName="actions"></textarea></mat-form-field>
        <button mat-flat-button type="button" (click)="create()" [disabled]="form.invalid">记录项目评审</button>
      </form>
    }
    @if (error()) { <div class="error" role="alert">{{ error() }}</div> }
    <h2>历史评审</h2>
    @for (r of rows(); track r.id) {
      <div class="box">
        <strong>{{ r.reviewDate.slice(0, 10) }}</strong>
        <div class="meta">计划 {{ r.performance.progress.plannedPercent }}% / 实际 {{ r.performance.progress.actualPercent }}% · 预计完工 {{ r.performance.progress.projectedEnd }} · 未关闭问题 {{ r.performance.openIssues.length }} · 风险 {{ r.performance.openRisks.length }}</div>
        @if (r.notes) { <div>{{ r.notes }}</div> }
        @if (r.escalations) { <div class="warn">升级事项：{{ r.escalations }}{{ r.reportedToId ? '（已上报）' : '' }}</div> }
      </div>
    }
    @if (rows().length === 0) { <p>尚未进行项目评审。评审周期：{{ project().reviewIntervalDays }} 天。</p> }
  `,
})
export class ProjectReviews {
  private readonly api = inject(Api);
  private readonly fb = inject(FormBuilder).nonNullable;
  readonly project = input.required<Project>();
  readonly rows = signal<ProjectReview[]>([]);
  readonly prep = signal<Prep | null>(null);
  readonly members = signal<Member[]>([]);
  readonly managers = signal<UserRow[]>([]);
  readonly error = signal('');
  readonly form = this.fb.group({
    reviewDate: [new Date().toISOString().slice(0, 10), Validators.required],
    attendees: [[] as string[], Validators.required], reportedToId: [''], notes: [''], escalations: [''], actions: [''],
  });

  async ngOnInit() {
    const id = this.project().id;
    this.members.set(await this.api.get<Member[]>(`/projects/${id}/members`));
    if (this.project().permissions?.manage) {
      const dir = await this.api.get<UserRow[]>('/users/directory');
      this.managers.set(dir.filter((u) => u.role === 'TOP_MANAGEMENT' || u.role === 'TENANT_ADMIN'));
    }
    await this.load();
  }
  async load() {
    const id = this.project().id;
    this.rows.set(await this.api.get<ProjectReview[]>(`/projects/${id}/reviews`));
    this.prep.set(await this.api.get<Prep>(`/projects/${id}/reviews/prepare`));
  }
  async create() {
    this.error.set('');
    const v = this.form.getRawValue();
    const actions = v.actions.split('\n').map((s) => s.trim()).filter(Boolean).map((title) => ({ title }));
    try {
      await this.api.post(`/projects/${this.project().id}/reviews`, {
        reviewDate: v.reviewDate, attendees: v.attendees, notes: v.notes || undefined, escalations: v.escalations || undefined,
        reportedToId: v.reportedToId || undefined, actions: actions.length ? actions : undefined,
      });
      this.form.patchValue({ notes: '', escalations: '', actions: '', reportedToId: '' });
      await this.load();
    } catch (e) { this.error.set(errorMessage(e, '记录失败')); }
  }
}
