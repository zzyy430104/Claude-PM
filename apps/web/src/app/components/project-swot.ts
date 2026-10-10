import { Component, computed, inject, input, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { Api, errorMessage } from '../core/api';
import { Project, SwotReview } from '../core/models';

/** 与客户和关键外部供方的 SWOT 评审（ISO 22163 8.1.3.1.2 b） */
@Component({
  selector: 'app-project-swot',
  imports: [ReactiveFormsModule, MatButtonModule, MatFormFieldModule, MatInputModule],
  styles: `
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0 16px; }
    @media (max-width: 900px) { .grid { grid-template-columns: 1fr; } }
    .quad { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 8px; }
    .quad div { border-radius: 8px; padding: 8px 12px; font-size: 13px; white-space: pre-wrap; }
    .quad b { display: block; font-size: 12px; margin-bottom: 2px; }
    .s { background: #e6f3ec; } .w { background: #fbf2df; } .o { background: #e3eefa; } .t { background: #fbeceb; }
  `,
  template: `
    <h2>SWOT 评审（与客户、关键供方）</h2>
    <p class="muted">与客户和关键外部供方一起评审项目的优势、劣势、机会和威胁，形成需要跟进的行动。</p>
    @if (canEdit()) {
      <form [formGroup]="form" (ngSubmit)="add()">
        <div class="row">
          <mat-form-field><mat-label>评审日期</mat-label><input matInput type="date" formControlName="reviewDate" /></mat-form-field>
          <mat-form-field style="min-width: 360px"><mat-label>参加方（客户、供方及人员）</mat-label><input matInput formControlName="participants" /></mat-form-field>
        </div>
        <div class="grid">
          <mat-form-field><mat-label>优势 S</mat-label><textarea matInput formControlName="strengths"></textarea></mat-form-field>
          <mat-form-field><mat-label>劣势 W</mat-label><textarea matInput formControlName="weaknesses"></textarea></mat-form-field>
          <mat-form-field><mat-label>机会 O</mat-label><textarea matInput formControlName="opportunities"></textarea></mat-form-field>
          <mat-form-field><mat-label>威胁 T</mat-label><textarea matInput formControlName="threats"></textarea></mat-form-field>
        </div>
        <mat-form-field style="width: 100%"><mat-label>后续行动</mat-label><textarea matInput formControlName="actions"></textarea></mat-form-field>
        <button mat-flat-button type="submit" [disabled]="form.invalid">记录 SWOT 评审</button>
      </form>
    }
    @if (error()) { <div class="error" role="alert">{{ error() }}</div> }
    @for (r of rows(); track r.id) {
      <div class="box">
        <strong>{{ r.reviewDate.slice(0, 10) }}</strong> · {{ r.participants }}
        <div class="quad">
          <div class="s"><b>优势</b>{{ r.strengths || '—' }}</div>
          <div class="w"><b>劣势</b>{{ r.weaknesses || '—' }}</div>
          <div class="o"><b>机会</b>{{ r.opportunities || '—' }}</div>
          <div class="t"><b>威胁</b>{{ r.threats || '—' }}</div>
        </div>
        @if (r.actions) { <div class="meta" style="margin-top: 6px">后续行动：{{ r.actions }}</div> }
      </div>
    }
  `,
})
export class ProjectSwot {
  private readonly api = inject(Api);
  private readonly fb = inject(FormBuilder).nonNullable;
  readonly project = input.required<Project>();
  readonly rows = signal<SwotReview[]>([]);
  readonly error = signal('');
  readonly canEdit = computed(() => { const p = this.project().permissions; return !!p?.edit?.RISK && this.project().status !== 'CLOSED'; });
  readonly form = this.fb.group({
    reviewDate: [new Date().toISOString().slice(0, 10), Validators.required], participants: ['', [Validators.required, Validators.minLength(2)]],
    strengths: [''], weaknesses: [''], opportunities: [''], threats: [''], actions: [''],
  });

  async ngOnInit() { await this.load(); }
  async load() { this.rows.set(await this.api.get<SwotReview[]>(`/projects/${this.project().id}/swot`)); }

  async add() {
    this.error.set('');
    try {
      await this.api.post(`/projects/${this.project().id}/swot`, this.form.getRawValue());
      this.form.reset({ reviewDate: new Date().toISOString().slice(0, 10), participants: '', strengths: '', weaknesses: '', opportunities: '', threats: '', actions: '' });
      await this.load();
    } catch (e) { this.error.set(errorMessage(e, '保存失败')); }
  }
}
