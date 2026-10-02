import { Component, computed, inject, input, output, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { Api, errorMessage } from '../core/api';
import { Discussion } from './discussion';
import { AuthService } from '../core/auth.service';
import { Brand } from '../core/brand';
import { portalToBody } from '../core/portal';
import {
  CostPlan, INSPECTION_RESULT_LABELS, InspectionItem, InspectionResult, InspectionTemplate, Project, WorkPackage, WpCost, WP_STATUS_LABELS,
} from '../core/models';

interface Person { id: string; name: string }
export type DrawerTab = 'time' | 'cost' | 'qual' | 'talk';
const yuan = (n: number) => Math.round(n).toLocaleString('zh-CN');

/** 工作包详情：时间、成本（预算策划 + 执行）、质量（检验 / 验证项与结果） */
@Component({
  selector: 'app-wp-drawer',
  imports: [MatButtonModule, Discussion],
  styles: `
    .shade { position: fixed; inset: 0; background: rgba(20, 26, 24, .38); z-index: 1000; display: flex; justify-content: flex-end; }
    .win { background: var(--pm-card); width: min(640px, 100%); height: 100%; display: flex; flex-direction: column; box-shadow: -8px 0 24px rgba(0,0,0,.15); }
    .win > header { display: flex; justify-content: space-between; gap: 12px; padding: 16px 20px 6px; }
    .win > header h2 { margin: 2px 0 0 !important; font-size: 18px; }
    .x { border: 0; background: none; font-size: 20px; cursor: pointer; color: var(--pm-muted); }
    nav { display: flex; gap: 4px; border-bottom: 1px solid var(--pm-line); padding: 0 20px; }
    nav button { border: 0; background: none; padding: 9px 14px; font: inherit; color: var(--pm-muted); border-bottom: 2px solid transparent; cursor: pointer; }
    nav button[aria-selected=true] { color: var(--pm-text); font-weight: 700; border-bottom-color: var(--pm-primary); }
    .body { flex: 1; overflow: auto; padding: 16px 20px; }
    h4 { margin: 4px 0 8px; font-size: 14px; }
    dl.kv { display: grid; grid-template-columns: 110px 1fr; gap: 8px 12px; margin: 0 0 16px; font-size: 14px; } dl.kv dt { color: var(--pm-muted); } dl.kv dd { margin: 0; }
    .num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
    input.sm, select.sm { font: inherit; font-size: 14px; border: 1px solid var(--pm-line); border-radius: 8px; padding: 5px 8px; background: #fff; }
    input.sm[type=number] { width: 96px; }
    table { width: 100%; }
    .warn { background: var(--pm-red-bg); color: #6d2a1d; border-radius: 10px; padding: 10px 12px; font-size: 13.5px; margin: 8px 0; }
    .qi { border: 1px solid var(--pm-line); border-radius: 12px; padding: 10px 12px; margin: 0 0 10px; display: flex; flex-direction: column; gap: 8px; }
    .qi.bad { border-color: var(--pm-red); background: #fdf3f0; }
    .qh { display: flex; gap: 8px; align-items: center; } .qh input.name { flex: 1; font-weight: 600; }
    .qg { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 10px; } .qg label { display: flex; flex-direction: column; gap: 3px; font-size: 12px; color: var(--pm-muted); }
    .qr { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; font-size: 13px; }
    .tools { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-top: 8px; } .tools .sp { flex: 1; }
    .win > footer { padding: 10px 20px; border-top: 1px solid var(--pm-line); font-size: 12.5px; color: var(--pm-muted); }
    @media (max-width: 640px) { .qg { grid-template-columns: 1fr; } }
  `,
  template: `
    <div class="shade" (click)="$event.target === $event.currentTarget && closed.emit()">
      <div class="win" role="dialog" [attr.aria-label]="'工作包 ' + wp().code">
        <header><div><div class="muted" style="font-size: 12px">工作包</div><h2>{{ wp().code }} {{ wp().name }}</h2></div><button class="x" type="button" (click)="closed.emit()" aria-label="关闭">✕</button></header>
        <nav role="tablist">
          @for (t of tabs; track t[0]) { <button type="button" role="tab" [attr.aria-selected]="tab() === t[0]" (click)="tab.set(t[0])">{{ t[1] }}</button> }
        </nav>
        <div class="body">
          @if (error()) { <div class="error" role="alert">{{ error() }}</div> }
          @switch (tab()) {
            @case ('time') {
              <dl class="kv">
                <dt>责任人</dt><dd>{{ ownerName() || '未指定' }}</dd>
                <dt>工期</dt><dd>{{ wp().isMilestone ? '里程碑' : wp().durationDays + ' 个工作日' }}</dd>
                <dt>计划</dt><dd>{{ wp().scheduledStart }} → {{ wp().scheduledEnd }}</dd>
                @if (wp().latestStart) { <dt>最晚开始</dt><dd>{{ wp().latestStart }}@if (wp().startTooLate) { <span class="pill red">已过</span> }</dd> }
                <dt>关键路径</dt><dd>{{ wp().critical ? '是' : '否' }}</dd>
                <dt>完成</dt><dd>{{ wp().percentComplete }}% · {{ statusLabel() }}</dd>
              </dl>
            }
            @case ('cost') {
              @if (cost(); as c) {
                <h4>预算（策划）</h4>
                <div class="tblwrap"><table>
                  <thead><tr><th>科目</th><th>说明</th><th class="num">金额（元）</th><th></th></tr></thead>
                  <tbody>
                    <tr><td>人工</td><td>
                      @if (manage()) {
                        <input class="sm" type="number" min="0" step="0.5" [value]="pd()" (change)="pd.set(+$any($event.target).value)" aria-label="人天" /> 人天 ×
                        <input class="sm" type="number" min="0" [value]="rate()" (change)="rate.set(+$any($event.target).value)" aria-label="费率" /> 元/人天
                        @if (rate() !== std()) { <span class="pill amber">手工</span>
                          <div><input class="sm" style="width: 100%; margin-top: 6px" [value]="reason()" (change)="reason.set($any($event.target).value)" placeholder="改费率的原因（必填）" aria-label="改费率原因" /></div>
                        } @else { <span class="muted" style="font-size: 12px">{{ c.role?.name ?? '' }}标准费率</span> }
                      } @else { {{ c.personDays }} 人天 × {{ c.rate }} 元/人天@if (c.rateReason) { （{{ c.rateReason }}）} }
                    </td><td class="num">{{ y(pd() * rate()) }}</td><td></td></tr>
                    @for (l of lines(); track $index; let i = $index) {
                      <tr>
                        <td>@if (manage()) { <select class="sm" [value]="l.accountId" (change)="setLine(i, 'accountId', $any($event.target).value)" aria-label="科目">@for (a of otherAccounts(); track a.id) { <option [value]="a.id" [selected]="a.id === l.accountId">{{ a.name }}</option> }</select> } @else { {{ accName(l.accountId) }} }</td>
                        <td>@if (manage()) { <input class="sm" style="width: 100%" [value]="l.description" (change)="setLine(i, 'description', $any($event.target).value)" aria-label="说明" /> } @else { {{ l.description }} }</td>
                        <td class="num">@if (manage()) { <input class="sm" type="number" min="0" [value]="l.amount" (change)="setLine(i, 'amount', +$any($event.target).value)" aria-label="金额" style="text-align: right; width: 120px" /> } @else { {{ y(l.amount) }} }</td>
                        <td>@if (manage()) { <button class="x" type="button" (click)="removeLine(i)" aria-label="删除此行">✕</button> }</td>
                      </tr>
                    }
                    <tr><td colspan="2"><b>工作包预算</b></td><td class="num"><b>{{ y(budget()) }}</b></td><td></td></tr>
                  </tbody>
                </table></div>
                @if (manage()) {
                  <div class="tools"><button mat-stroked-button type="button" (click)="addLine()">+ 材料 / 外协 / 其他费用</button><span class="sp"></span><button mat-flat-button type="button" (click)="saveCost()" [disabled]="busy()">保存预算</button></div>
                }
                <h4 style="margin-top: 18px">执行</h4>
                <dl class="kv">
                  <dt>实际发生</dt><dd>{{ y(c.actual) }} 元 <span class="muted" style="font-size: 12px">在「控制 → 成本」记录</span></dd>
                  <dt>承诺成本</dt><dd>{{ y(c.commitment) }} 元 <span class="muted" style="font-size: 12px">已下单未结算</span></dd>
                  <dt>还需多少</dt><dd>
                    @if (canEtc()) {
                      <input class="sm" type="number" min="0" [value]="c.etcManual ? c.etc : ''" [placeholder]="y(c.etc)" #etc aria-label="尚需成本" style="width: 130px" /> 元
                      <button mat-button type="button" (click)="saveEtc(etc.value)">保存</button>
                    } @else { {{ y(c.etc) }} 元 }
                    <div class="muted" style="font-size: 12px">负责人填写；不填按 预算 × 剩余比例 − 承诺 推算</div>
                  </dd>
                  <dt>预计完工</dt><dd><b>{{ y(c.eac) }}</b> 元
                    @if (c.state === 'RED') { <span class="pill red">超支 {{ over(c) }}%</span> } @else if (c.state === 'AMBER') { <span class="pill amber">超支 {{ over(c) }}%</span> } @else if (c.budget) { <span class="pill green">预算内</span> }
                  </dd>
                </dl>
                @if (c.state) { <div class="warn">预计超出工作包预算 {{ y(c.eac - c.budget) }} 元，已提醒项目经理和负责人。需要追加预算时走变更。</div> }
              } @else { <p class="muted">加载中…</p> }
            }
            @case ('talk') { <app-discussion [projectId]="project().id" entityType="WORK_PACKAGE" [entityId]="wp().id" [canPost]="project().status !== 'CLOSED'" /> }
            @case ('qual') {
              <p class="muted" style="font-size: 13px; margin: 0 0 10px">检验 / 验证项可以是产品、过程、文件、评审、试验或企业自定义的类别。全部有结果、没有不合格、关联的不符合项已关闭，工作包才能核验通过。</p>
              @for (q of items(); track q.id) {
                <div class="qi" [class.bad]="q.result === 'FAIL'" [attr.data-name]="q.name">
                  <div class="qh">
                    @if (canPlanQ()) {
                      <input class="sm name" [value]="q.name" (change)="patch(q, { name: $any($event.target).value })" aria-label="检验项名称" />
                      <select class="sm" (change)="patch(q, { category: $any($event.target).value })" aria-label="类别">@for (c of categories(); track c) { <option [selected]="c === q.category">{{ c }}</option> }</select>
                      <label style="font-size: 13px"><input type="checkbox" [checked]="q.isKey" (change)="patch(q, { isKey: $any($event.target).checked })" /> 关键</label>
                      @if (q.result === 'PENDING') { <button class="x" type="button" (click)="remove(q)" aria-label="删除检验项">✕</button> }
                    } @else { <b>{{ q.name }}</b> <span class="pill">{{ q.category }}</span>@if (q.isKey) { <span class="pill red">关键</span> } }
                  </div>
                  <div class="qg">
                    @for (f of fields; track f[0]) {
                      <label>{{ f[1] }}
                        @if (canPlanQ()) { <input class="sm" [value]="$any(q)[f[0]]" (change)="patchField(q, f[0], $any($event.target).value)" /> } @else { <span style="color: var(--pm-text)">{{ $any(q)[f[0]] || '—' }}</span> }
                      </label>
                    }
                    <label>验证人
                      @if (canPlanQ()) {
                        <select class="sm" (change)="patch(q, { verifierId: $any($event.target).value || null })"><option value="">未指定</option>@for (u of people(); track u.id) { <option [value]="u.id" [selected]="u.id === q.verifierId">{{ u.name }}</option> }</select>
                      } @else { <span style="color: var(--pm-text)">{{ person(q.verifierId) }}</span> }
                    </label>
                  </div>
                  <div class="qr">
                    <span class="muted">结果</span>
                    @if (canRecord(q)) {
                      <select class="sm" #r aria-label="结果">@for (k of results; track k) { <option [value]="k" [selected]="k === q.result">{{ resLabel(k) }}</option> }</select>
                      <input class="sm" #no [value]="q.recordNo" placeholder="记录编号 / 附件" aria-label="记录编号" style="width: 140px" />
                      <input class="sm" #nt [value]="q.resultNote" placeholder="说明（不适用须写理由）" aria-label="说明" style="flex: 1; min-width: 140px" />
                      <button mat-stroked-button type="button" (click)="record(q, r.value, no.value, nt.value)">记录</button>
                    } @else {
                      <span class="pill" [class.green]="q.result === 'PASS'" [class.red]="q.result === 'FAIL'" [class.amber]="q.result === 'PENDING'">{{ resLabel(q.result) }}</span>
                      @if (q.recordNo) { <span class="mono">{{ q.recordNo }}</span> }
                    }
                    @if (q.result === 'FAIL') {
                      @if (q.ncId) { <span class="pill red">已开不符合项</span> } @else if (canRecord(q)) { <button mat-button type="button" (click)="openNc(q)">开不符合项</button> }
                    }
                  </div>
                </div>
              } @empty { <p class="muted">还没有检验 / 验证项。</p> }
              @if (canPlanQ()) {
                <div class="tools">
                  <button mat-stroked-button type="button" (click)="add()">+ 添加检验项</button>
                  <select class="sm" (change)="fromTemplate($any($event.target))" aria-label="从检验项库添加"><option value="">从检验项库添加…</option>@for (t of templates(); track t.id) { <option [value]="t.id">{{ t.name }}（{{ t.category }}）</option> }</select>
                  <span class="sp"></span><span class="muted" style="font-size: 12.5px">{{ doneCount() }} / {{ items().length }} 已有结果</span>
                </div>
              }
            }
          }
        </div>
        <footer>{{ project().baselined ? '计划已批准：预算的修改会体现在下一版计划里；增加项目预算须走变更。' : '计划草稿：修改直接保存。' }}</footer>
      </div>
    </div>
  `,
})
export class WpDrawer {
  private readonly api = inject(Api);
  private readonly auth = inject(AuthService);
  private readonly brand = inject(Brand);
  readonly project = input.required<Project>();
  readonly wp = input.required<WorkPackage>();
  readonly ownerName = input('');
  readonly initialTab = input<DrawerTab>('time');
  readonly closed = output<void>();
  readonly changed = output<void>();
  constructor() { portalToBody(); }
  readonly tabs: [DrawerTab, string][] = [['time', '时间'], ['cost', '成本'], ['qual', '质量'], ['talk', '讨论']];
  readonly fields: [keyof InspectionItem, string][] = [['requirement', '要求 / 准则'], ['method', '方法'], ['record', '需要的记录']];
  readonly results: InspectionResult[] = ['PENDING', 'PASS', 'FAIL', 'NA'];
  readonly tab = signal<DrawerTab>('time');
  readonly plan = signal<CostPlan | null>(null);
  readonly items = signal<InspectionItem[]>([]);
  readonly people = signal<Person[]>([]);
  readonly templates = signal<InspectionTemplate[]>([]);
  readonly error = signal('');
  readonly busy = signal(false);
  readonly pd = signal(0);
  readonly rate = signal(0);
  readonly reason = signal('');
  readonly lines = signal<{ accountId: string; description: string; amount: number }[]>([]);

  readonly categories = this.brand.inspectionCategories;
  readonly manage = computed(() => !!this.project().permissions?.manage);
  readonly canPlanQ = computed(() => this.manage() || !!this.project().permissions?.quality);
  readonly cost = computed<WpCost | null>(() => this.plan()?.workPackages.find((w) => w.id === this.wp().id) ?? null);
  readonly std = computed(() => this.cost()?.role?.rate ?? 0);
  readonly otherAccounts = computed(() => (this.plan()?.accounts ?? []).filter((a) => !a.isLabor));
  readonly budget = computed(() => this.pd() * this.rate() + this.lines().reduce((n, l) => n + (+l.amount || 0), 0));
  readonly canEtc = computed(() => this.manage() || this.wp().ownerId === this.auth.user()?.id);
  readonly doneCount = computed(() => this.items().filter((i) => i.result !== 'PENDING').length);
  readonly statusLabel = computed(() => WP_STATUS_LABELS[this.wp().status]);

  ngOnInit() {
    this.tab.set(this.initialTab());
    void this.load();
  }

  async load() {
    try {
      const pid = this.project().id;
      const [plan, items, people] = await Promise.all([
        this.api.get<CostPlan>(`/projects/${pid}/cost-plan`),
        this.api.get<InspectionItem[]>(`/projects/${pid}/inspections`),
        this.api.get<Person[]>('/users/directory'),
      ]);
      this.plan.set(plan);
      this.items.set(items.filter((i) => i.workPackageId === this.wp().id));
      this.people.set(people);
      const c = this.cost();
      if (c) { this.pd.set(c.personDays); this.rate.set(c.rate); this.reason.set(c.rateReason ?? ''); this.lines.set(c.lines.map((l) => ({ ...l }))); }
      if (this.canPlanQ() && !this.templates().length) this.templates.set((await this.api.get<InspectionTemplate[]>('/inspection-templates')).filter((t) => t.active));
    } catch (e) { this.error.set(errorMessage(e, '加载失败')); }
  }

  y(n: number) { return yuan(n); }
  over(c: WpCost) { return Math.round((c.eac / Math.max(c.budget, 1) - 1) * 100); }
  accName(id: string) { return this.plan()?.accounts.find((a) => a.id === id)?.name ?? ''; }
  person(id: string | null) { return this.people().find((p) => p.id === id)?.name ?? '未指定'; }
  resLabel(r: InspectionResult) { return INSPECTION_RESULT_LABELS[r]; }
  canRecord(q: InspectionItem) { return this.canPlanQ() || q.verifierId === this.auth.user()?.id; }

  addLine() { const a = this.otherAccounts()[0]; if (a) this.lines.update((l) => [...l, { accountId: a.id, description: '', amount: 0 }]); }
  removeLine(i: number) { this.lines.update((l) => l.filter((_, j) => j !== i)); }
  setLine(i: number, k: 'accountId' | 'description' | 'amount', v: string | number) { this.lines.update((l) => l.map((x, j) => (j === i ? { ...x, [k]: v } : x))); }

  private async run(fn: () => Promise<unknown>, fallback: string) {
    this.error.set(''); this.busy.set(true);
    try { await fn(); await this.load(); this.changed.emit(); } catch (e) { this.error.set(errorMessage(e, fallback)); } finally { this.busy.set(false); }
  }
  saveCost() {
    const override = this.rate() !== this.std();
    return this.run(() => this.api.put(`/projects/${this.project().id}/wbs/${this.wp().id}/cost`, {
      personDays: this.pd(), laborRate: override ? this.rate() : null, laborRateReason: override ? this.reason() : undefined,
      lines: this.lines().filter((l) => l.amount > 0).map((l) => ({ accountId: l.accountId, description: l.description, amount: +l.amount })),
    }), '保存预算失败');
  }
  saveEtc(v: string) {
    return this.run(() => this.api.put(`/projects/${this.project().id}/wbs/${this.wp().id}/etc`, { etc: v === '' ? null : +v }), '保存失败');
  }
  patch(q: InspectionItem, body: Partial<InspectionItem>) {
    return this.run(() => this.api.patch(`/projects/${this.project().id}/inspections/${q.id}`, body), '保存检验项失败');
  }
  patchField(q: InspectionItem, k: keyof InspectionItem, v: string) { return this.patch(q, { [k]: v } as Partial<InspectionItem>); }
  remove(q: InspectionItem) {
    return this.run(() => this.api.delete(`/projects/${this.project().id}/inspections/${q.id}`), '删除失败');
  }
  add() {
    return this.run(() => this.api.post(`/projects/${this.project().id}/wbs/${this.wp().id}/inspections`, { name: '新检验项', category: this.categories()[0] }), '添加失败');
  }
  fromTemplate(sel: HTMLSelectElement) {
    const templateId = sel.value; sel.value = '';
    if (templateId) return this.run(() => this.api.post(`/projects/${this.project().id}/wbs/${this.wp().id}/inspections/from-template`, { templateId }), '添加失败');
    return undefined;
  }
  record(q: InspectionItem, result: string, recordNo: string, note: string) {
    return this.run(() => this.api.post(`/projects/${this.project().id}/inspections/${q.id}/result`, { result, recordNo, note }), '记录结果失败');
  }
  openNc(q: InspectionItem) {
    return this.run(() => this.api.post(`/projects/${this.project().id}/inspections/${q.id}/nonconformity`), '开不符合项失败');
  }
}
