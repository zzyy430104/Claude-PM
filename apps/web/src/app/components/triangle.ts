import { NgTemplateOutlet } from '@angular/common';
import { Component, inject, input } from '@angular/core';
import { I18n } from '../core/i18n';
import { Health, Performance } from '../core/models';

const LABEL: Record<Health, string> = { RED: '告警', AMBER: '关注', GREEN: '正常' };

/** 质量 / 进度 / 成本三方面状态：项目管理目标的三个约束，各自给出红黄绿、关键数字和原因 */
@Component({
  selector: 'app-triangle',
  styles: `
    .tri { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; margin: 0 0 20px; }
    @media (max-width: 900px) { .tri { grid-template-columns: 1fr; } }
    .card { background: var(--pm-card); border: 1px solid var(--pm-line); border-radius: var(--pm-radius); box-shadow: var(--pm-shadow); padding: 14px 18px; border-top: 3px solid var(--pm-green); }
    .card.RED { border-top-color: var(--pm-red); } .card.AMBER { border-top-color: var(--pm-amber); }
    .head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
    .head b { font-size: 15px; }
    .kpi { display: grid; grid-template-columns: repeat(3, auto); justify-content: start; gap: 4px 16px; margin: 4px 0 8px; }
    .kpi div { display: flex; flex-direction: column; }
    .kpi strong { font-size: 17px; white-space: nowrap; font-weight: 600; line-height: 1.2; }
    .kpi span { color: var(--pm-muted); font-size: 12px; }
    ul { margin: 0; padding-left: 18px; font-size: 12.5px; color: var(--pm-muted); }
    .ok { font-size: 12.5px; color: var(--pm-muted); }
    .note { color: var(--pm-muted); font-size: 12px; margin: -12px 0 18px; }
  `,
  template: `
    @if (perf(); as p) {
      <div class="tri">
        <div class="card" [class]="'card ' + p.triangle.quality.health">
          <div class="head"><b>质量</b><span [class]="'badge ' + p.triangle.quality.health">{{ label(p.triangle.quality.health) }}</span></div>
          <div class="kpi">
            <div><strong>{{ p.quality.acceptedDeliverables }}/{{ p.quality.deliverables }}</strong><span>交付物已接受</span></div>
            <div><strong>{{ p.quality.requirements - p.quality.uncoveredRequirements }}/{{ p.quality.requirements }}</strong><span>需求已覆盖</span></div>
            <div><strong>{{ p.quality.openNonconformities }}</strong><span>未关闭不符合项</span></div>
          </div>
          <ng-container *ngTemplateOutlet="reasons; context: { $implicit: p.triangle.quality.reasons }" />
        </div>
        <div class="card" [class]="'card ' + p.triangle.schedule.health">
          <div class="head"><b>进度</b><span [class]="'badge ' + p.triangle.schedule.health">{{ label(p.triangle.schedule.health) }}</span></div>
          <div class="kpi">
            <div><strong>{{ num(p.evm.spi) }}</strong><span>进度绩效指数 SPI</span></div>
            <div><strong>{{ p.schedule.projectedEnd }}</strong><span>预计完工</span></div>
            <div><strong>{{ p.schedule.customerDate ?? '—' }}</strong><span>客户交期</span></div>
          </div>
          <ng-container *ngTemplateOutlet="reasons; context: { $implicit: p.triangle.schedule.reasons }" />
        </div>
        <div class="card" [class]="'card ' + p.triangle.cost.health">
          <div class="head"><b>成本</b><span [class]="'badge ' + p.triangle.cost.health">{{ label(p.triangle.cost.health) }}</span></div>
          <div class="kpi">
            <div><strong>{{ num(p.evm.cpi) }}</strong><span>成本绩效指数 CPI</span></div>
            <div><strong>{{ money(p.evm.eac) }}</strong><span>完工估算</span></div>
            <div><strong>{{ money(p.evm.budget) }}</strong><span>预算</span></div>
          </div>
          <ng-container *ngTemplateOutlet="reasons; context: { $implicit: p.triangle.cost.reasons }" />
        </div>
      </div>
      @if (p.baselineVersion === null) { <p class="note">计划批准后才计算 SPI、CPI 和与计划的偏差。</p> }
      @else { <p class="note">对比基准：计划批准第 {{ p.baselineVersion }} 版。指数低于 {{ p.thresholds.amber }} 为关注，低于 {{ p.thresholds.red }} 为告警。</p> }
    }
    <ng-template #reasons let-rs>
      @if (rs.length) { <ul>@for (r of rs; track r) { <li>{{ i18n.t(r) }}</li> }</ul> } @else { <div class="ok">无异常</div> }
    </ng-template>
  `,
  imports: [NgTemplateOutlet],
})
export class TriangleComponent {
  readonly i18n = inject(I18n);
  readonly perf = input<Performance | null>(null);
  label(h: Health) { return this.i18n.t(LABEL[h]); }
  num(v: number | null) { return v === null ? '—' : v.toFixed(2); }
  money(v: number | null) { return v === null ? '—' : Math.round(v).toLocaleString(); }
}
