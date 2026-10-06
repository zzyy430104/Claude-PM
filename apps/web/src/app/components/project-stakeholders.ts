import { Component, computed, inject, input, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { Api, errorMessage } from '../core/api';
import { DIMENSION_LABELS, DeviationNotice, LEVEL_LABELS, Project, Stakeholder } from '../core/models';
import { askConfirm } from '../core/dialog';

/** 干系人登记册与偏离通报（ISO 22163 8.1.3.8、8.1.3.11） */
@Component({
  selector: 'app-project-stakeholders',
  imports: [ReactiveFormsModule, MatButtonModule, MatFormFieldModule, MatInputModule, MatSelectModule],
  styles: `.danger { color: var(--pm-red) !important; } td small { display: block; color: var(--pm-muted); }`,
  template: `
    <h2>偏离通报</h2>
    <p class="muted">项目即将偏离目标（质量、进度、成本）时，记录向客户和相关方通报的影响与对策。</p>
    @if (manage()) {
      <form [formGroup]="devForm" (ngSubmit)="notify()">
        <div class="row">
          <mat-form-field><mat-label>方面</mat-label>
            <mat-select formControlName="dimension">@for (d of dims; track d) { <mat-option [value]="d">{{ dimLabel(d) }}</mat-option> }</mat-select>
          </mat-form-field>
          <mat-form-field><mat-label>通报日期</mat-label><input matInput type="date" formControlName="noticeDate" /></mat-form-field>
          <mat-form-field style="min-width: 300px"><mat-label>通报对象</mat-label><input matInput formControlName="audience" placeholder="客户项目经理、业主代表……" /></mat-form-field>
        </div>
        <mat-form-field style="width: 100%"><mat-label>影响</mat-label><textarea matInput formControlName="impact"></textarea></mat-form-field>
        <mat-form-field style="width: 100%"><mat-label>对策</mat-label><textarea matInput formControlName="countermeasures"></textarea></mat-form-field>
        <button mat-flat-button type="submit" [disabled]="devForm.invalid">记录偏离通报</button>
      </form>
    }
    @if (notices().length) {
      <table>
        <thead><tr><th>日期</th><th>方面</th><th>通报对象</th><th>影响</th><th>对策</th></tr></thead>
        <tbody>
          @for (n of notices(); track n.id) {
            <tr><td>{{ n.noticeDate.slice(0, 10) }}</td><td>{{ dimLabel(n.dimension) }}</td><td>{{ n.audience }}</td><td>{{ n.impact }}</td><td>{{ n.countermeasures }}</td></tr>
          }
        </tbody>
      </table>
    } @else { <p class="muted">暂无偏离通报。</p> }

    <h2>干系人登记册</h2>
    @if (canEdit()) {
      <form class="row" [formGroup]="form" (ngSubmit)="add()">
        <mat-form-field><mat-label>姓名 / 岗位</mat-label><input matInput formControlName="name" /></mat-form-field>
        <mat-form-field><mat-label>单位</mat-label><input matInput formControlName="organization" /></mat-form-field>
        <mat-form-field><mat-label>邮箱（会议通知）</mat-label><input matInput type="email" formControlName="email" /></mat-form-field>
        <mat-form-field><mat-label>在项目中的角色</mat-label><input matInput formControlName="role" /></mat-form-field>
        <mat-form-field style="width: 110px"><mat-label>影响力</mat-label>
          <mat-select formControlName="influence">@for (l of levels; track l) { <mat-option [value]="l">{{ levelLabel(l) }}</mat-option> }</mat-select>
        </mat-form-field>
        <mat-form-field style="width: 110px"><mat-label>关注度</mat-label>
          <mat-select formControlName="interest">@for (l of levels; track l) { <mat-option [value]="l">{{ levelLabel(l) }}</mat-option> }</mat-select>
        </mat-form-field>
        <mat-form-field style="min-width: 240px"><mat-label>主要期望</mat-label><input matInput formControlName="expectations" /></mat-form-field>
        <mat-form-field style="min-width: 240px"><mat-label>沟通方式与频次</mat-label><input matInput formControlName="communication" /></mat-form-field>
        <button mat-flat-button type="submit" [disabled]="form.invalid">添加干系人</button>
      </form>
    }
    @if (error()) { <div class="error" role="alert">{{ error() }}</div> }
    @if (rows().length) {
      <table>
        <thead><tr><th>干系人</th><th>角色</th><th>影响力</th><th>关注度</th><th>主要期望</th><th>沟通方式</th><th></th></tr></thead>
        <tbody>
          @for (s of rows(); track s.id) {
            <tr>
              <td>{{ s.name }}<small>{{ s.organization }}@if (s.email) { · {{ s.email }} }</small></td>
              <td>{{ s.role || '—' }}</td>
              <td>{{ levelLabel(s.influence) }}</td>
              <td>{{ levelLabel(s.interest) }}</td>
              <td>{{ s.expectations || '—' }}</td>
              <td>{{ s.communication || '—' }}</td>
              <td>@if (canEdit()) { <button mat-button class="danger" (click)="remove(s)">删除</button> }</td>
            </tr>
          }
        </tbody>
      </table>
    } @else { <p class="muted">还没有登记干系人。</p> }
  `,
})
export class ProjectStakeholders {
  private readonly api = inject(Api);
  private readonly fb = inject(FormBuilder).nonNullable;
  readonly project = input.required<Project>();
  readonly rows = signal<Stakeholder[]>([]);
  readonly notices = signal<DeviationNotice[]>([]);
  readonly error = signal('');
  readonly levels = ['HIGH', 'MEDIUM', 'LOW'] as const;
  readonly dims = ['SCHEDULE', 'COST', 'QUALITY'] as const;
  readonly manage = computed(() => !!this.project().permissions?.edit?.COMM && this.project().status !== 'CLOSED');
  readonly canEdit = computed(() => { const p = this.project().permissions; return !!(p?.manage || p?.quality) && this.project().status !== 'CLOSED'; });
  readonly form = this.fb.group({
    name: ['', Validators.required], organization: [''], email: [''], role: [''], influence: ['MEDIUM'], interest: ['MEDIUM'], expectations: [''], communication: [''],
  });
  readonly devForm = this.fb.group({
    dimension: ['SCHEDULE'], noticeDate: [new Date().toISOString().slice(0, 10), Validators.required],
    audience: ['', [Validators.required, Validators.minLength(2)]], impact: ['', [Validators.required, Validators.minLength(2)]],
    countermeasures: ['', [Validators.required, Validators.minLength(2)]],
  });

  levelLabel(l: string) { return LEVEL_LABELS[l as keyof typeof LEVEL_LABELS]; }
  dimLabel(d: string) { return DIMENSION_LABELS[d as keyof typeof DIMENSION_LABELS]; }

  async ngOnInit() { await this.load(); }
  async load() {
    const id = this.project().id;
    this.rows.set(await this.api.get<Stakeholder[]>(`/projects/${id}/stakeholders`));
    this.notices.set(await this.api.get<DeviationNotice[]>(`/projects/${id}/deviations`));
  }
  private async run(fn: () => Promise<unknown>, fallback: string) {
    this.error.set('');
    try { await fn(); } catch (e) { this.error.set(errorMessage(e, fallback)); }
    await this.load();
  }
  add() {
    return this.run(async () => {
      await this.api.post(`/projects/${this.project().id}/stakeholders`, this.form.getRawValue());
      this.form.reset({ name: '', organization: '', email: '', role: '', influence: 'MEDIUM', interest: 'MEDIUM', expectations: '', communication: '' });
    }, '添加失败');
  }
  async remove(s: Stakeholder) {
    if (!await askConfirm(`确定删除干系人 ${s.name}？`)) return Promise.resolve();
    return this.run(() => this.api.delete(`/projects/${this.project().id}/stakeholders/${s.id}`), '删除失败');
  }
  notify() {
    return this.run(async () => {
      await this.api.post(`/projects/${this.project().id}/deviations`, this.devForm.getRawValue());
      this.devForm.reset({ dimension: 'SCHEDULE', noticeDate: new Date().toISOString().slice(0, 10), audience: '', impact: '', countermeasures: '' });
    }, '保存失败');
  }
}
