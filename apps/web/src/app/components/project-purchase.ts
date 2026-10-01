import { Component, inject, input, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { Api, errorMessage } from '../core/api';
import { askText } from '../core/i18n';
import { Project, PURCHASE_STATUS_LABELS, PurchaseItemRow, PurchasePlanView } from '../core/models';

const yuan = (n: number) => Math.round(n).toLocaleString('zh-CN');

/** 采购计划：物料清单、长周期、下单 / 到货 / 结算（承诺成本），量产准备自动检查 */
@Component({
  selector: 'app-project-purchase',
  imports: [MatButtonModule],
  styles: `
    .bar { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; background: var(--pm-card); border: 1px solid var(--pm-line); border-radius: var(--pm-radius); padding: 12px 18px; margin: 0 0 16px; font-size: 14px; }
    .bar .sp { flex: 1; }
    .kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 12px; margin: 0 0 16px; }
    .kpi { background: var(--pm-card); border: 1px solid var(--pm-line); border-radius: var(--pm-radius); padding: 14px 18px; }
    .kpi .l { color: var(--pm-muted); font-size: 13px; } .kpi .v { font-size: 28px; font-weight: 800; margin: 4px 0; } .kpi .v.red { color: var(--pm-red); } .kpi .s { color: var(--pm-muted); font-size: 12.5px; }
    td input, td select { font: inherit; font-size: 13.5px; border: 1px solid transparent; background: transparent; padding: 4px 6px; border-radius: 6px; width: 100%; box-sizing: border-box; }
    td input:hover, td input:focus, td select:hover { border-color: var(--pm-line); background: #fff; }
    td input[type=date] { min-width: 130px; } td.code { font-family: ui-monospace, monospace; color: var(--pm-muted); white-space: nowrap; }
    td.acts { white-space: nowrap; } .num { text-align: right; white-space: nowrap; }
    tr.off td { color: var(--pm-muted); text-decoration: line-through; }
    .add { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 8px 12px; align-items: end; }
    ul.check { list-style: none; padding: 0; margin: 0; font-size: 14px; } ul.check li { padding: 4px 0; } ul.check li::before { content: '○ '; color: var(--pm-muted); } ul.check li.ok::before { content: '✓ '; color: var(--pm-green); }
  `,
  template: `
    @if (error()) { <div class="error" role="alert">{{ error() }}</div> }
    @if (v(); as x) {
      <div class="bar" data-plan>
        @if (x.plan.version) {
          <b>采购计划 v{{ x.plan.version }}</b><span>{{ x.plan.approvedAt?.slice(0, 10) }} {{ x.plan.approvedBy }} 批准</span>
          @if (x.plan.dirty) { <span class="pill amber">已修订，待重新批准</span> } @else { <span class="muted">修订后需重新批准</span> }
        } @else { <b>采购计划</b><span class="pill">未批准</span> }
        <span class="sp"></span>
        @if (x.canApprove && (!x.plan.version || x.plan.dirty)) { <button mat-flat-button type="button" (click)="approve()">{{ x.plan.version ? '重新批准' : '批准采购计划' }}</button> }
      </div>
      <div class="kpis">
        <div class="kpi"><div class="l">物料</div><div class="v">{{ x.stats.items }}</div><div class="s">关联 {{ x.stats.workPackages }} 个工作包</div></div>
        <div class="kpi"><div class="l">长周期物料</div><div class="v">{{ x.stats.longLeadOrdered }} / {{ x.stats.longLead }}</div><div class="s">{{ x.stats.longLead && x.stats.longLeadOrdered === x.stats.longLead ? '已全部下单' : '已下单 / 全部' }}</div></div>
        <div class="kpi"><div class="l">到货</div><div class="v">{{ x.stats.receivedPct }}%</div><div class="s">承诺成本 {{ y(x.stats.committed) }} 元</div></div>
        <div class="kpi"><div class="l">需关注</div><div class="v" [class.red]="x.stats.overdue.length > 0">{{ x.stats.overdue.length }}</div><div class="s">{{ x.stats.overdue.length ? x.stats.overdue.join('、') + ' 逾期未下单' : '没有逾期未下单' }}</div></div>
      </div>

      <section class="pcard">
        <header><h3>物料清单</h3><span class="sub grow">下单生成承诺成本，结算后转为实际成本</span>
          <label style="font-size: 13px"><input type="checkbox" [checked]="showOff()" (change)="showOff.set($any($event.target).checked)" /> 显示已取消</label></header>
        <div class="tblwrap"><table>
          <thead><tr><th>编号</th><th>物料</th><th>供应商</th><th>数量</th><th>需求日期</th><th>最晚下单</th><th>长周期</th><th>工作包</th><th class="num">金额（元）</th><th>状态</th><th></th></tr></thead>
          <tbody>
            @for (i of rows(); track i.id) {
              <tr [class.off]="i.status === 'CANCELLED'" [attr.data-item]="i.name">
                <td class="code">{{ i.code }}</td>
                @if (x.canEdit && i.status !== 'CANCELLED' && !i.settledAt) {
                  <td><input [value]="i.name" (change)="patch(i, { name: $any($event.target).value })" aria-label="物料" /></td>
                  <td><input [value]="i.supplier" (change)="patch(i, { supplier: $any($event.target).value })" aria-label="供应商" /></td>
                  <td><input [value]="i.quantity" (change)="patch(i, { quantity: $any($event.target).value })" aria-label="数量" style="width: 90px" /></td>
                  <td><input type="date" [value]="i.needDate?.slice(0, 10) ?? ''" (change)="patch(i, { needDate: $any($event.target).value || null })" aria-label="需求日期" /></td>
                  <td><input type="date" [value]="i.orderBy?.slice(0, 10) ?? ''" (change)="patch(i, { orderBy: $any($event.target).value || null })" aria-label="最晚下单" /></td>
                  <td><input type="checkbox" style="width: auto" [checked]="i.longLead" (change)="patch(i, { longLead: $any($event.target).checked })" aria-label="长周期" /></td>
                  <td><select (change)="patch(i, { workPackageId: $any($event.target).value || null })" aria-label="工作包"><option value="">—</option>@for (w of x.workPackages; track w.id) { <option [value]="w.id" [selected]="w.id === i.workPackageId">{{ w.code }} {{ w.name }}</option> }</select></td>
                  <td class="num">@if (i.status === 'PLANNED') { <input type="number" min="0" [value]="i.amount" (change)="patch(i, { amount: +$any($event.target).value })" aria-label="金额" style="width: 110px; text-align: right" /> } @else { {{ y(i.amount) }} }</td>
                } @else {
                  <td>{{ i.name }}</td><td>{{ i.supplier }}</td><td>{{ i.quantity }}</td><td>{{ i.needDate?.slice(5, 10) }}</td><td>{{ i.orderBy?.slice(5, 10) ?? '—' }}</td>
                  <td>@if (i.longLead) { <span class="pill amber">长周期</span> }</td><td>{{ i.wp?.code ?? '—' }}</td><td class="num">{{ y(i.amount) }}</td>
                }
                <td>
                  @if (i.overdue) { <span class="pill red">逾期未下单</span> }
                  @else if (i.status === 'PARTIAL') { <span class="pill amber">部分到货 {{ i.receivedPct }}%</span> }
                  @else { <span [class]="'pill ' + color(i)">{{ label(i) }}</span> }
                  @if (i.settledAt) { <span class="pill green">已结算</span> }
                  @if (i.orderNo) { <div class="muted" style="font-size: 12px">订单 {{ i.orderNo }}</div> }
                </td>
                <td class="acts">
                  @if (x.canEdit && i.status !== 'CANCELLED' && !i.settledAt) {
                    @if (i.status === 'PLANNED') { <button mat-button type="button" (click)="order(i)">下单</button><button mat-button type="button" (click)="remove(i)">删除</button> }
                    @else { <button mat-button type="button" (click)="receive(i)">到货</button><button mat-button type="button" (click)="settle(i)">结算</button> }
                    <button mat-button type="button" (click)="cancel(i)">取消</button>
                  }
                </td>
              </tr>
            } @empty { <tr><td colspan="11" class="muted">还没有物料</td></tr> }
          </tbody>
        </table></div>
        @if (x.canEdit) {
          <div class="body">
            <div class="add">
              <label class="fld">物料 <span class="req">*</span><input #n aria-label="新物料名称" /></label>
              <label class="fld">供应商<input #s aria-label="新物料供应商" /></label>
              <label class="fld">数量<input #q aria-label="新物料数量" /></label>
              <label class="fld">需求日期<input #d type="date" aria-label="新物料需求日期" /></label>
              <label class="fld">工作包<select #w aria-label="新物料工作包"><option value="">—</option>@for (wp of x.workPackages; track wp.id) { <option [value]="wp.id">{{ wp.code }} {{ wp.name }}{{ wp.isPurchase ? '（采购）' : '' }}</option> }</select></label>
              <label class="fld">成本科目<select #a aria-label="新物料成本科目">@for (ac of x.accounts; track ac.id) { <option [value]="ac.id" [selected]="ac.name === '材料'">{{ ac.code }} {{ ac.name }}</option> }</select></label>
              <label class="fld">金额（元）<input #m type="number" min="0" aria-label="新物料金额" /></label>
              <label style="font-size: 14px"><input #l type="checkbox" /> 长周期</label>
              <button mat-flat-button type="button" (click)="add(n.value, s.value, q.value, d.value, w.value, a.value, +m.value, l.checked); n.value = ''; s.value = ''; q.value = ''; m.value = ''; l.checked = false">+ 新增物料</button>
            </div>
          </div>
        }
      </section>

      <section class="pcard">
        <header><h3>量产准备评审会自动检查</h3><span class="sub">阶段检查清单里的“采购计划已批准”“长周期物料已下单”由系统判断</span></header>
        <div class="body"><ul class="check">@for (c of x.checks; track c.message) { <li [class.ok]="c.ok">{{ c.message }}</li> }</ul></div>
      </section>
    }
  `,
})
export class ProjectPurchase {
  private readonly api = inject(Api);
  readonly project = input.required<Project>();
  readonly v = signal<PurchasePlanView | null>(null);
  readonly error = signal('');
  readonly showOff = signal(false);
  private base = () => `/projects/${this.project().id}`;

  rows() { return (this.v()?.items ?? []).filter((i) => this.showOff() || i.status !== 'CANCELLED'); }
  y(n: number) { return yuan(n); }
  label(i: PurchaseItemRow) { return PURCHASE_STATUS_LABELS[i.status]; }
  color(i: PurchaseItemRow) { return i.status === 'RECEIVED' ? 'green' : i.status === 'ORDERED' ? 'blue' : ''; }

  async ngOnInit() { await this.load(); }
  async load() {
    try { this.v.set(await this.api.get<PurchasePlanView>(`${this.base()}/purchase-plan`)); } catch (e) { this.error.set(errorMessage(e, '加载失败')); }
  }
  private async run(fn: () => Promise<unknown>, fallback: string) {
    this.error.set('');
    try { await fn(); } catch (e) { this.error.set(errorMessage(e, fallback)); }
    await this.load();
  }
  add(name: string, supplier: string, quantity: string, needDate: string, workPackageId: string, accountId: string, amount: number, longLead: boolean) {
    if (!name.trim()) { this.error.set('请填写物料名称'); return; }
    return this.run(() => this.api.post(`${this.base()}/purchase-items`, {
      name: name.trim(), supplier, quantity, needDate: needDate || undefined, workPackageId: workPackageId || undefined, accountId: accountId || undefined, amount: amount || 0, longLead,
    }), '新增失败');
  }
  patch(i: PurchaseItemRow, p: Record<string, unknown>) {
    if (p['name'] !== undefined && !(p['name'] as string).trim()) return this.load();
    return this.run(() => this.api.patch(`${this.base()}/purchase-items/${i.id}`, p), '保存失败');
  }
  remove(i: PurchaseItemRow) { if (confirm(`删除 ${i.code} ${i.name}？`)) return this.run(() => this.api.delete(`${this.base()}/purchase-items/${i.id}`), '删除失败'); return undefined; }
  approve() { return this.run(() => this.api.post(`${this.base()}/purchase-plan/approve`, {}), '批准失败'); }
  order(i: PurchaseItemRow) {
    const orderNo = askText(`${i.code} ${i.name} 下单：订单号（可不填）`);
    if (orderNo === null) return;
    return this.run(() => this.api.post(`${this.base()}/purchase-items/${i.id}/order`, { orderNo: orderNo || undefined }), '下单失败');
  }
  receive(i: PurchaseItemRow) {
    const v = askText(`${i.code} ${i.name} 已到货比例（0–100）`);
    if (v === null || v.trim() === '') return;
    const n = Math.round(Number(v));
    if (!Number.isFinite(n) || n < 0 || n > 100) { this.error.set('到货比例应在 0–100 之间'); return; }
    return this.run(() => this.api.post(`${this.base()}/purchase-items/${i.id}/receive`, { receivedPct: n }), '保存失败');
  }
  settle(i: PurchaseItemRow) {
    const v = askText(`${i.code} ${i.name} 结算金额（元，不填按下单金额 ${yuan(i.amount)}）`);
    if (v === null) return;
    const amount = v.trim() ? Number(v) : undefined;
    if (amount !== undefined && (!Number.isFinite(amount) || amount < 0)) { this.error.set('金额不正确'); return; }
    return this.run(() => this.api.post(`${this.base()}/purchase-items/${i.id}/settle`, amount === undefined ? {} : { amount }), '结算失败');
  }
  cancel(i: PurchaseItemRow) { if (confirm(`取消 ${i.code} ${i.name}？已下单的承诺成本会去掉。`)) return this.run(() => this.api.post(`${this.base()}/purchase-items/${i.id}/cancel`, {}), '取消失败'); return undefined; }
}
