import { Component, computed, inject, input, output, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { Api, errorMessage } from '../core/api';
import { Ai } from '../core/ai';
import { AiMark } from './ai-mark';
import { Lesson, Project } from '../core/models';

@Component({
  selector: 'app-project-closure',
  imports: [AiMark, ReactiveFormsModule, MatButtonModule, MatFormFieldModule, MatInputModule, MatSelectModule],
  styles: `.aibox { border: 1px dashed var(--mat-sys-primary); border-radius: 8px; padding: 8px 16px; margin: 8px 0; } .box { border: 1px solid var(--mat-sys-outline-variant); border-radius: 8px; padding: 8px 16px; margin: 8px 0; } .meta { font-size: 13px; color: var(--mat-sys-on-surface-variant); }`,
  template: `
    @if (error()) { <div class="error" role="alert">{{ error() }}</div> }
    <h2>经验教训与良好实践</h2>
    @if (ai.on('REPORT') && project().status !== 'CLOSED') {
      <div class="aibox" data-ai="summary">
        <button mat-stroked-button type="button" [disabled]="aiBusy()" (click)="aiSummary()"><span class="pill blue">AI</span> {{ aiBusy() ? '正在起草…' : '起草项目总结和经验教训' }}</button>
        @if (summary()) { <p style="white-space: pre-line" data-summary>{{ summary() }}</p> }
        @for (l of aiLessons(); track $index; let i = $index) {
          <div class="box" [attr.data-ai-lesson]="l.title"><strong>{{ l.kind === 'LESSON' ? '教训' : '良好实践' }} · {{ l.title }}</strong><div class="meta">{{ l.description }}</div><div>建议：{{ l.recommendation }}</div>
            <button mat-button type="button" (click)="adoptLesson(i)">采用为经验教训</button></div>
        }
      </div>
    }
    <form class="row" [formGroup]="form" (ngSubmit)="add()">
      <mat-form-field><mat-label>类型</mat-label><mat-select formControlName="kind"><mat-option value="LESSON">经验教训</mat-option><mat-option value="GOOD_PRACTICE">良好实践</mat-option></mat-select></mat-form-field>
      <mat-form-field style="min-width: 240px"><mat-label>标题</mat-label><input matInput formControlName="title" /></mat-form-field>
      <mat-form-field style="min-width: 300px"><mat-label>发生了什么</mat-label><input matInput formControlName="description" /></mat-form-field>
      <mat-form-field style="min-width: 300px"><mat-label>今后怎么做</mat-label><input matInput formControlName="recommendation" /></mat-form-field>
      <button mat-flat-button type="submit" [disabled]="form.invalid">登记</button>
    </form>
    @for (l of lessons(); track l.id) {
      <div class="box"><strong>{{ l.kind === 'LESSON' ? '教训' : '良好实践' }} · {{ l.title }}</strong> <app-ai-mark entity="LESSON" [id]="l.id" /><div class="meta">{{ l.description }}</div><div>建议：{{ l.recommendation }}</div></div>
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

  readonly ai = inject(Ai);
  readonly aiBusy = signal(false);
  readonly summary = signal('');
  readonly aiLessons = signal<{ kind: 'LESSON' | 'GOOD_PRACTICE'; title: string; description: string; recommendation: string }[]>([]);
  private usageId = '';
  private adopted = false;

  async ngOnInit() { void this.ai.load(); await this.load(); }

  /** 用项目数据（周报数据、绩效计分、已登记的经验教训）起草项目总结；经验教训逐条采纳 */
  async aiSummary() {
    const id = this.project().id;
    this.aiBusy.set(true); this.error.set('');
    try {
      const [report, evaluation] = await Promise.all([this.api.get(`/projects/${id}/weekly-report?days=3650`).catch(() => null), this.api.get<{ pm: unknown }>(`/projects/${id}/evaluation`).catch(() => null)]);
      const d = await this.ai.draft<{ summary: string; lessons: { kind: 'LESSON' | 'GOOD_PRACTICE'; title: string; description: string; recommendation: string }[] }>('REPORT', {
        kind: 'SUMMARY', data: { 项目: { 编号: this.project().code, 名称: this.project().name }, 项目数据: report, 项目经理绩效: evaluation?.pm ?? null, 已登记经验教训: this.lessons().map((l) => l.title) },
      }, id);
      this.usageId = d.usageId; this.adopted = false;
      this.summary.set(d.draft.summary);
      this.aiLessons.set(d.draft.lessons);
    } catch (e) { this.error.set(errorMessage(e, 'AI 起草失败')); } finally { this.aiBusy.set(false); }
  }
  async adoptLesson(i: number) {
    const l = this.aiLessons()[i];
    this.error.set('');
    try {
      const created = await this.api.post<{ id: string }>(`/projects/${this.project().id}/lessons`, { kind: l.kind, title: l.title, description: l.description || l.title, recommendation: l.recommendation || '—' });
      if (!this.adopted) { await this.ai.adopt(this.usageId, true, 'LESSON', created.id); this.adopted = true; }
      this.aiLessons.update((xs) => xs.filter((_, j) => j !== i));
      await this.load();
    } catch (e) { this.error.set(errorMessage(e, '保存失败')); }
  }
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
