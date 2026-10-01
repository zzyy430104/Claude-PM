import { Component, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { Api, errorMessage } from '../core/api';
import { ACCEPT_NEED_LABELS, IMPORTANCE_LABELS, RISK_LEVEL_LABELS, RISK_WHO_LABELS, RiskRule, RiskSettings, RiskWho } from '../core/models';

const IMP = ['LOW', 'MEDIUM', 'HIGH'] as const;
const LEVELS = ['ENTERPRISE', 'PROJECT', 'WORK_PACKAGE'] as const;
const WHO: RiskWho[] = ['OWNER', 'PM', 'MANAGEMENT'];
const NAMES: Record<number, string[]> = { 3: ['低', '中', '高'], 5: ['很低', '低', '中', '高', '很高'] };
interface Defaults { matrix3: number[][]; matrix5: number[][]; criteria: Record<string, string[]>; strategies: RiskSettings['strategies']; rules: Record<string, RiskRule> }

/** 企业设置 → 风险管理：评价矩阵、影响判断标准、应对策略、按“层级 × 重要度”的规则 */
@Component({
  selector: 'app-risk-settings',
  imports: [MatButtonModule],
  styles: `
    .mxg { display: inline-grid; gap: 4px; align-items: center; }
    .mxl { font-size: 12px; color: var(--pm-muted); text-align: right; padding-right: 4px; } .mxl.c { text-align: center; padding: 0; }
    .mx { width: 46px; height: 32px; border-radius: 6px; border: 0; cursor: pointer; font-size: 12px; color: #fff; font-weight: 700; }
    .mx.m0 { background: #8fbf9f; } .mx.m1 { background: #e3b55b; } .mx.m2 { background: #d0684f; }
    td input, td select { font: inherit; font-size: 13.5px; border: 1px solid var(--pm-line); border-radius: 6px; padding: 4px 6px; width: 100%; box-sizing: border-box; background: #fff; }
    td input[type=number] { width: 70px; }
    td label { font-size: 13px; white-space: nowrap; margin-right: 6px; }
    .ok { color: var(--pm-green); margin-left: 8px; }
  `,
  template: `
    <section class="pcard" style="margin-top: 24px">
      <header><h3>风险管理</h3><span class="sub">所有项目和企业风险共用</span></header>
      <div class="body">
        @if (error()) { <div class="error" role="alert">{{ error() }}</div> }
        @if (s(); as x) {
          <h4>评价矩阵</h4>
          <p class="muted">可能性和影响分几级；点格子在 低 / 中 / 高 之间切换，决定重要度。</p>
          <div class="fld" style="display: block; margin-bottom: 10px">分级
            <select (change)="setScale(+$any($event.target).value)" aria-label="分级" style="width: auto; margin-left: 8px">
              <option value="3" [selected]="x.scale === 3">3 × 3</option><option value="5" [selected]="x.scale === 5">5 × 5</option>
            </select>
          </div>
          <div class="mxg" [style.grid-template-columns]="'auto repeat(' + x.scale + ', 46px)'">
            @for (p of desc(); track p) {
              <span class="mxl">可能性 {{ lv(p) }}</span>
              @for (i of asc(); track i) { <button type="button" [class]="'mx m' + x.matrix[p - 1][i - 1]" (click)="cycle(p, i)" [attr.aria-label]="'矩阵 ' + p + ' ' + i">{{ impName(x.matrix[p - 1][i - 1]) }}</button> }
            }
            <span></span>@for (i of asc(); track i) { <span class="mxl c">{{ lv(i) }}</span> }
          </div>
          <p class="muted" style="font-size: 12.5px">横向：影响</p>

          <h4>影响判断标准</h4>
          <div class="tblwrap"><table>
            <thead><tr><th style="width: 110px">维度</th><th>低</th><th>中</th><th>高</th><th></th></tr></thead>
            <tbody>
              @for (c of crit(); track $index; let ci = $index) {
                <tr>
                  <td><input [value]="c[0]" (change)="setCrit(ci, -1, $any($event.target).value)" aria-label="维度" /></td>
                  @for (t of c[1]; track $index; let ti = $index) { <td><input [value]="t" (change)="setCrit(ci, ti, $any($event.target).value)" [attr.aria-label]="c[0] + ' ' + imps[ti]" /></td> }
                  <td><button mat-button type="button" (click)="removeCrit(ci)">删除</button></td>
                </tr>
              }
            </tbody>
          </table></div>
          <button mat-button type="button" (click)="addCrit()">+ 添加维度</button>

          <h4>应对策略</h4>
          <div class="fgrid">
            <label class="fld">风险（用顿号或逗号分隔）<input [value]="x.strategies.RISK.join('、')" (change)="setStrat('RISK', $any($event.target).value)" aria-label="风险应对策略" /></label>
            <label class="fld">机会（用顿号或逗号分隔）<input [value]="x.strategies.OPPORTUNITY.join('、')" (change)="setStrat('OPPORTUNITY', $any($event.target).value)" aria-label="机会应对策略" /></label>
          </div>
          <p class="muted" style="font-size: 12.5px">名为“接受”的策略按下表要求写理由、应急预案或经管理层确认。</p>

          <h4>审批、关闭、通知和复查规则</h4>
          <div class="tblwrap"><table>
            <thead><tr><th>层级</th><th>重要度</th><th>应对审批</th><th>关闭确认</th><th>选“接受”时</th><th>通知</th><th>复查周期（天）</th></tr></thead>
            <tbody>
              @for (k of ruleKeys; track k) {
                @let r = x.rules[k];
                <tr [attr.data-rule]="k">
                  <td>{{ levelLabel(k) }}</td><td>{{ impLabel(k) }}</td>
                  <td><select (change)="setRule(k, 'approve', $any($event.target).value)" aria-label="应对审批">@for (w of who; track w) { <option [value]="w" [selected]="r.approve === w">{{ whoLabel(w) }}</option> }</select></td>
                  <td><select (change)="setRule(k, 'close', $any($event.target).value)" aria-label="关闭确认">@for (w of who; track w) { <option [value]="w" [selected]="r.close === w">{{ whoLabel(w) }}</option> }</select></td>
                  <td><select (change)="setRule(k, 'accept', $any($event.target).value)" aria-label="接受要求">@for (a of accepts; track a[0]) { <option [value]="a[0]" [selected]="r.accept === a[0]">{{ a[1] }}</option> }</select></td>
                  <td>@for (w of who; track w) { <label><input type="checkbox" style="width: auto" [checked]="r.notify.includes(w)" (change)="toggleNotify(k, w, $any($event.target).checked)" />{{ whoLabel(w) }}</label> }</td>
                  <td><input type="number" min="1" max="365" [value]="r.reviewDays" (change)="setRule(k, 'reviewDays', +$any($event.target).value)" aria-label="复查周期" /></td>
                </tr>
              }
            </tbody>
          </table></div>
          <div style="margin-top: 12px">
            <button mat-flat-button type="button" (click)="save()">保存风险管理设置</button>
            <button mat-button type="button" (click)="reset()">恢复默认</button>
            @if (saved()) { <span class="ok">已保存</span> }
          </div>
        }
      </div>
    </section>
  `,
})
export class RiskSettingsEditor {
  private readonly api = inject(Api);
  readonly s = signal<RiskSettings | null>(null);
  readonly crit = signal<[string, string[]][]>([]);
  readonly error = signal('');
  readonly saved = signal(false);
  private defaults: Defaults | null = null;
  readonly imps = ['低', '中', '高'];
  readonly who = WHO;
  readonly accepts = Object.entries(ACCEPT_NEED_LABELS);
  readonly ruleKeys = LEVELS.flatMap((l) => [...IMP].reverse().map((i) => `${l}:${i}`));

  async ngOnInit() {
    try {
      const [s, d] = await Promise.all([this.api.get<RiskSettings>('/risk-settings'), this.api.get<Defaults>('/risk-settings/defaults')]);
      this.defaults = d;
      this.apply(s);
    } catch (e) { this.error.set(errorMessage(e, '加载失败')); }
  }
  private apply(s: RiskSettings) { this.s.set(structuredClone(s)); this.crit.set(Object.entries(s.criteria).map(([k, v]) => [k, [...v]])); }

  desc() { return Array.from({ length: this.s()!.scale }, (_, i) => this.s()!.scale - i); }
  asc() { return Array.from({ length: this.s()!.scale }, (_, i) => i + 1); }
  lv(n: number) { return NAMES[this.s()!.scale][n - 1]; }
  impName(v: number) { return IMPORTANCE_LABELS[IMP[v]]; }
  levelLabel(k: string) { return RISK_LEVEL_LABELS[k.split(':')[0] as (typeof LEVELS)[number]]; }
  impLabel(k: string) { return IMPORTANCE_LABELS[k.split(':')[1] as (typeof IMP)[number]]; }
  whoLabel(w: RiskWho) { return RISK_WHO_LABELS[w]; }

  private edit(fn: (s: RiskSettings) => void) { this.saved.set(false); this.s.update((x) => { const n = structuredClone(x!); fn(n); return n; }); }
  setScale(n: number) { this.edit((s) => { s.scale = n as 3 | 5; s.matrix = structuredClone(n === 5 ? this.defaults!.matrix5 : this.defaults!.matrix3); }); }
  cycle(p: number, i: number) { this.edit((s) => { s.matrix[p - 1][i - 1] = (s.matrix[p - 1][i - 1] + 1) % 3; }); }
  setCrit(ci: number, ti: number, v: string) {
    this.saved.set(false);
    this.crit.update((c) => c.map((row, i) => (i !== ci ? row : ti < 0 ? [v.trim(), row[1]] : [row[0], row[1].map((t, j) => (j === ti ? v : t))])));
  }
  addCrit() { this.crit.update((c) => [...c, ['新维度', ['', '', '']]]); }
  removeCrit(ci: number) { this.crit.update((c) => c.filter((_, i) => i !== ci)); }
  setStrat(k: 'RISK' | 'OPPORTUNITY', v: string) { this.edit((s) => { s.strategies[k] = v.split(/[、,，]/).map((x) => x.trim()).filter(Boolean); }); }
  setRule<K extends keyof RiskRule>(k: string, f: K, v: RiskRule[K]) { this.edit((s) => { s.rules[k] = { ...s.rules[k], [f]: v }; }); }
  toggleNotify(k: string, w: RiskWho, on: boolean) {
    this.edit((s) => { const n = s.rules[k].notify.filter((x) => x !== w); s.rules[k] = { ...s.rules[k], notify: on ? [...n, w] : n }; });
  }
  reset() {
    const d = this.defaults;
    if (!d || !confirm('恢复为默认的 5 × 5 矩阵、判断标准、策略和规则？')) return;
    this.apply({ scale: 5, matrix: d.matrix5, criteria: d.criteria, strategies: d.strategies, rules: d.rules });
    this.saved.set(false);
  }
  async save() {
    const s = this.s()!;
    const crit = this.crit();
    if (crit.some(([k, v]) => !k || v.some((t) => !t.trim()))) { this.error.set('判断标准：每个维度都要填写名称和 低 / 中 / 高 三档'); return; }
    this.error.set('');
    try {
      this.apply(await this.api.put<RiskSettings>('/risk-settings', { ...s, criteria: Object.fromEntries(crit.map(([k, v]) => [k, v.map((t) => t.trim())])) }));
      this.saved.set(true);
    } catch (e) { this.error.set(errorMessage(e, '保存失败')); }
  }
}
