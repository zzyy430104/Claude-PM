import { Component, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { Api } from '../core/api';
import { ResourceLoad } from '../core/models';

/** 资源负荷：按人按周的人天负荷，与每周可用工作日对比 */
@Component({
  selector: 'app-resources',
  imports: [MatButtonModule],
  styles: `
    .ctl { display: flex; gap: 10px; align-items: center; margin: 0 0 14px; flex-wrap: wrap; }
    .ctl input, .ctl select { height: 34px; border: 1px solid #c5cfdb; border-radius: 8px; padding: 0 8px; font: inherit; background: #fff; }
    .scroll { overflow-x: auto; }
    table.load { min-width: 100%; }
    table.load th, table.load td { text-align: center !important; white-space: nowrap; }
    table.load th:first-child, table.load td:first-child { text-align: left !important; position: sticky; left: 0; background: #fff; }
    td.c { font-variant-numeric: tabular-nums; }
    td.c.lvl1 { background: #e6f3ec; } td.c.lvl2 { background: #fbf2df; } td.c.lvl3 { background: #fbeceb; color: var(--pm-red); font-weight: 600; }
    .items { font-size: 12px; color: var(--pm-muted); white-space: normal; max-width: 360px; }
    .legend span { display: inline-block; width: 12px; height: 12px; border-radius: 3px; vertical-align: middle; margin: 0 4px 0 12px; }
  `,
  template: `
    <div class="page">
      <h1>资源负荷</h1>
      <p class="muted">按人汇总所有进行中项目里分配给他的工作包人天（没填人天的按全职投入计算），与每周的可用工作日对比。已完成的工作包不计入，未完成部分按剩余比例计算。</p>
      <div class="ctl">
        <label>起始日期 <input type="date" [value]="from()" (change)="from.set($any($event.target).value)" /></label>
        <label>周数
          <select [value]="weeks()" (change)="weeks.set(+$any($event.target).value)">
            @for (n of [4, 8, 12, 26]; track n) { <option [value]="n" [selected]="n === weeks()">{{ n }} 周</option> }
          </select>
        </label>
        <button mat-flat-button (click)="load()">查询</button>
        <span class="legend muted"><span style="background:#e6f3ec"></span>正常 <span style="background:#fbf2df"></span>接近满负荷（80% 以上） <span style="background:#fbeceb"></span>超负荷</span>
      </div>
      @if (data(); as d) {
        <div class="scroll">
          <table class="load">
            <thead>
              <tr><th>人员</th>@for (w of d.weeks; track w.start) { <th>{{ w.start.slice(5) }}<br /><span class="muted">可用 {{ w.capacity }}</span></th> }<th>工作包</th></tr>
            </thead>
            <tbody>
              @for (p of d.people; track p.userId) {
                <tr>
                  <td><strong>{{ p.name }}</strong>@if (p.overloadedWeeks) { <div class="muted" style="color: var(--pm-red)">超负荷 {{ p.overloadedWeeks }} 周</div> }</td>
                  @for (v of p.load; track $index) { <td class="c" [class]="'c ' + level(v, d.weeks[$index].capacity)">{{ v ? v : '' }}</td> }
                  <td class="items">@for (i of p.items; track i.project + i.code) { {{ i.project }} {{ i.code }} {{ i.name }}（{{ i.days }}）；}</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
        @if (d.people.length === 0) { <p class="muted">这段时间没有分配给个人的未完成工作包。</p> }
      }
    </div>
  `,
})
export class ResourcesPage {
  private readonly api = inject(Api);
  readonly from = signal(new Date().toISOString().slice(0, 10));
  readonly weeks = signal(12);
  readonly data = signal<ResourceLoad | null>(null);

  constructor() { void this.load(); }

  level(v: number, cap: number) {
    if (!v) return '';
    if (v > cap + 0.05) return 'lvl3';
    return v >= cap * 0.8 ? 'lvl2' : 'lvl1';
  }

  async load() {
    this.data.set(await this.api.get<ResourceLoad>(`/resource-load?from=${this.from()}&weeks=${this.weeks()}`));
  }
}
