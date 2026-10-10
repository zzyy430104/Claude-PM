import { Component, computed, input } from '@angular/core';
import { Dependency, WorkPackage } from '../core/models';

/** 计划批准快照里各工作包的计划起止日期 */
export type BaselineDates = Record<string, { start: string; end: string }>;

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
            @if (r.isMilestone) {
              <polygon [attr.points]="diamond(r, i)" fill="var(--pm-primary)" stroke="var(--pm-primary-strong)">
                <title>里程碑 {{ r.code }} {{ r.name }}：{{ r.scheduledStart }}</title>
              </polygon>
            } @else {
            <rect
              [attr.x]="x(r.startOffsetDays)" [attr.y]="HEADER + i * ROW + 5"
              [attr.width]="w(r)" height="16" rx="3"
              [attr.fill]="r.critical ? 'var(--mat-sys-error-container)' : 'var(--mat-sys-primary-container)'"
              [attr.stroke]="r.critical ? 'var(--mat-sys-error)' : 'var(--mat-sys-primary)'"
              [attr.opacity]="r.isLeaf ? 1 : 0.55">
              <title>{{ r.code }} {{ r.name }}：{{ r.scheduledStart }} → {{ r.scheduledEnd }}（{{ r.percentComplete }}%{{ r.critical ? '，关键路径' : '' }}）</title>
            </rect>
            }
            @if (bars()[r.id]; as b) {
              <rect [attr.x]="x(b.s)" [attr.y]="HEADER + i * ROW + 22" [attr.width]="Math.max((b.e - b.s) * scale(), 3)" height="4" rx="2" fill="#8a97a8">
                <title>批准的计划：{{ b.start }} → {{ b.end }}</title>
              </rect>
            }
            @if (r.percentComplete > 0 && !r.isMilestone) {
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
        @if (hasBaseline()) { 　<span class="bl"></span> 批准的计划 }
        　◆ 里程碑
      </p>
    }
  `,
  styles: `
    .scroll { overflow-x: auto; }
    .legend { font-size: 12px; color: var(--mat-sys-on-surface-variant); }
    .dot { display: inline-block; width: 12px; height: 12px; border-radius: 3px; background: var(--mat-sys-primary-container); border: 1px solid var(--mat-sys-primary); vertical-align: middle; }
    .bl { display: inline-block; width: 16px; height: 4px; border-radius: 2px; background: #8a97a8; vertical-align: middle; }
    .dot.crit { background: var(--mat-sys-error-container); border-color: var(--mat-sys-error); }
  `,
})
export class GanttComponent {
  readonly items = input.required<WorkPackage[]>();
  readonly dependencies = input<Dependency[]>([]);
  readonly totalDays = input.required<number>();
  readonly baseline = input<BaselineDates | null>(null);
  protected readonly Math = Math;

  protected readonly LABEL_W = LABEL_W;
  protected readonly CHART_W = CHART_W;
  protected readonly ROW = ROW;
  protected readonly HEADER = HEADER;

  /** 按编号排序，父节点在前，保持树的阅读顺序 */
  readonly rows = computed(() => [...this.items()].sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true })));
  readonly height = computed(() => HEADER + this.rows().length * ROW + 8);
  readonly hasBaseline = computed(() => !!this.baseline() && Object.keys(this.baseline()!).length > 0);

  /** 批准计划的日期换算成相对项目开始的天数；项目开始日由任一工作包的排程反推 */
  readonly bars = computed(() => {
    const base = this.baseline();
    const first = this.rows()[0];
    if (!base || !first) return {} as Record<string, { s: number; e: number; start: string; end: string }>;
    const origin = Date.parse(first.scheduledStart) - first.startOffsetDays * 86_400_000;
    const out: Record<string, { s: number; e: number; start: string; end: string }> = {};
    for (const [id, d] of Object.entries(base)) {
      out[id] = { s: (Date.parse(d.start) - origin) / 86_400_000, e: (Date.parse(d.end) - origin) / 86_400_000, start: d.start, end: d.end };
    }
    return out;
  });
  private readonly span = computed(() => Math.max(this.totalDays(), ...Object.values(this.bars()).map((b) => b.e), 1));
  protected readonly scale = computed(() => CHART_W / this.span());

  diamond(r: WorkPackage, i: number) {
    const cx = this.x(r.startOffsetDays);
    const cy = HEADER + i * ROW + 13;
    return `${cx},${cy - 8} ${cx + 8},${cy} ${cx},${cy + 8} ${cx - 8},${cy}`;
  }
  x(day: number) {
    return LABEL_W + day * this.scale();
  }
  w(r: WorkPackage) {
    return Math.max((r.endOffsetDays - r.startOffsetDays) * this.scale(), 3);
  }

  readonly ticks = computed(() => {
    const total = Math.ceil(this.span());
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
