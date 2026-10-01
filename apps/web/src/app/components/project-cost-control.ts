import { Component, computed, inject, input, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { Api, errorMessage } from '../core/api';
import { CostPlan, Project, WbsResponse, WorkPackage, WpCost } from '../core/models';
import { WpDrawer } from './wp-drawer';

interface Commitment { id: string; accountId: string; workPackageId: string | null; amount: string; description: string; entryDate: string }
interface Person { id: string; name: string }
const yuan = (n: number) => Math.round(n).toLocaleString('zh-CN');

/** 成本控制：项目总预算是否异常、工作包超支、承诺成本（已下单未结算） */
@Component({
  selector: 'app-project-cost-control',
  imports: [MatButtonModule, WpDrawer],
  styles: `
    .num { text-align: right !important; white-space: nowrap; font-variant-numeric: tabular-nums; }
    .link { border: 0; background: none; padding: 0; font: inherit; color: var(--pm-primary); cursor: pointer; text-align: left; text-decoration: underline; }
    td.wpc { min-width: 170px; }
    .fgrid { margin: 0; align-items: end; }
  `,
  template: `
    @if (error()) { <div class="error" role="alert">{{ error() }}</div> }
    @if (plan(); as p) {
      @if (p.alarm) {
        <div class="banner red"><b>项目总预算异常（已报警至管理层）：</b>完工估算 {{ y(p.eac) }} 元@if (p.target !== null && p.eac > p.target) { ，超过目标成本 {{ y(p.target) }} 元 } @else { ，成本绩效指数低于告警线 }。需要追加预算时走变更。</div>
      } @else {
        <div class="banner">项目总预算正常：完工估算 {{ y(p.eac) }} 元@if (p.target !== null) { ，目标成本 {{ y(p.target) }} 元 }。超出目标成本或 CPI 低于告警线时自动报警到管理层。</div>
      }
      <section class="pcard">
        <header><h2>工作包超支</h2><span class="sub">预计完工 = 实际 + 承诺 + 还需；超 10% 以内为黄、以上为红</span></header>
        <div class="tblwrap"><table>
          <thead><tr><th>工作包</th><th>负责人</th><th class="num">预算</th><th class="num">实际</th><th class="num">承诺</th><th class="num">预计完工</th><th>状态</th></tr></thead>
          <tbody>
            @for (w of over(); track w.id) {
              <tr>
                <td class="wpc"><button type="button" class="link" (click)="open(w.id)">{{ w.code }} {{ w.name }}</button></td>
                <td>{{ person(w.ownerId) }}</td>
                <td class="num">{{ y(w.budget) }}</td><td class="num">{{ y(w.actual) }}</td><td class="num">{{ y(w.commitment) }}</td><td class="num"><b>{{ y(w.eac) }}</b></td>
                <td><span class="pill" [class.red]="w.state === 'RED'" [class.amber]="w.state === 'AMBER'">超 {{ pct(w) }}%</span></td>
              </tr>
            } @empty { <tr><td colspan="7" class="muted">没有超支的工作包</td></tr> }
          </tbody>
        </table></div>
      </section>
      <section class="pcard">
        <header><h2>承诺成本</h2><span class="sub">已下单、未结算的金额；结算后登记负数冲减</span></header>
        @if (manage()) {
          <div class="body">
            <div class="fgrid">
              <label class="fld">科目<select #acc>@for (a of p.accounts; track a.id) { <option [value]="a.id">{{ a.code }} {{ a.name }}</option> }</select></label>
              <label class="fld">工作包<select #wp><option value="">（不指定）</option>@for (w of p.workPackages; track w.id) { <option [value]="w.id">{{ w.code }} {{ w.name }}</option> }</select></label>
              <label class="fld">金额（元）<input #amt type="number" aria-label="承诺金额" /></label>
              <label class="fld">日期<input #dt type="date" [value]="today" /></label>
              <label class="fld">说明<input #ds aria-label="承诺说明" placeholder="如：采购订单 PO-0012" /></label>
              <button mat-stroked-button type="button" (click)="addCommitment(acc.value, wp.value, amt.value, dt.value, ds.value)">登记</button>
            </div>
          </div>
        }
        <div class="tblwrap"><table>
          <thead><tr><th>日期</th><th>科目</th><th>工作包</th><th>说明</th><th class="num">金额</th></tr></thead>
          <tbody>
            @for (c of commitments(); track c.id) {
              <tr><td>{{ c.entryDate.slice(0, 10) }}</td><td>{{ accName(c.accountId) }}</td><td>{{ wpCode(c.workPackageId) }}</td><td>{{ c.description }}</td><td class="num">{{ y(+c.amount) }}</td></tr>
            } @empty { <tr><td colspan="5" class="muted">暂无承诺成本</td></tr> }
          </tbody>
        </table></div>
      </section>
    }
    @if (drawerWp(); as w) { <app-wp-drawer [project]="project()" [wp]="w" initialTab="cost" (closed)="drawerWp.set(null)" (changed)="load()" /> }
  `,
})
export class ProjectCostControl {
  private readonly api = inject(Api);
  readonly project = input.required<Project>();
  readonly plan = signal<CostPlan | null>(null);
  readonly commitments = signal<Commitment[]>([]);
  readonly people = signal<Person[]>([]);
  readonly wbs = signal<WorkPackage[]>([]);
  readonly drawerWp = signal<WorkPackage | null>(null);
  readonly error = signal('');
  readonly today = new Date().toISOString().slice(0, 10);
  readonly manage = computed(() => !!this.project().permissions?.manage && this.project().status !== 'CLOSED');
  readonly over = computed(() => (this.plan()?.workPackages ?? []).filter((w) => w.state));

  ngOnInit() { void this.load(); }
  async load() {
    try {
      const id = this.project().id;
      const [p, c, people, wbs] = await Promise.all([
        this.api.get<CostPlan>(`/projects/${id}/cost-plan`),
        this.api.get<Commitment[]>(`/projects/${id}/cost/commitments`),
        this.api.get<Person[]>('/users/directory'),
        this.api.get<WbsResponse>(`/projects/${id}/wbs`),
      ]);
      this.plan.set(p); this.commitments.set(c); this.people.set(people); this.wbs.set(wbs.items);
    } catch (e) { this.error.set(errorMessage(e, '加载失败')); }
  }
  y(n: number) { return yuan(n); }
  pct(w: WpCost) { return Math.round((w.eac / Math.max(w.budget, 1) - 1) * 100); }
  person(id: string | null) { return this.people().find((p) => p.id === id)?.name ?? '—'; }
  accName(id: string) { return this.plan()?.accounts.find((a) => a.id === id)?.name ?? ''; }
  wpCode(id: string | null) { return id ? this.plan()?.workPackages.find((w) => w.id === id)?.code ?? '' : '—'; }
  open(id: string) { const w = this.wbs().find((x) => x.id === id); if (w) this.drawerWp.set(w); }
  async addCommitment(accountId: string, workPackageId: string, amount: string, entryDate: string, description: string) {
    this.error.set('');
    if (!+amount || !description.trim()) { this.error.set('请填写金额和说明'); return; }
    try {
      await this.api.post(`/projects/${this.project().id}/cost/commitments`, { accountId, workPackageId: workPackageId || undefined, amount: +amount, entryDate, description: description.trim() });
      await this.load();
    } catch (e) { this.error.set(errorMessage(e, '登记失败')); }
  }
}
