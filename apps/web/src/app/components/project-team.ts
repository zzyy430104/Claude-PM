import { Component, computed, inject, input, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { Api, errorMessage } from '../core/api';
import { AuthService } from '../core/auth.service';
import { COMM_KIND_LABELS, CommLog, CommPlan, Member, Project, TrainingRow } from '../core/models';

@Component({
  selector: 'app-project-team',
  imports: [ReactiveFormsModule, MatButtonModule, MatFormFieldModule, MatInputModule, MatSelectModule],
  styles: `.box { border: 1px solid var(--mat-sys-outline-variant); border-radius: 8px; padding: 8px 16px; margin: 8px 0; } .meta { font-size: 13px; color: var(--mat-sys-on-surface-variant); }`,
  template: `
    @if (error()) { <div class="error" role="alert">{{ error() }}</div> }
    <h2>沟通计划（第 {{ plan()?.version ?? 0 }} 版）</h2>
    <form [formGroup]="planForm">
      <mat-form-field style="width: 100%"><mat-label>沟通渠道（每行：对象 | 渠道 | 频次）</mat-label><textarea matInput rows="3" formControlName="channels" [readonly]="!manage()" placeholder="客户 | 周报邮件 | 每周&#10;供方 | 例会 | 每两周"></textarea></mat-form-field>
      @if (manage()) { <button mat-flat-button type="button" (click)="savePlan()">保存沟通计划</button> }
    </form>

    <h2>沟通记录</h2>
    <form class="row" [formGroup]="logForm" (ngSubmit)="addLog()">
      <mat-form-field><mat-label>类型</mat-label><mat-select formControlName="kind">@for (k of kinds; track k) { <mat-option [value]="k">{{ kindLabels[k] }}</mat-option> }</mat-select></mat-form-field>
      <mat-form-field><mat-label>日期</mat-label><input matInput type="date" formControlName="logDate" /></mat-form-field>
      <mat-form-field style="min-width: 240px"><mat-label>主题</mat-label><input matInput formControlName="subject" /></mat-form-field>
      <mat-form-field><mat-label>参与人</mat-label><input matInput formControlName="participants" /></mat-form-field>
      <mat-form-field style="min-width: 320px"><mat-label>纪要</mat-label><input matInput formControlName="summary" /></mat-form-field>
      <button mat-flat-button type="submit" [disabled]="logForm.invalid">登记</button>
    </form>
    @for (l of logs(); track l.id) {
      <div class="box"><strong>{{ l.logDate.slice(0, 10) }} · {{ kindLabels[l.kind] }} · {{ l.subject }}</strong><div class="meta">{{ l.participants }}</div><div>{{ l.summary }}</div></div>
    }

    <h2>培训计划（能力要求见「成员」页）</h2>
    @if (manage()) {
      <form class="row" [formGroup]="trainForm" (ngSubmit)="addTraining()">
        <mat-form-field><mat-label>人员</mat-label><mat-select formControlName="userId">@for (m of members(); track m.userId) { <mat-option [value]="m.userId">{{ m.user?.name }}</mat-option> }</mat-select></mat-form-field>
        <mat-form-field style="min-width: 240px"><mat-label>培训内容</mat-label><input matInput formControlName="title" /></mat-form-field>
        <mat-form-field><mat-label>完成期限</mat-label><input matInput type="date" formControlName="dueDate" /></mat-form-field>
        <button mat-flat-button type="submit" [disabled]="trainForm.invalid">安排培训</button>
      </form>
    }
    @for (t of trainings(); track t.id) {
      <div class="box">{{ name(t.userId) }} · {{ t.title }} · 期限 {{ t.dueDate?.slice(0, 10) ?? '—' }} · {{ t.status === 'DONE' ? '已完成' : '待完成' }}
        @if (t.status === 'PLANNED' && (manage() || t.userId === me()?.id)) { <button mat-button (click)="done(t)">标记完成</button> }
      </div>
    }
  `,
})
export class ProjectTeam {
  private readonly api = inject(Api);
  private readonly auth = inject(AuthService);
  private readonly fb = inject(FormBuilder).nonNullable;
  readonly project = input.required<Project>();
  readonly plan = signal<CommPlan | null>(null);
  readonly logs = signal<CommLog[]>([]);
  readonly trainings = signal<TrainingRow[]>([]);
  readonly members = signal<Member[]>([]);
  readonly error = signal('');
  readonly me = this.auth.user;
  readonly kinds = Object.keys(COMM_KIND_LABELS) as (keyof typeof COMM_KIND_LABELS)[];
  readonly kindLabels = COMM_KIND_LABELS;
  readonly manage = computed(() => !!this.project().permissions?.manage);
  readonly planForm = this.fb.group({ channels: [''] });
  readonly logForm = this.fb.group({ kind: ['MEETING'], logDate: [new Date().toISOString().slice(0, 10), Validators.required], subject: ['', Validators.required], participants: [''], summary: ['', Validators.required] });
  readonly trainForm = this.fb.group({ userId: ['', Validators.required], title: ['', Validators.required], dueDate: [''] });

  name(id: string) { return this.members().find((m) => m.userId === id)?.user?.name ?? '—'; }

  async ngOnInit() {
    this.members.set(await this.api.get<Member[]>(`/projects/${this.project().id}/members`));
    await this.load();
  }
  async load() {
    const id = this.project().id;
    const plan = await this.api.get<CommPlan>(`/projects/${id}/communication-plan`);
    this.plan.set(plan);
    this.planForm.patchValue({ channels: plan.channels.map((c) => `${c.audience} | ${c.channel} | ${c.frequency}`).join('\n') });
    this.logs.set(await this.api.get<CommLog[]>(`/projects/${id}/communication-logs`));
    this.trainings.set(await this.api.get<TrainingRow[]>(`/projects/${id}/trainings`));
  }
  private async run(fn: () => Promise<unknown>, fallback: string) {
    this.error.set('');
    try { await fn(); } catch (e) { this.error.set(errorMessage(e, fallback)); }
    await this.load();
  }
  savePlan() {
    const channels = this.planForm.getRawValue().channels.split('\n').map((l) => l.trim()).filter(Boolean).map((line) => {
      const [audience, channel, frequency] = line.split('|').map((x) => x.trim());
      return { audience, channel: channel || '—', frequency: frequency || '—' };
    });
    return this.run(() => this.api.put(`/projects/${this.project().id}/communication-plan`, { channels }), '保存失败');
  }
  addLog() {
    return this.run(async () => {
      await this.api.post(`/projects/${this.project().id}/communication-logs`, this.logForm.getRawValue());
      this.logForm.patchValue({ subject: '', participants: '', summary: '' });
    }, '登记失败');
  }
  addTraining() {
    const v = this.trainForm.getRawValue();
    return this.run(async () => {
      await this.api.post(`/projects/${this.project().id}/trainings`, { ...v, dueDate: v.dueDate || undefined });
      this.trainForm.reset({ userId: '', title: '', dueDate: '' });
    }, '安排失败');
  }
  done(t: TrainingRow) { return this.run(() => this.api.patch(`/projects/${this.project().id}/trainings/${t.id}`, { status: 'DONE' }), '更新失败'); }
}
