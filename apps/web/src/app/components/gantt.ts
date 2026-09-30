import { Component, computed, input } from '@angular/core';
import { Dependency, WorkPackage } from '../core/models';

const ROW = 28;
const LABEL_W = 240;
const CHART_W = 760;
const HEADER = 24;

/** 甘特图：SVG 绘制，红色为关键路径，深色部分为完成进度，折线为依赖关系 */
@Component({
  selector: 'app-gantt',
  template: `
    @if (rows().length === 0) {
      <p>暂无工作包，添加工作包和依赖后这里会显示甘特图与关键路径。</p>
    } @else {
      <div class="scroll">
        <svg [attr.width]="LABEL_W + CHART_W + 60" [attr.height]="height()" role="img" aria-label="甘特图">
          @for (t of ticks(); track t.day) {
            <line [attr.x1]="t.x" [attr.x2]="t.x" [attr.y1]="HEADER" [attr.y2]="height()" stroke="var(--mat-sys-outline-variant)" />
            <text [attr.x]="t.x + 3" y="16" font-size="11" fill="var(--mat-sys-on-surface-variant)">第{{ t.day }}天</text>
          }
          @for (r of rows(); track r.id; let i = $index) {
            <text x="4" [attr.y]="HEADER + i * ROW + 18" font-size="12" fill="var(--mat-sys-on-surface)">
              {{ r.code }} {{ r.name.length > 16 ? r.name.slice(0, 16) + '…' : r.name }}
            </text>
            <rect
              [attr.x]="x(r.startOffsetDays)" [attr.y]="HEADER + i * ROW + 5"
              [attr.width]="w(r)" height="16" rx="3"
              [attr.fill]="r.critical ? 'var(--mat-sys-error-container)' : 'var(--mat-sys-primary-container)'"
              [attr.stroke]="r.critical ? 'var(--mat-sys-error)' : 'var(--mat-sys-primary)'"
              [attr.opacity]="r.isLeaf ? 1 : 0.55">
              <title>{{ r.code }} {{ r.name }}：{{ r.scheduledStart }} → {{ r.scheduledEnd }}（{{ r.percentComplete }}%{{ r.critical ? '，关键路径' : '' }}）</title>
            </rect>
            @if (r.percentComplete > 0) {
              <rect
                [attr.x]="x(r.startOffsetDays)" [attr.y]="HEADER + i * ROW + 5"
                [attr.width]="w(r) * r.percentComplete / 100" height="16" rx="3"
                [attr.fill]="r.critical ? 'var(--mat-sys-error)' : 'var(--mat-sys-primary)'" opacity="0.6" />
            }
          }
          @for (l of links(); track l.id) {
            <polyline [attr.points]="l.points" fill="none" stroke="var(--mat-sys-outline)" stroke-width="1" />
          }
        </svg>
      </div>
      <p class="legend">
        <span class="dot crit"></span> 关键路径　<span class="dot"></span> 非关键（有浮动时间）　深色为已完成进度
      </p>
    }
  `,
  styles: `
    .scroll { overflow-x: auto; }
    .legend { font-size: 12px; color: var(--mat-sys-on-surface-variant); }
    .dot { display: inline-block; width: 12px; height: 12px; border-radius: 3px; background: var(--mat-sys-primary-container); border: 1px solid var(--mat-sys-primary); vertical-align: middle; }
    .dot.crit { background: var(--mat-sys-error-container); border-color: var(--mat-sys-error); }
  `,
})
export class GanttComponent {
  readonly items = input.required<WorkPackage[]>();
  readonly dependencies = input<Dependency[]>([]);
  readonly totalDays = input.required<number>();

  protected readonly LABEL_W = LABEL_W;
  protected readonly CHART_W = CHART_W;
  protected readonly ROW = ROW;
  protected readonly HEADER = HEADER;

  /** 按编号排序，父节点在前，保持树的阅读顺序 */
  readonly rows = computed(() => [...this.items()].sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true })));
  readonly height = computed(() => HEADER + this.rows().length * ROW + 8);
  private readonly scale = computed(() => CHART_W / Math.max(this.totalDays(), 1));

  x(day: number) {
    return LABEL_W + day * this.scale();
  }
  w(r: WorkPackage) {
    return Math.max((r.endOffsetDays - r.startOffsetDays) * this.scale(), 3);
  }

  readonly ticks = computed(() => {
    const total = this.totalDays();
    const step = Math.max(1, Math.ceil(total / 10 / 5) * 5);
    const out: { day: number; x: number }[] = [];
    for (let d = 0; d <= total; d += step) out.push({ day: d, x: this.x(d) });
    return out;
  });

  readonly links = computed(() => {
    const index = new Map(this.rows().map((r, i) => [r.id, i]));
    const byId = new Map(this.rows().map((r) => [r.id, r]));
    return this.dependencies().flatMap((d) => {
      const a = byId.get(d.predecessorId);
      const b = byId.get(d.successorId);
      if (!a || !b) return [];
      const x1 = this.x(a.endOffsetDays);
      const y1 = HEADER + index.get(a.id)! * ROW + 13;
      const x2 = this.x(b.startOffsetDays);
      const y2 = HEADER + index.get(b.id)! * ROW + 13;
      const mid = Math.max(x1 + 6, Math.min(x2 - 6, x1 + 6));
      return [{ id: d.id, points: `${x1},${y1} ${mid},${y1} ${mid},${y2} ${x2},${y2}` }];
    });
  });
}
