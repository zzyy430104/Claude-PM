import { Component, computed, inject, input, signal } from '@angular/core';
import { Api, errorMessage } from '../core/api';
import {
  INSPECTION_RESULT_LABELS, InspectionItem, InspectionResult, InspectionStats, Project, RequirementVersion, WbsResponse, WorkPackage,
} from '../core/models';
import { ProjectQuality } from './project-quality';
import { WpDrawer } from './wp-drawer';

interface Person { id: string; name: string }

/**
 * 质量策划（mode = plan）：质量目标与标准、质量计划（QA / QC 活动）、工作包上的检验 / 验证项；
 * 检验记录（mode = records）：逐项结果、一次合格率、不合格。
 */
@Component({
  selector: 'app-project-quality-plan',
  imports: [ProjectQuality, WpDrawer],
  styles: `
    .stats { grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); }
    .link { border: 0; background: none; padding: 0; font: inherit; color: var(--pm-primary); cursor: pointer; text-align: left; text-decoration: underline; }
    td.wpc { min-width: 170px; }
    tr.miss td { background: var(--pm-amber-bg); }
    dl.kv { display: grid; grid-template-columns: 90px 1fr; gap: 6px 12px; margin: 0; font-size: 14px; } dl.kv dt { color: var(--pm-muted); } dl.kv dd { margin: 0; }
    .seg { display: inline-flex; border: 1px solid var(--pm-line); border-radius: 10px; background: #fff; padding: 2px; margin: 0 0 12px; }
    .seg button { border: 0; background: none; font: inherit; font-size: 13px; padding: 4px 12px; border-radius: 8px; cursor: pointer; color: var(--pm-muted); }
    .seg button[aria-pressed=true] { background: var(--pm-primary); color: #fff; }
  `,
  template: `
    @if (error()) { <div class="error" role="alert">{{ error() }}</div> }
    @if (stats(); as s) {
      <div class="stats">
        <div class="stat"><b>{{ s.total }}</b><span>检验 / 验证项 · {{ s.workPackages }} 个工作包</span></div>
        @if (mode() === 'plan') {
          <div class="stat" [class.red]="s.keyWithoutVerifier > 0"><b>{{ s.key }}</b><span>关键项{{ s.keyWithoutVerifier ? ' · ' + s.keyWithoutVerifier + ' 个没有验证人' : '' }}</span></div>
          <div class="stat" [class.red]="s.missing.length > 0"><b>{{ s.missing.length }}</b><span>有交付物但缺检验项的工作包</span></div>
        } @else {
          <div class="stat"><b>{{ s.done }}</b><span>已有结果 · 待检 {{ s.pending }}</span></div>
          <div class="stat"><b>{{ s.firstPassYield === null ? '—' : s.firstPassYield + '%' }}</b><span>一次合格率</span></div>
          <div class="stat" [class.red]="s.failed > 0"><b>{{ s.failed }}</b><span>不合格</span></div>
        }
      </div>
    }

    @if (mode() === 'plan') {
      @if (req(); as r) {
        <section class="pcard">
          <header><h2>质量目标与标准</h2><span class="sub">来自项目要求 v{{ r.version }}</span></header>
          <div class="body"><dl class="kv">
            <dt>适用标准</dt><dd>{{ r.data.quality.standards.join('、') || '—' }}</dd>
            <dt>验收方式</dt><dd>{{ r.data.quality.acceptance || '—' }}</dd>
            <dt>FAI</dt><dd>{{ r.data.quality.fai ? '需要' + (r.data.quality.customerWitness ? '，客户见证' : '') : '不做（' + r.data.quality.faiReason + '）' }}</dd>
            @if (r.data.quality.special) { <dt>特殊要求</dt><dd>{{ r.data.quality.special }}</dd> }
          </dl></div>
        </section>
      }
      <app-project-quality [project]="project()" part="plan" />
    } @else {
      <div class="seg" role="group" aria-label="筛选">
        @for (f of filters; track f[0]) { <button type="button" [attr.aria-pressed]="filter() === f[0]" (click)="filter.set(f[0])">{{ f[1] }}</button> }
      </div>
    }

    <section class="pcard">
      <header><h2>{{ mode() === 'plan' ? '工作包上的检验 / 验证项' : '检验记录' }}</h2><span class="sub">点工作包编辑{{ mode() === 'plan' ? '；类别在“企业设置”里可以增减' : '或记录结果' }}</span></header>
      <div class="tblwrap"><table>
        <thead><tr><th>工作包</th><th>检验 / 验证项</th><th>类别</th><th>要求 / 准则</th>@if (mode() === 'records') { <th>结果</th><th>记录</th> }<th>验证人</th></tr></thead>
        <tbody>
          @for (it of shown(); track it.id) {
            <tr>
              <td class="wpc"><button type="button" class="link" (click)="open(it.workPackageId)">{{ it.workPackage?.code }} {{ it.workPackage?.name }}</button></td>
              <td>{{ it.name }}@if (it.isKey) { <span class="pill red">关键</span> }</td>
              <td><span class="pill">{{ it.category }}</span></td>
              <td style="font-size: 13px">{{ it.requirement }}</td>
              @if (mode() === 'records') {
                <td><span class="pill" [class.green]="it.result === 'PASS'" [class.red]="it.result === 'FAIL'" [class.amber]="it.result === 'PENDING'">{{ label(it.result) }}</span>@if (it.firstResult === 'FAIL' && it.result === 'PASS') { <span class="muted" style="font-size: 12px"> 复检</span> }</td>
                <td class="mono">{{ it.recordNo || '—' }}</td>
              }
              <td>{{ person(it.verifierId) }}</td>
            </tr>
          }
          @if (mode() === 'plan') {
            @for (m of stats()?.missing ?? []; track m.id) {
              <tr class="miss"><td class="wpc"><button type="button" class="link" (click)="open(m.id)">{{ m.code }} {{ m.name }}</button></td><td colspan="4">有交付物但还没有检验 / 验证项</td></tr>
            }
          }
          @if (!shown().length && !(stats()?.missing?.length)) { <tr><td colspan="7" class="muted">没有记录</td></tr> }
        </tbody>
      </table></div>
    </section>
    @if (drawerWp(); as w) { <app-wp-drawer [project]="project()" [wp]="w" initialTab="qual" (closed)="drawerWp.set(null)" (changed)="load()" /> }
  `,
})
export class ProjectQualityPlan {
  private readonly api = inject(Api);
  readonly project = input.required<Project>();
  readonly mode = input<'plan' | 'records'>('plan');
  readonly filters: [string, string][] = [['all', '全部'], ['PENDING', '待检'], ['PASS', '合格'], ['FAIL', '不合格']];
  readonly filter = signal('all');
  readonly items = signal<InspectionItem[]>([]);
  readonly stats = signal<InspectionStats | null>(null);
  readonly req = signal<RequirementVersion | null>(null);
  readonly wbs = signal<WorkPackage[]>([]);
  readonly people = signal<Person[]>([]);
  readonly drawerWp = signal<WorkPackage | null>(null);
  readonly error = signal('');
  readonly shown = computed(() => this.items().filter((i) => this.filter() === 'all' || i.result === this.filter()));

  ngOnInit() { void this.load(); }
  async load() {
    try {
      const id = this.project().id;
      const [items, stats, wbs, people] = await Promise.all([
        this.api.get<InspectionItem[]>(`/projects/${id}/inspections`),
        this.api.get<InspectionStats>(`/projects/${id}/inspections/stats`),
        this.api.get<WbsResponse>(`/projects/${id}/wbs`),
        this.api.get<Person[]>('/users/directory'),
      ]);
      this.items.set(items); this.stats.set(stats); this.wbs.set(wbs.items); this.people.set(people);
      if (this.mode() === 'plan' && this.project().requirementVersion) {
        const v = await this.api.get<RequirementVersion[]>(`/projects/${id}/requirement-versions`);
        this.req.set(v.find((x) => x.version === this.project().requirementVersion) ?? v[0] ?? null);
      }
    } catch (e) { this.error.set(errorMessage(e, '加载失败')); }
  }
  label(r: InspectionResult) { return INSPECTION_RESULT_LABELS[r]; }
  person(id: string | null) { return id ? this.people().find((p) => p.id === id)?.name ?? '—' : '未指定'; }
  open(id: string) { const w = this.wbs().find((x) => x.id === id); if (w) this.drawerWp.set(w); }
}
