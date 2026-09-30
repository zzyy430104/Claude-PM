import { Component, computed, inject, input, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { Api, errorMessage } from '../core/api';
import { CostEntryRow, CostSummary, Project } from '../core/models';

@Component({
  selector: 'app-project-cost',
  imports: [ReactiveFormsModule, MatButtonModule, MatFormFieldModule, MatInputModule, MatSelectModule],
  styles: `table { width: 100%; border-collapse: collapse; font-size: 14px; } th, td { text-align: right; padding: 6px 8px; border-bottom: 1px solid var(--mat-sys-outline-variant); } th:first-child, td:first-child, th:nth-child(2), td:nth-child(2) { text-align: left; } .over { color: var(--mat-sys-error); font-weight: 500; } .sum { margin: 12px 0; }`,
  template: `
    @if (s(); as c) {
      <p class="sum">
        项目预算 {{ c.projectBudget ?? '未设置' }}；已分配 {{ c.allocated }}（未分配 {{ c.unallocated ?? '—' }}）；
        实际成本 {{ c.actual }}；完工估算（EAC）{{ c.eac }}；
        <span [class.over]="c.overrun">预算偏差 {{ c.variance ?? '—' }}{{ c.overrun ? '（预计超支）' : '' }}</span>
      </p>
    }
    @if (error()) { <div class="error" role="alert">{{ error() }}</div> }
    @if (manage()) {
      <form class="row" [formGroup]="accountForm" (ngSubmit)="addAccount()">
        <mat-form-field><mat-label>科目编号</mat-label><input matInput formControlName="code" /></mat-form-field>
        <mat-form-field><mat-label>科目名称</mat-label><input matInput formControlName="name" /></mat-form-field>
        <mat-form-field><mat-label>科目预算</mat-label><input matInput type="number" formControlName="budget" /></mat-form-field>
        <button mat-flat-button type="submit" [disabled]="accountForm.invalid">添加成本科目</button>
      </form>
      <form class="row" [formGroup]="entryForm" (ngSubmit)="addEntry()">
        <mat-form-field><mat-label>科目</mat-label>
          <mat-select formControlName="accountId">@for (a of s()?.accounts ?? []; track a.id) { <mat-option [value]="a.id">{{ a.code }} {{ a.name }}</mat-option> }</mat-select>
        </mat-form-field>
        <mat-form-field><mat-label>金额（负数为冲销）</mat-label><input matInput type="number" formControlName="amount" /></mat-form-field>
        <mat-form-field><mat-label>日期</mat-label><input matInput type="date" formControlName="entryDate" /></mat-form-field>
        <mat-form-field style="min-width: 240px"><mat-label>说明</mat-label><input matInput formControlName="description" /></mat-form-field>
        <button mat-flat-button type="submit" [disabled]="entryForm.invalid">记录成本</button>
      </form>
    }
    <table>
      <thead><tr><th>科目</th><th>名称</th><th>预算</th><th>实际</th><th>尚需（ETC）</th><th>完工估算（EAC）</th><th>偏差</th><th></th></tr></thead>
      <tbody>
        @for (a of s()?.accounts ?? []; track a.id) {
          <tr>
            <td>{{ a.code }}</td><td>{{ a.name }}</td><td>{{ a.budget }}</td><td>{{ a.actual }}</td>
            <td>{{ a.etc }}{{ a.etcIsManual ? '（人工）' : '' }}</td><td>{{ a.eac }}</td>
            <td [class.over]="a.overrun">{{ a.variance }}</td>
            <td>@if (manage()) { <button mat-button (click)="setEtc(a.id)">调整尚需</button> }</td>
          </tr>
        }
      </tbody>
    </table>
    <h3>成本记录（只增不改，更正请录入负数冲销）</h3>
    <table>
      <thead><tr><th>日期</th><th>说明</th><th>金额</th></tr></thead>
      <tbody>@for (e of entries(); track e.id) { <tr><td>{{ e.entryDate.slice(0, 10) }}</td><td>{{ e.description }}</td><td>{{ e.amount }}</td></tr> }</tbody>
    </table>
  `,
})
export class ProjectCost {
  private readonly api = inject(Api);
  private readonly fb = inject(FormBuilder).nonNullable;
  readonly project = input.required<Project>();
  readonly s = signal<CostSummary | null>(null);
  readonly entries = signal<CostEntryRow[]>([]);
  readonly error = signal('');
  readonly manage = computed(() => !!this.project().permissions?.manage);
  readonly accountForm = this.fb.group({ code: ['', Validators.required], name: ['', Validators.required], budget: [0, Validators.min(0)] });
  readonly entryForm = this.fb.group({
    accountId: ['', Validators.required], amount: [0, Validators.required],
    entryDate: [new Date().toISOString().slice(0, 10), Validators.required], description: ['', Validators.required],
  });

  async ngOnInit() { await this.load(); }
  async load() {
    const id = this.project().id;
    this.s.set(await this.api.get<CostSummary>(`/projects/${id}/cost`));
    this.entries.set(await this.api.get<CostEntryRow[]>(`/projects/${id}/cost/entries`));
  }
  private async run(fn: () => Promise<unknown>, fallback: string) {
    this.error.set('');
    try { await fn(); } catch (e) { this.error.set(errorMessage(e, fallback)); }
    await this.load();
  }
  addAccount() {
    return this.run(async () => {
      await this.api.post(`/projects/${this.project().id}/cost/accounts`, this.accountForm.getRawValue());
      this.accountForm.reset({ code: '', name: '', budget: 0 });
    }, '添加失败');
  }
  addEntry() {
    return this.run(async () => {
      await this.api.post(`/projects/${this.project().id}/cost/entries`, this.entryForm.getRawValue());
      this.entryForm.patchValue({ amount: 0, description: '' });
    }, '记录失败');
  }
  setEtc(accountId: string) {
    const v = window.prompt('请输入完工尚需成本（ETC）');
    const n = v === null ? NaN : Number(v);
    return Number.isNaN(n) ? Promise.resolve() : this.run(() => this.api.patch(`/projects/${this.project().id}/cost/accounts/${accountId}`, { estimateToComplete: n }), '更新失败');
  }
}
