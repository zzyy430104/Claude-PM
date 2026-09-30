import { Component, computed, inject, input, signal } from '@angular/core';
import { askText } from '../core/i18n';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { Api, errorMessage } from '../core/api';
import { CostEntryRow, CostSummary, Project, Performance, WbsResponse, WorkPackage } from '../core/models';

@Component({
  selector: 'app-project-cost',
  imports: [ReactiveFormsModule, MatButtonModule, MatFormFieldModule, MatInputModule, MatSelectModule],
  styles: `.evm { display: grid; grid-template-columns: repeat(auto-fit, minmax(128px, 1fr)); gap: 10px; margin: 0 0 8px; } .evm > div { background: var(--pm-card); border: 1px solid var(--pm-line); border-radius: var(--pm-radius); padding: 12px 14px; display: flex; flex-direction: column; } .evm b { font-size: 20px; font-weight: 600; } .evm span { font-size: 12.5px; color: var(--pm-text); } .evm small { font-size: 11.5px; color: var(--pm-muted); } .evm .RED { border-top: 3px solid var(--pm-red); } .evm .AMBER { border-top: 3px solid var(--pm-amber); } .evm .GREEN { border-top: 3px solid var(--pm-green); } table { width: 100%; border-collapse: collapse; font-size: 14px; } th, td { text-align: right; padding: 6px 8px; border-bottom: 1px solid var(--mat-sys-outline-variant); } th:first-child, td:first-child, th:nth-child(2), td:nth-child(2) { text-align: left; } .over { color: var(--mat-sys-error); font-weight: 500; } .sum { margin: 12px 0; }`,
  template: `
    @if (s(); as c) {
      <p class="sum">
        项目预算 {{ c.projectBudget === null ? '未设置' : m(c.projectBudget) }}；已分配 {{ m(c.allocated) }}（未分配 {{ m(c.unallocated) }}）；
        实际成本 {{ m(c.actual) }}；各科目完工估算之和 {{ m(c.eac) }}；
        <span [class.over]="c.overrun">预算偏差 {{ m(c.variance) }}{{ c.overrun ? '（预计超支）' : '' }}</span>
      </p>
    }
    @if (perf(); as pf) {
      <h2>挣值分析</h2>
      <div class="evm">
        <div><b>{{ m(pf.evm.bac) }}</b><span>完工预算 BAC</span></div>
        <div><b>{{ m(pf.evm.pv) }}</b><span>计划值 PV</span><small>到今天按计划应完成的工作量</small></div>
        <div><b>{{ m(pf.evm.ev) }}</b><span>挣值 EV</span><small>实际已完成的工作量</small></div>
        <div><b>{{ m(pf.evm.ac) }}</b><span>实际成本 AC</span></div>
        <div [class]="idxClass(pf.evm.spi, pf)"><b>{{ idx(pf.evm.spi) }}</b><span>进度指数 SPI = EV ÷ PV</span><small>小于 1 表示落后</small></div>
        <div [class]="idxClass(pf.evm.cpi, pf)"><b>{{ idx(pf.evm.cpi) }}</b><span>成本指数 CPI = EV ÷ AC</span><small>小于 1 表示超支</small></div>
        <div><b>{{ m(pf.evm.eac) }}</b><span>完工估算 EAC</span><small>{{ pf.evm.cpi ? '项目预算 ÷ CPI' : '各科目估算之和' }}</small></div>
      </div>
      <p class="muted">
        @if (pf.baselineVersion === null) { 计划批准后开始计算。 }
        @else { 基准：计划批准第 {{ pf.baselineVersion }} 版。{{ pf.evm.basis === 'DURATION' ? '工作包没有填预算，按工期把项目预算分摊到工作包。' : '按工作包预算计算。' }} }
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
        <mat-form-field><mat-label>工作包（可选）</mat-label>
          <mat-select formControlName="workPackageId"><mat-option value="">不指定</mat-option>@for (w of wps(); track w.id) { <mat-option [value]="w.id">{{ w.code }} {{ w.name }}</mat-option> }</mat-select>
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
      <thead><tr><th>日期</th><th>说明</th><th>工作包</th><th>金额</th></tr></thead>
      <tbody>@for (e of entries(); track e.id) { <tr><td>{{ e.entryDate.slice(0, 10) }}</td><td>{{ e.description }}</td><td>{{ wpLabel(e.workPackageId) }}</td><td>{{ e.amount }}</td></tr> }</tbody>
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
  readonly wps = signal<WorkPackage[]>([]);
  readonly perf = signal<Performance | null>(null);
  m(v: number | null) { return v === null ? '—' : Math.round(v).toLocaleString(); }
  idx(v: number | null) { return v === null ? '—' : v.toFixed(2); }
  idxClass(v: number | null, p: Performance) { return v === null ? '' : v < p.thresholds.red ? 'RED' : v < p.thresholds.amber ? 'AMBER' : 'GREEN'; }
  wpLabel(id: string | null | undefined) { const w = this.wps().find((x) => x.id === id); return w ? `${w.code} ${w.name}` : '—'; }
  readonly entryForm = this.fb.group({
    accountId: ['', Validators.required], workPackageId: [''], amount: [0, Validators.required],
    entryDate: [new Date().toISOString().slice(0, 10), Validators.required], description: ['', Validators.required],
  });

  async ngOnInit() { await this.load(); }
  async load() {
    const id = this.project().id;
    this.s.set(await this.api.get<CostSummary>(`/projects/${id}/cost`));
    this.perf.set(await this.api.get<Performance>(`/projects/${id}/performance`));
    if (!this.wps().length) this.wps.set((await this.api.get<WbsResponse>(`/projects/${id}/wbs`)).items.filter((w) => w.isLeaf));
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
      const v = this.entryForm.getRawValue();
      await this.api.post(`/projects/${this.project().id}/cost/entries`, { ...v, workPackageId: v.workPackageId || undefined });
      this.entryForm.patchValue({ amount: 0, description: '' });
    }, '记录失败');
  }
  setEtc(accountId: string) {
    const v = askText('请输入完工尚需成本（ETC）');
    const n = v === null ? NaN : Number(v);
    return Number.isNaN(n) ? Promise.resolve() : this.run(() => this.api.patch(`/projects/${this.project().id}/cost/accounts/${accountId}`, { estimateToComplete: n }), '更新失败');
  }
}
