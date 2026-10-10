import { Component, computed, inject, input, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { Api, errorMessage } from '../core/api';
import { CostPlan, Project, WbsResponse, WorkPackage } from '../core/models';
import { WpDrawer } from './wp-drawer';

const wan = (n: number | null | undefined) => (n === null || n === undefined ? '—' : (n / 10000).toLocaleString('zh-CN', { maximumFractionDigits: 2 }));
const yuan = (n: number) => Math.round(n).toLocaleString('zh-CN');

/** 成本策划：成本上限 → 目标成本（项目预算）→ 成本科目 → 工作包预算（人工按人天 × 角色费率） */
@Component({
  selector: 'app-project-cost-plan',
  imports: [MatButtonModule, WpDrawer],
  styles: `
    .stats { grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); }
    .num { text-align: right !important; white-space: nowrap; font-variant-numeric: tabular-nums; }
    .neg { color: var(--pm-red); }
    .link { border: 0; background: none; padding: 0; font: inherit; color: var(--pm-primary); cursor: pointer; text-align: left; text-decoration: underline; }
    td.nw { white-space: nowrap; }
  `,
  template: `
    @if (error()) { <div class="error" role="alert">{{ error() }}</div> }
    @if (plan(); as p) {
      <div class="stats">
        <div class="stat"><b>{{ wan(p.cap) }}</b><span>成本上限（万元）· 项目要求</span></div>
        <div class="stat"><b>{{ wan(p.target) }}</b><span>目标成本（万元）· 项目预算</span></div>
        <div class="stat"><b>{{ wan(p.accSum) }}</b><span>科目合计（万元）</span></div>
        <div class="stat" [class.red]="p.wpSum > p.accSum"><b>{{ wan(p.wpSum) }}</b><span>工作包合计（万元）</span></div>
      </div>
      <div class="split">
        <div>
          <section class="pcard">
            <header><h2>成本科目</h2><span class="sub">目标成本分到科目，再由工作包承接</span><span class="grow"></span>
              @if (manage() && p.accounts.length) { <button mat-stroked-button type="button" (click)="sync()" [disabled]="busy()">按工作包合计设定科目预算</button> }
            </header>
            @if (!p.accounts.length) {
              <div class="body">还没有成本科目。@if (manage()) { <button mat-flat-button type="button" (click)="defaults()">建默认科目</button> }</div>
            } @else {
              <div class="tblwrap"><table>
                <thead><tr><th>科目</th><th class="num">科目预算</th><th class="num">工作包合计</th><th class="num">未分配</th></tr></thead>
                <tbody>
                  @for (a of p.accounts; track a.id) {
                    <tr><td class="nw">{{ a.code }} {{ a.name }}</td><td class="num">{{ y(a.budget) }}</td><td class="num">{{ y(a.wpTotal) }}</td><td class="num" [class.neg]="a.budget < a.wpTotal">{{ y(a.budget - a.wpTotal) }}</td></tr>
                  }
                </tbody>
              </table></div>
            }
          </section>
          <section class="pcard">
            <header><h2>工作包预算</h2><span class="sub">人工 = 人天 × 职能角色标准费率；点工作包修改</span></header>
            <div class="tblwrap"><table>
              <thead><tr><th>编号</th><th>工作包</th><th>角色</th><th class="num">人天</th><th class="num">费率</th><th class="num">人工</th><th class="num">其他费用</th><th class="num">预算</th></tr></thead>
              <tbody>
                @for (w of p.workPackages; track w.id) {
                  <tr>
                    <td class="nw">{{ w.code }}</td>
                    <td><button type="button" class="link" (click)="open(w.id)">{{ w.isMilestone ? '◆ ' : '' }}{{ w.name }}</button></td>
                    <td class="nw">{{ w.role?.name ?? '—' }}</td>
                    <td class="num">{{ w.personDays || '—' }}</td>
                    <td class="num">{{ w.personDays ? y(w.rate) : '' }}@if (w.rateOverride !== null) { <span class="pill amber">手工</span> }</td>
                    <td class="num">{{ w.labor ? y(w.labor) : '—' }}</td>
                    <td class="num">{{ other(w) ? y(other(w)) : '—' }}</td>
                    <td class="num"><b>{{ y(w.budget) }}</b></td>
                  </tr>
                }
              </tbody>
            </table></div>
          </section>
        </div>
        <aside>
          <section class="pcard">
            <header><h3>计划批准时检查</h3></header>
            <div class="body"><ul class="checks">@for (c of p.checks; track c.key) { <li [class.no]="!c.ok">{{ c.message }}</li> }</ul></div>
          </section>
          <section class="pcard">
            <header><h3>超支怎么提醒</h3></header>
            <div class="body" style="font-size: 13.5px">
              <p style="margin: 0 0 8px"><b>工作包</b>预计完工成本超出预算：WBS 上标“超支”，提醒项目经理和工作包负责人。</p>
              <p style="margin: 0 0 8px"><b>项目总预算</b>完工估算超出目标成本，或 CPI 低于告警线：报警到管理层。</p>
              <p class="muted" style="margin: 0">目标成本即项目预算（在「总览」设定，计划批准后改动走变更）；费率在“企业设置 → 职能角色费率”维护。</p>
            </div>
          </section>
        </aside>
      </div>
    }
    @if (drawerWp(); as w) { <app-wp-drawer [project]="project()" [wp]="w" initialTab="cost" (closed)="drawerWp.set(null)" (changed)="load()" /> }
  `,
})
export class ProjectCostPlan {
  private readonly api = inject(Api);
  readonly project = input.required<Project>();
  readonly plan = signal<CostPlan | null>(null);
  readonly wbs = signal<WorkPackage[]>([]);
  readonly drawerWp = signal<WorkPackage | null>(null);
  readonly error = signal('');
  readonly busy = signal(false);
  readonly manage = computed(() => !!this.project().permissions?.edit?.COST_PLAN && this.project().status !== 'CLOSED');

  ngOnInit() { void this.load(); }
  async load() {
    try {
      const [p, w] = await Promise.all([
        this.api.get<CostPlan>(`/projects/${this.project().id}/cost-plan`),
        this.api.get<WbsResponse>(`/projects/${this.project().id}/wbs`),
      ]);
      this.plan.set(p); this.wbs.set(w.items);
    } catch (e) { this.error.set(errorMessage(e, '加载失败')); }
  }
  wan(n: number | null) { return wan(n); }
  y(n: number) { return yuan(n); }
  other(w: { lines: { amount: number }[] }) { return w.lines.reduce((n, l) => n + l.amount, 0); }
  open(id: string) { const w = this.wbs().find((x) => x.id === id); if (w) this.drawerWp.set(w); }
  private async run(fn: () => Promise<unknown>) {
    this.error.set(''); this.busy.set(true);
    try { await fn(); await this.load(); } catch (e) { this.error.set(errorMessage(e, '操作失败')); } finally { this.busy.set(false); }
  }
  sync() { return this.run(() => this.api.post(`/projects/${this.project().id}/cost-plan/sync-accounts`)); }
  defaults() { return this.run(() => this.api.post(`/projects/${this.project().id}/cost-plan/default-accounts`)); }
}
