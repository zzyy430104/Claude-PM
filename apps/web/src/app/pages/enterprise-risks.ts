import { Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { Api, errorMessage } from '../core/api';
import { AuthService } from '../core/auth.service';
import { IMPORTANCE_LABELS, Importance, Project, RISK_STATUS_LABELS, RiskRow, RiskSettings, RiskWarning } from '../core/models';
import { RiskDrawer, RiskPerson, RiskStep } from '../components/risk-drawer';

/** 企业风险：企业级风险与机会，所有人可见；管理层登记、审批和关闭 */
@Component({
  selector: 'app-enterprise-risks',
  imports: [MatButtonModule, RiskDrawer],
  styles: `
    a.lk { color: var(--pm-primary); text-decoration: underline; cursor: pointer; }
    td small { display: block; color: var(--pm-muted); font-size: 12px; }
    .warns { display: flex; flex-direction: column; gap: 8px; }
    .w { display: flex; gap: 12px; align-items: center; border-radius: 10px; padding: 9px 12px; font-size: 14px; }
    .w.red { background: var(--pm-red-bg); } .w.amber { background: var(--pm-amber-bg); }
    .w .m { flex: 1; } .w .o { color: var(--pm-muted); font-size: 13px; }
    .seg { display: inline-flex; border: 1px solid var(--pm-line); border-radius: 10px; overflow: hidden; }
    .seg button { border: 0; background: #fff; padding: 6px 12px; font: inherit; font-size: 13.5px; cursor: pointer; color: var(--pm-muted); }
    .seg button.on { background: var(--pm-primary); color: #fff; }
    tr.closed td { color: var(--pm-muted); }
  `,
  template: `
    <div class="page">
      <h1>企业风险</h1>
      <p class="muted">跨项目、影响整个企业的风险与机会，所有人可见。由管理层登记和关闭；项目里的风险可以升级到这里，受影响的项目会看到它。</p>
      @if (error()) { <div class="error" role="alert">{{ error() }}</div> }
      @if (warnings().length) {
        <section class="pcard">
          <header><h3>预警</h3></header>
          <div class="body"><div class="warns">
            @for (w of warnings(); track $index) {
              <div [class]="'w ' + w.severity"><a class="lk" (click)="open(w.riskId, w.kind === 'AWAITING_REVIEW' ? 'close' : w.kind === 'REVIEW_DUE' || w.kind === 'TRIGGERED' ? 'warn' : 'plan')">{{ w.title }}</a>
                <span [class]="'pill ' + impColor(w.importance)">{{ impLabel(w.importance) }}</span><span class="m">{{ w.message }}</span><span class="o">{{ name(w.ownerId) }}</span></div>
            }
          </div></div>
        </section>
      }
      <section class="pcard">
        <header>
          <h3>企业级风险与机会</h3><span class="sub grow">{{ shown().length }} 项</span>
          <div class="seg" role="group" aria-label="筛选">
            <button type="button" [class.on]="filter() === 'open'" (click)="filter.set('open')">未关闭</button>
            <button type="button" [class.on]="filter() === 'all'" (click)="filter.set('all')">全部</button>
          </div>
          @if (isMgmt()) { <button mat-flat-button type="button" (click)="open(null)">+ 新增</button> }
        </header>
        <div class="tblwrap"><table>
          <thead><tr><th>类型</th><th>描述</th><th>受影响的项目</th><th>重要度</th><th>策略</th><th>措施</th><th>责任人</th><th>下次复查</th><th>状态</th></tr></thead>
          <tbody>
            @for (r of shown(); track r.id) {
              <tr [class.closed]="r.status === 'CLOSED'" [attr.data-risk]="r.title">
                <td><span [class]="'pill ' + (r.kind === 'RISK' ? 'red' : 'green')">{{ r.kind === 'RISK' ? '风险' : '机会' }}</span></td>
                <td><a class="lk" (click)="open(r.id)">{{ r.title }}</a>@if (r.cause) { <small>原因：{{ r.cause }}</small> }</td>
                <td>@for (p of r.projects; track p.id) { <div>{{ p.code }} {{ p.name }}</div> } @empty { — }</td>
                <td><span [class]="'pill ' + impColor(r.importance)">{{ impLabel(r.importance) }}</span></td>
                <td>{{ r.strategy || '未策划' }}</td>
                <td>{{ r.measures.length ? r.closedActions + ' / ' + r.measures.length : '—' }}@if (r.overdueMeasures) { <span class="pill red">逾期</span> }</td>
                <td>{{ name(r.ownerId) }}</td>
                <td>@if (r.status !== 'CLOSED' && r.nextReviewAt) { <span [class.pill]="r.reviewDue" [class.amber]="r.reviewDue">{{ r.nextReviewAt.slice(0, 10) }}</span> } @else { — }</td>
                <td>{{ statusLabel(r) }}</td>
              </tr>
            } @empty { <tr><td colspan="9" class="muted">没有企业级风险</td></tr> }
          </tbody>
        </table></div>
      </section>
      @if (settings() && drawer()) {
        <app-risk-drawer [risk]="current()" [settings]="settings()!" [people]="people()" [projects]="projects()" [startStep]="step()"
          (closed)="drawer.set(false)" (changed)="onChanged($event)" />
      }
    </div>
  `,
})
export class EnterpriseRisksPage {
  private readonly api = inject(Api);
  private readonly auth = inject(AuthService);
  readonly rows = signal<RiskRow[]>([]);
  readonly warnings = signal<RiskWarning[]>([]);
  readonly settings = signal<RiskSettings | null>(null);
  readonly people = signal<RiskPerson[]>([]);
  readonly projects = signal<{ id: string; code: string; name: string }[]>([]);
  readonly error = signal('');
  readonly filter = signal<'open' | 'all'>('open');
  readonly drawer = signal(false);
  readonly currentId = signal<string | null>(null);
  readonly step = signal<RiskStep>('id');
  readonly isMgmt = computed(() => this.auth.hasRole('TOP_MANAGEMENT', 'TENANT_ADMIN'));
  readonly current = computed(() => this.rows().find((r) => r.id === this.currentId()) ?? null);
  readonly shown = computed(() => this.rows().filter((r) => this.filter() === 'all' || (r.status !== 'CLOSED' && r.status !== 'OCCURRED')));

  async ngOnInit() {
    try {
      const [s, people, projects] = await Promise.all([
        this.api.get<RiskSettings>('/risk-settings'),
        this.api.get<RiskPerson[]>('/users/directory'),
        this.api.get<Project[]>('/projects').catch(() => [] as Project[]),
      ]);
      this.settings.set(s); this.people.set(people);
      this.projects.set(projects.filter((p) => p.status !== 'CLOSED').map((p) => ({ id: p.id, code: p.code, name: p.name })));
    } catch (e) { this.error.set(errorMessage(e, '加载失败')); }
    await this.load();
  }
  async load() {
    try {
      const x = await this.api.get<{ risks: RiskRow[]; warnings: RiskWarning[] }>('/enterprise-risks');
      this.rows.set(x.risks); this.warnings.set(x.warnings);
    } catch (e) { this.error.set(errorMessage(e, '加载失败')); }
  }
  open(id: string | null, step: RiskStep = 'id') { this.step.set(step); this.currentId.set(id); this.drawer.set(true); }
  async onChanged(id: string) { this.currentId.set(id); await this.load(); }
  impLabel(i: Importance) { return IMPORTANCE_LABELS[i]; }
  impColor(i: Importance) { return i === 'HIGH' ? 'red' : i === 'MEDIUM' ? 'amber' : 'green'; }
  statusLabel(r: RiskRow) { return RISK_STATUS_LABELS[r.status]; }
  name(id: string | null) { return id ? this.people().find((p) => p.id === id)?.name ?? '—' : '—'; }
}
