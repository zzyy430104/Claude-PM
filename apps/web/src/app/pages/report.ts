import { Component, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { Api } from '../core/api';
import { CHANGE_STATUS_LABELS, ChangeStatus, DIMENSION_LABELS, Dimension, Health } from '../core/models';
import { I18n } from '../core/i18n';

interface Report {
  project: { code: string; name: string };
  period: { from: string; to: string };
  performance: {
    triangle: { quality: Dimension; schedule: Dimension; cost: Dimension };
    evm: { spi: number | null; cpi: number | null; eac: number | null; budget: number | null; ac: number };
    schedule: { projectedEnd: string; customerDate: string | null; slipDays: number };
  };
  completed: { code: string; name: string; status: string }[];
  upcoming: { code: string; name: string; start: string }[];
  issuesNew: { kind: string; title: string; dueDate: string | null }[];
  issuesClosed: { kind: string; title: string }[];
  openIssues: number;
  changes: { code: string; title: string; status: ChangeStatus }[];
  topRisks: { kind: string; title: string; score: number }[];
  deviations: { dimension: 'QUALITY' | 'SCHEDULE' | 'COST'; audience: string; impact: string; countermeasures: string; noticeDate: string }[];
}

const HL: Record<Health, string> = { RED: '告警', AMBER: '关注', GREEN: '正常' };

/** 项目周报：可直接打印或另存为 PDF */
@Component({
  selector: 'app-report',
  imports: [RouterLink, MatButtonModule],
  styles: `
    .sheet { background: #fff; border: 1px solid var(--pm-line); border-radius: var(--pm-radius); padding: 28px 36px; max-width: 900px; }
    .head { display: flex; justify-content: space-between; align-items: baseline; border-bottom: 2px solid var(--pm-primary); padding-bottom: 8px; margin-bottom: 16px; }
    .head h1 { margin: 0 !important; }
    .tri { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
    .tri > div { border: 1px solid var(--pm-line); border-radius: 8px; padding: 10px 12px; }
    .tri .muted { margin-top: 6px; }
    ul { margin: 4px 0 0; padding-left: 20px; } li { margin: 2px 0; }
    .no-print { margin: 0 0 12px; display: flex; gap: 8px; }
    h2 { margin-top: 22px !important; }
    @media print {
      :host ::ng-deep { }
      .no-print { display: none; }
      .sheet { border: 0; padding: 0; }
    }
  `,
  template: `
    <div class="page">
      <div class="no-print">
        <a mat-button [routerLink]="['/projects', id()]">← 返回项目</a>
        <button mat-flat-button (click)="print()">打印 / 另存为 PDF</button>
      </div>
      @if (r(); as r) {
        <div class="sheet">
          <div class="head"><h1>项目周报：{{ r.project.code }} {{ r.project.name }}</h1><span class="muted">{{ r.period.from }} 至 {{ r.period.to }}</span></div>
          <h2>总体状态</h2>
          <div class="tri">
            <div><span [class]="'badge ' + r.performance.triangle.quality.health">质量 {{ hl(r.performance.triangle.quality.health) }}</span><ul>@for (x of r.performance.triangle.quality.reasons; track x) { <li>{{ x }}</li> }</ul></div>
            <div><span [class]="'badge ' + r.performance.triangle.schedule.health">进度 {{ hl(r.performance.triangle.schedule.health) }}</span>
              <div class="muted">SPI {{ num(r.performance.evm.spi) }} · 预计完工 {{ r.performance.schedule.projectedEnd }} · 客户交期 {{ r.performance.schedule.customerDate ?? '—' }}</div>
              <ul>@for (x of r.performance.triangle.schedule.reasons; track x) { <li>{{ x }}</li> }</ul></div>
            <div><span [class]="'badge ' + r.performance.triangle.cost.health">成本 {{ hl(r.performance.triangle.cost.health) }}</span>
              <div class="muted">CPI {{ num(r.performance.evm.cpi) }} · 实际 {{ money(r.performance.evm.ac) }} · 完工估算 {{ money(r.performance.evm.eac) }}</div>
              <ul>@for (x of r.performance.triangle.cost.reasons; track x) { <li>{{ x }}</li> }</ul></div>
          </div>
          <h2>本周完成</h2>
          @if (r.completed.length) { <ul>@for (w of r.completed; track w.code) { <li>{{ w.code }} {{ w.name }}</li> }</ul> } @else { <p class="muted">无</p> }
          <h2>未来两周计划开始</h2>
          @if (r.upcoming.length) { <ul>@for (w of r.upcoming; track w.code) { <li>{{ w.start }} {{ w.code }} {{ w.name }}</li> }</ul> } @else { <p class="muted">无</p> }
          <h2>问题与行动（未关闭 {{ r.openIssues }} 个）</h2>
          <ul>
            @for (i of r.issuesNew; track i.title) { <li>新增：{{ i.title }}{{ i.dueDate ? '（' + i.dueDate.slice(0, 10) + ' 前）' : '' }}</li> }
            @for (i of r.issuesClosed; track i.title) { <li>已关闭：{{ i.title }}</li> }
            @if (!r.issuesNew.length && !r.issuesClosed.length) { <li class="muted">本周无变化</li> }
          </ul>
          <h2>变更</h2>
          @if (r.changes.length) { <ul>@for (c of r.changes; track c.code) { <li>{{ c.code }} {{ c.title }}：{{ cs(c.status) }}</li> }</ul> } @else { <p class="muted">无</p> }
          <h2>主要风险与机会</h2>
          @if (r.topRisks.length) { <ul>@for (x of r.topRisks; track x.title) { <li>{{ x.kind === 'RISK' ? '风险' : '机会' }}：{{ x.title }}（评分 {{ x.score }}）</li> }</ul> } @else { <p class="muted">无</p> }
          @if (r.deviations.length) {
            <h2>偏离通报</h2>
            <ul>@for (d of r.deviations; track d.noticeDate + d.audience) { <li>{{ d.noticeDate.slice(0, 10) }} 向{{ d.audience }}通报{{ dim(d.dimension) }}偏离：{{ d.impact }}；对策：{{ d.countermeasures }}</li> }</ul>
          }
        </div>
      }
    </div>
  `,
})
export class ReportPage {
  private readonly api = inject(Api);
  readonly i18n = inject(I18n);
  readonly id = input.required<string>();
  readonly r = signal<Report | null>(null);
  hl(h: Health) { return HL[h]; }
  num(v: number | null) { return v === null ? '—' : v.toFixed(2); }
  money(v: number | null) { return v === null ? '—' : Math.round(v).toLocaleString(); }
  cs(s: ChangeStatus) { return CHANGE_STATUS_LABELS[s]; }
  dim(d: keyof typeof DIMENSION_LABELS) { return DIMENSION_LABELS[d]; }
  print() { window.print(); }
  async ngOnInit() { this.r.set(await this.api.get<Report>(`/projects/${this.id()}/weekly-report`)); }
}
