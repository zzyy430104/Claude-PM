import { Component, computed, inject, input, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { Api, errorMessage } from '../core/api';
import { askText } from '../core/i18n';
import {
  IMPORTANCE_LABELS, Importance, Member, Objective, Project, RISK_LEVEL_LABELS, RISK_STATUS_LABELS, RiskLevelKey, RiskRow, RiskSettings, RiskWarning, WbsResponse,
} from '../core/models';
import { RiskDrawer, RiskPerson, RiskStep } from './risk-drawer';
import { askConfirm } from '../core/dialog';

type LevelFilter = 'ALL' | RiskLevelKey;
const STATE_LABEL = { GREEN: '正常', AMBER: '关注', RED: '偏离', GREY: '未开始' } as const;
const STATE_COLOR = { GREEN: 'green', AMBER: 'amber', RED: 'red', GREY: '' } as const;

/**
 * 项目的目标与风险（第 5B 章）。
 * plan：项目目标 + 风险与机会登记（识别 → 评价 → 应对策划）；ctrl：预警 + 跟踪（复查、复评、关闭）。
 */
@Component({
  selector: 'app-project-risks',
  imports: [MatButtonModule, RiskDrawer],
  styles: `
    .objs { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 12px; }
    .obj { border: 1px solid var(--pm-line); border-radius: 12px; padding: 12px 14px; display: flex; flex-direction: column; gap: 6px; font-size: 14px; }
    .obj header { display: flex; justify-content: space-between; align-items: center; gap: 8px; font-weight: 700; }
    .obj .cur, .obj .rel { font-size: 13px; color: var(--pm-muted); }
    .obj input, .obj select { font: inherit; font-size: 13px; border: 1px solid var(--pm-line); border-radius: 6px; padding: 3px 6px; }
    .seg { display: inline-flex; border: 1px solid var(--pm-line); border-radius: 10px; overflow: hidden; }
    .seg button { border: 0; background: #fff; padding: 6px 12px; font: inherit; font-size: 13.5px; cursor: pointer; color: var(--pm-muted); }
    .seg button.on { background: var(--pm-primary); color: #fff; }
    a.lk { color: var(--pm-primary); text-decoration: underline; cursor: pointer; }
    td small { display: block; color: var(--pm-muted); font-size: 12px; }
    .kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 12px; margin: 0 0 16px; }
    .kpi { background: var(--pm-card); border: 1px solid var(--pm-line); border-radius: var(--pm-radius); padding: 14px 18px; }
    .kpi .l { color: var(--pm-muted); font-size: 13px; } .kpi .v { font-size: 28px; font-weight: 800; margin: 4px 0; } .kpi .v.red { color: var(--pm-red); } .kpi .s { color: var(--pm-muted); font-size: 12.5px; }
    .warns { display: flex; flex-direction: column; gap: 8px; }
    .w { display: flex; gap: 12px; align-items: center; border-radius: 10px; padding: 9px 12px; font-size: 14px; }
    .w.red { background: var(--pm-red-bg); } .w.amber { background: var(--pm-amber-bg); }
    .w .m { flex: 1; } .w .o { color: var(--pm-muted); font-size: 13px; }
    tr.closed td { color: var(--pm-muted); }
  `,
  template: `
    @if (error()) { <div class="error" role="alert">{{ error() }}</div> }
    @if (mode() === 'plan') {
      <section class="pcard">
        <header><h3>项目目标</h3><span class="sub grow">由项目要求生成交期、成本、质量目标，可补充自定义目标</span><button mat-stroked-button type="button" (click)="addObjective()">+ 自定义目标</button></header>
        <div class="body">
          <div class="objs">
            @for (o of objectives(); track o.id) {
              <div class="obj" [attr.data-name]="o.name">
                <header><span>{{ o.dimension }}</span><span [class]="'pill ' + stateColor(o.state)">{{ stateLabel(o.state) }}</span></header>
                <div>{{ o.name }}：{{ o.target }}@if (!o.auto) { （自定义）}</div>
                <div class="cur">当前：{{ o.currentText || '暂无数据' }}</div>
                @if (!o.auto) {
                  <div class="cur">
                    <input [value]="o.current ?? ''" placeholder="当前情况" (change)="patchObjective(o, { current: $any($event.target).value })" aria-label="目标当前情况" />
                    <select (change)="patchObjective(o, { manualState: $any($event.target).value || null })" aria-label="目标状态">
                      <option value="" [selected]="!o.manualState">未开始</option><option value="GREEN" [selected]="o.manualState === 'GREEN'">正常</option>
                      <option value="AMBER" [selected]="o.manualState === 'AMBER'">关注</option><option value="RED" [selected]="o.manualState === 'RED'">偏离</option>
                    </select>
                    <button mat-button type="button" (click)="removeObjective(o)">删除</button>
                  </div>
                }
                <div class="rel">@if (o.risks.length) { 相关：@for (r of o.risks; track r.id) { <a class="lk" (click)="openId(r.id)">{{ r.title }}</a> <span [class]="'pill ' + impColor(r.importance)">{{ impLabel(r.importance) }}</span>　} } @else { 还没有识别风险 }</div>
              </div>
            } @empty { <p class="muted">还没有项目目标。项目有交期、预算或项目要求后会自动生成交期、成本、质量目标。</p> }
          </div>
        </div>
      </section>
    } @else {
      <div class="kpis">
        <div class="kpi"><div class="l">打开的风险</div><div class="v">{{ kpi().risks }}</div><div class="s">高 {{ kpi().high }}</div></div>
        <div class="kpi"><div class="l">机会</div><div class="v">{{ kpi().opps }}</div><div class="s">未关闭</div></div>
        <div class="kpi"><div class="l">预警</div><div class="v" [class.red]="warnings().length > 0">{{ warnings().length }}</div><div class="s">已通知责任人和项目经理</div></div>
        <div class="kpi"><div class="l">措施</div><div class="v">{{ kpi().done }} / {{ kpi().measures }}</div><div class="s">已完成 / 全部，在「问题与行动」跟踪</div></div>
      </div>
      <section class="pcard">
        <header><h3>预警</h3><span class="sub">高风险的预警同时通知管理层（按企业设置）</span></header>
        <div class="body">
          <div class="warns">
            @for (w of warnings(); track $index) {
              <div [class]="'w ' + w.severity"><a class="lk" (click)="openId(w.riskId, stepFor(w.kind))">{{ w.title }}</a>
                <span [class]="'pill ' + impColor(w.importance)">{{ impLabel(w.importance) }}</span><span class="m">{{ w.message }}</span><span class="o">{{ name(w.ownerId) }}</span></div>
            } @empty { <p class="muted" style="margin: 0">没有预警。</p> }
          </div>
        </div>
      </section>
    }

    <section class="pcard">
      <header>
        <h3>{{ mode() === 'plan' ? '风险与机会登记' : '风险与机会' }}</h3>
        <span class="sub grow">{{ mode() === 'plan' ? '识别 → 评价 → 应对策划' : '点描述查看应对、复评和关闭' }}</span>
        <div class="seg" role="group" aria-label="层级">
          @for (f of filters; track f[0]) { <button type="button" [class.on]="level() === f[0]" (click)="level.set(f[0])">{{ f[1] }}</button> }
        </div>
        <label style="font-size: 13px"><input type="checkbox" [checked]="showClosed()" (change)="showClosed.set($any($event.target).checked)" /> 显示已关闭</label>
        <button mat-flat-button type="button" (click)="newRisk()">+ 新增</button>
      </header>
      <div class="tblwrap"><table>
        <thead><tr><th>类型</th><th>层级</th><th>描述</th><th>影响目标</th><th>重要度</th><th>策略</th><th>措施</th><th>责任人</th><th>下次复查</th><th>状态</th></tr></thead>
        <tbody>
          @for (r of shown(); track r.id) {
            <tr [class.closed]="r.status === 'CLOSED'" [attr.data-risk]="r.title">
              <td><span [class]="'pill ' + (r.kind === 'RISK' ? 'red' : 'green')">{{ r.kind === 'RISK' ? '风险' : '机会' }}</span></td>
              <td><span [class]="'pill ' + (r.level === 'ENTERPRISE' ? 'blue' : '')">{{ levelLabel(r.level) }}</span></td>
              <td><a class="lk" (click)="openId(r.id)">{{ r.title }}</a>@if (wpName(r.workPackageId); as w) { <small>工作包 {{ w }}</small> }</td>
              <td>{{ objName(r.objectiveId) }}</td>
              <td><span [class]="'pill ' + impColor(r.importance)">{{ impLabel(r.importance) }}</span></td>
              <td>{{ r.strategy || '未策划' }}</td>
              <td>{{ r.measures.length ? r.closedActions + ' / ' + r.measures.length : '—' }}@if (r.overdueMeasures) { <span class="pill red">逾期 {{ r.overdueMeasures }}</span> }</td>
              <td>{{ name(r.ownerId) }}</td>
              <td>@if (r.status !== 'CLOSED' && r.status !== 'OCCURRED' && r.nextReviewAt) { <span [class.pill]="r.reviewDue" [class.amber]="r.reviewDue">{{ r.nextReviewAt.slice(5, 10) }}</span> } @else { — }</td>
              <td><span [class]="'pill ' + statusColor(r)">{{ statusLabel(r) }}</span></td>
            </tr>
          } @empty { <tr><td colspan="10" class="muted">还没有登记风险与机会</td></tr> }
        </tbody>
      </table></div>
    </section>

    @if (settings() && drawer()) {
      <app-risk-drawer [projectId]="project().id" [risk]="current()" [settings]="settings()!" [people]="people()" [objectives]="objectives()" [wps]="wps()"
        [startStep]="startStep()" (closed)="drawer.set(false)" (changed)="onChanged($event)" />
    }
  `,
})
export class ProjectRisks {
  private readonly api = inject(Api);
  readonly project = input.required<Project>();
  readonly mode = input<'plan' | 'ctrl'>('ctrl');
  readonly rows = signal<RiskRow[]>([]);
  readonly warnings = signal<RiskWarning[]>([]);
  readonly objectives = signal<Objective[]>([]);
  readonly settings = signal<RiskSettings | null>(null);
  readonly people = signal<RiskPerson[]>([]);
  readonly wps = signal<{ id: string; code: string; name: string }[]>([]);
  readonly error = signal('');
  readonly level = signal<LevelFilter>('ALL');
  readonly showClosed = signal(false);
  readonly drawer = signal(false);
  readonly currentId = signal<string | null>(null);
  readonly startStep = signal<RiskStep>('id');
  readonly filters: [LevelFilter, string][] = [['ALL', '全部'], ['ENTERPRISE', '企业级'], ['PROJECT', '项目级'], ['WORK_PACKAGE', '工作包级']];

  readonly current = computed(() => this.rows().find((r) => r.id === this.currentId()) ?? null);
  readonly shown = computed(() => this.rows().filter((r) => (this.level() === 'ALL' || r.level === this.level()) && (this.showClosed() || r.status !== 'CLOSED')));
  readonly kpi = computed(() => {
    const open = this.rows().filter((r) => r.status !== 'CLOSED' && r.status !== 'OCCURRED');
    const ms = open.flatMap((r) => r.measures);
    return {
      risks: open.filter((r) => r.kind === 'RISK').length, high: open.filter((r) => r.kind === 'RISK' && r.importance === 'HIGH').length,
      opps: open.filter((r) => r.kind === 'OPPORTUNITY').length, measures: ms.length, done: ms.filter((m) => m.done).length,
    };
  });

  async ngOnInit() {
    const id = this.project().id;
    try {
      const [s, members, wbs] = await Promise.all([
        this.api.get<RiskSettings>('/risk-settings'),
        this.api.get<Member[]>(`/projects/${id}/members`),
        this.api.get<WbsResponse>(`/projects/${id}/wbs`),
      ]);
      this.settings.set(s);
      const seen = new Set<string>();
      this.people.set(members.filter((m) => !seen.has(m.userId) && !!seen.add(m.userId)).map((m) => ({ id: m.userId, name: m.user?.name ?? '' })));
      this.wps.set(wbs.items.filter((w) => w.isLeaf).map((w) => ({ id: w.id, code: w.code, name: w.name })));
    } catch (e) { this.error.set(errorMessage(e, '加载失败')); }
    await this.load();
  }
  async load() {
    const id = this.project().id;
    try {
      const [rows, warnings, objectives] = await Promise.all([
        this.api.get<RiskRow[]>(`/projects/${id}/risks`),
        this.api.get<RiskWarning[]>(`/projects/${id}/risk-warnings`),
        this.api.get<Objective[]>(`/projects/${id}/objectives`),
      ]);
      this.rows.set(rows); this.warnings.set(warnings); this.objectives.set(objectives);
    } catch (e) { this.error.set(errorMessage(e, '加载失败')); }
  }

  stepFor(kind: string): RiskStep { return kind === 'AWAITING_REVIEW' ? 'close' : kind === 'REVIEW_DUE' || kind === 'TRIGGERED' ? 'warn' : 'plan'; }
  openId(id: string, step: RiskStep = 'id') { this.startStep.set(step); this.currentId.set(id); this.drawer.set(true); }
  newRisk() { this.startStep.set('id'); this.currentId.set(null); this.drawer.set(true); }
  async onChanged(id: string) { this.currentId.set(id); await this.load(); }

  impLabel(i: Importance) { return IMPORTANCE_LABELS[i]; }
  impColor(i: Importance) { return i === 'HIGH' ? 'red' : i === 'MEDIUM' ? 'amber' : 'green'; }
  levelLabel(l: RiskLevelKey) { return RISK_LEVEL_LABELS[l]; }
  statusLabel(r: RiskRow) { return RISK_STATUS_LABELS[r.status]; }
  statusColor(r: RiskRow) { return r.status === 'OPEN' || r.status === 'REVIEW' ? 'amber' : r.status === 'MITIGATING' ? 'blue' : r.status === 'OCCURRED' ? 'red' : ''; }
  stateLabel(s: Objective['state']) { return STATE_LABEL[s]; }
  stateColor(s: Objective['state']) { return STATE_COLOR[s]; }
  name(id: string | null) { return id ? this.people().find((p) => p.id === id)?.name ?? '—' : '—'; }
  wpName(id: string | null) { const w = id ? this.wps().find((x) => x.id === id) : null; return w ? `${w.code} ${w.name}` : ''; }
  objName(id: string | null) { return id ? this.objectives().find((o) => o.id === id)?.dimension ?? '—' : '—'; }

  private async run(fn: () => Promise<unknown>, fallback: string) {
    this.error.set('');
    try { await fn(); } catch (e) { this.error.set(errorMessage(e, fallback)); }
    await this.load();
  }
  async addObjective() {
    const dimension = await askText('目标维度（如 客户、质量、交期）');
    if (!dimension?.trim()) return;
    const name = await askText('目标名称（如 客户满意度）');
    if (!name?.trim()) return;
    const target = await askText('目标值（如 ≥ 90 分）');
    if (!target?.trim()) return;
    return this.run(() => this.api.post(`/projects/${this.project().id}/objectives`, { dimension: dimension.trim(), name: name.trim(), target: target.trim() }), '添加失败');
  }
  patchObjective(o: Objective, patch: Partial<Pick<Objective, 'current' | 'manualState'>>) {
    return this.run(() => this.api.patch(`/projects/${this.project().id}/objectives/${o.id}`, patch), '保存失败');
  }
  async removeObjective(o: Objective) {
    if (!await askConfirm(`删除目标“${o.name}”？`)) return;
    return this.run(() => this.api.delete(`/projects/${this.project().id}/objectives/${o.id}`), '删除失败');
  }
}
