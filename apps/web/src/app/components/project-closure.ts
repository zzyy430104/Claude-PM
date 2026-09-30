import { Component, computed, inject, input, output, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { Api, errorMessage } from '../core/api';
import { Lesson, Project } from '../core/models';

@Component({
  selector: 'app-project-closure',
  imports: [ReactiveFormsModule, MatButtonModule, MatFormFieldModule, MatInputModule, MatSelectModule],
  styles: `.box { border: 1px solid var(--mat-sys-outline-variant); border-radius: 8px; padding: 8px 16px; margin: 8px 0; } .meta { font-size: 13px; color: var(--mat-sys-on-surface-variant); }`,
  template: `
    @if (error()) { <div class="error" role="alert">{{ error() }}</div> }
    <h2>经验教训与良好实践</h2>
    <form class="row" [formGroup]="form" (ngSubmit)="add()">
      <mat-form-field><mat-label>类型</mat-label><mat-select formControlName="kind"><mat-option value="LESSON">经验教训</mat-option><mat-option value="GOOD_PRACTICE">良好实践</mat-option></mat-select></mat-form-field>
      <mat-form-field style="min-width: 240px"><mat-label>标题</mat-label><input matInput formControlName="title" /></mat-form-field>
      <mat-form-field style="min-width: 300px"><mat-label>发生了什么</mat-label><input matInput formControlName="description" /></mat-form-field>
      <mat-form-field style="min-width: 300px"><mat-label>今后怎么做</mat-label><input matInput formControlName="recommendation" /></mat-form-field>
      <button mat-flat-button type="submit" [disabled]="form.invalid">登记</button>
    </form>
    @for (l of lessons(); track l.id) {
      <div class="box"><strong>{{ l.kind === 'LESSON' ? '教训' : '良好实践' }} · {{ l.title }}</strong><div class="meta">{{ l.description }}</div><div>建议：{{ l.recommendation }}</div></div>
    }
    @if (canClose()) {
      <h2>关闭项目</h2>
      <p>关闭前需：所有阶段已关闭、无未关闭的问题 / 行动项和不符合项、已登记经验教训。</p>
      <mat-form-field style="width: 100%"><mat-label>未登记经验教训时的原因说明</mat-label><input matInput [value]="reason()" (input)="reason.set($any($event.target).value)" /></mat-form-field>
      <button mat-flat-button (click)="close()">关闭项目</button>
    }
  `,
})
export class ProjectClosure {
  private readonly api = inject(Api);
  private readonly fb = inject(FormBuilder).nonNullable;
  readonly project = input.required<Project>();
  readonly changed = output<void>();
  readonly lessons = signal<Lesson[]>([]);
  readonly error = signal('');
  readonly reason = signal('');
  readonly canClose = computed(() => !!this.project().permissions?.manage && this.project().status === 'ACTIVE');
  readonly form = this.fb.group({ kind: ['LESSON'], title: ['', [Validators.required, Validators.minLength(2)]], description: ['', Validators.required], recommendation: ['', Validators.required] });

  async ngOnInit() { await this.load(); }
  async load() { this.lessons.set(await this.api.get<Lesson[]>(`/projects/${this.project().id}/lessons`)); }
  async add() {
    this.error.set('');
    try {
      await this.api.post(`/projects/${this.project().id}/lessons`, this.form.getRawValue());
      this.form.reset({ kind: 'LESSON', title: '', description: '', recommendation: '' });
      await this.load();
    } catch (e) { this.error.set(errorMessage(e, '登记失败')); }
  }
  async close() {
    this.error.set('');
    try {
      await this.api.post(`/projects/${this.project().id}/close`, this.reason().trim() ? { noLessonsReason: this.reason().trim() } : {});
      this.changed.emit();
    } catch (e) { this.error.set(errorMessage(e, '关闭失败')); }
  }
}
