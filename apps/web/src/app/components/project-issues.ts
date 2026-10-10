import { Component, inject, input, signal } from '@angular/core';
import { askText } from '../core/i18n';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { Api, errorMessage } from '../core/api';
import { ISSUE_SOURCE_LABELS, Issue, Member, Project } from '../core/models';

@Component({
  selector: 'app-project-issues',
  imports: [ReactiveFormsModule, MatButtonModule, MatFormFieldModule, MatInputModule, MatSelectModule],
  styles: `table { width: 100%; border-collapse: collapse; font-size: 14px; } th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--mat-sys-outline-variant); } .closed { opacity: .6; }`,
  template: `
    <form class="row" [formGroup]="form" (ngSubmit)="add()">
      <mat-form-field style="min-width: 280px"><mat-label>问题 / 行动项</mat-label><input matInput formControlName="title" /></mat-form-field>
      <mat-form-field>
        <mat-label>类型</mat-label>
        <mat-select formControlName="kind"><mat-option value="ISSUE">问题</mat-option><mat-option value="ACTION">行动项</mat-option></mat-select>
      </mat-form-field>
      <mat-form-field>
        <mat-label>负责人</mat-label>
        <mat-select formControlName="ownerId">
          <mat-option value="">未分配</mat-option>
          @for (m of members(); track m.userId) { <mat-option [value]="m.userId">{{ m.user?.name }}</mat-option> }
        </mat-select>
      </mat-form-field>
      <mat-form-field><mat-label>到期日</mat-label><input matInput type="date" formControlName="dueDate" /></mat-form-field>
      <button mat-flat-button type="submit" [disabled]="form.invalid">登记</button>
    </form>
    @if (error()) { <div class="error" role="alert">{{ error() }}</div> }
    <table>
      <thead><tr><th>类型</th><th>标题</th><th>来源</th><th>负责人</th><th>到期</th><th>状态</th><th></th></tr></thead>
      <tbody>
        @for (i of rows(); track i.id) {
          <tr [class.closed]="i.status === 'CLOSED'">
            <td>{{ i.kind === 'ISSUE' ? '问题' : '行动项' }}</td><td>{{ i.title }}</td><td>{{ source(i) }}</td>
            <td>{{ owner(i) }}</td><td>{{ i.dueDate?.slice(0, 10) ?? '—' }}</td>
            <td>{{ i.status === 'OPEN' ? '未关闭' : '已关闭：' + i.closureNote }}</td>
            <td>@if (i.status === 'OPEN') { <button mat-button (click)="close(i)">关闭</button> }</td>
          </tr>
        }
      </tbody>
    </table>
  `,
})
export class ProjectIssues {
  private readonly api = inject(Api);
  private readonly fb = inject(FormBuilder).nonNullable;
  readonly project = input.required<Project>();
  readonly rows = signal<Issue[]>([]);
  readonly members = signal<Member[]>([]);
  readonly error = signal('');
  readonly form = this.fb.group({ title: ['', Validators.required], kind: ['ISSUE'], ownerId: [''], dueDate: [''] });

  source(i: Issue) { return ISSUE_SOURCE_LABELS[i.source] ?? i.source; }
  owner(i: Issue) { return this.members().find((m) => m.userId === i.ownerId)?.user?.name ?? '—'; }

  async ngOnInit() {
    this.members.set(await this.api.get<Member[]>(`/projects/${this.project().id}/members`));
    await this.load();
  }
  async load() { this.rows.set(await this.api.get<Issue[]>(`/projects/${this.project().id}/issues`)); }

  async add() {
    this.error.set('');
    const v = this.form.getRawValue();
    try {
      await this.api.post(`/projects/${this.project().id}/issues`, { title: v.title, kind: v.kind, ownerId: v.ownerId || undefined, dueDate: v.dueDate || undefined });
      this.form.reset({ title: '', kind: 'ISSUE', ownerId: '', dueDate: '' });
      await this.load();
    } catch (e) { this.error.set(errorMessage(e, '登记失败')); }
  }

  async close(i: Issue) {
    const closureNote = await askText('请填写关闭结论');
    if (!closureNote?.trim()) return;
    this.error.set('');
    try { await this.api.patch(`/projects/${this.project().id}/issues/${i.id}`, { status: 'CLOSED', closureNote }); }
    catch (e) { this.error.set(errorMessage(e, '关闭失败')); }
    await this.load();
  }
}
