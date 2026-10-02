import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { Api, errorMessage } from '../core/api';
import { PROJECT_TYPE_LABELS, PlanTemplate, PlanTemplateRow, ProjectType } from '../core/models';
import { askConfirm } from '../core/dialog';

const COND: Record<string, string> = { drawingApproval: '客户图纸审批', customerWitness: '客户见证', rams: 'RAMS', longLead: '长周期物料' };

/** A/B/C 项目类型模板：立项批准时按类型生成阶段和计划草稿。企业用 Excel 导出、修改、导入。 */
@Component({
  selector: 'app-plan-type-templates',
  imports: [MatButtonModule],
  styles: `
    .bar { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin: 0 0 12px; }
    .bar .grow { flex: 1; }
    .seg { display: inline-flex; border: 1px solid var(--pm-line); border-radius: 10px; background: #fff; padding: 2px; }
    .seg button { border: 0; background: none; font: inherit; font-size: 13.5px; padding: 5px 12px; border-radius: 8px; cursor: pointer; color: var(--pm-muted); }
    .seg button[aria-pressed=true] { background: var(--pm-primary); color: #fff; }
    tr.grp td { background: var(--pm-bg); font-weight: 700; }
    td.c { white-space: nowrap; }
    .cond { font-size: 11.5px; border-radius: 6px; padding: 1px 7px; background: var(--pm-amber-bg); color: var(--pm-amber); white-space: nowrap; }
  `,
  template: `
    <p class="muted">立项批准时按项目类型生成阶段、工作包（带工期、前置和职能角色）和交付物；“条件”列的工作包只在立项时勾选了对应要求才生成。修改方法：导出 Excel → 修改 → 导入（导入前会整体检查，有错不写入）。</p>
    <div class="bar">
      <div class="seg" role="group" aria-label="项目类型">
        @for (t of types; track t) { <button type="button" [attr.aria-pressed]="type() === t" (click)="select(t)">{{ typeLabel(t) }}</button> }
      </div>
      <span class="grow"></span>
      <button mat-stroked-button type="button" (click)="exportExcel()">导出 Excel</button>
      <button mat-stroked-button type="button" (click)="file.click()">导入 Excel</button>
      <input #file type="file" accept=".xlsx" hidden (change)="importExcel($any($event.target))" aria-label="选择 Excel 文件" />
      @if (tpl()?.custom) { <button mat-button type="button" (click)="reset()">恢复默认</button> }
    </div>
    @if (notice()) { <div class="banner green" role="status">{{ notice() }}</div> }
    @if (errors().length) {
      <div class="error" role="alert">导入失败，模板没有改动：<ul>@for (e of errors(); track e) { <li>{{ e }}</li> }</ul></div>
    }
    @if (error()) { <div class="error" role="alert">{{ error() }}</div> }
    @if (tpl(); as t) {
      <section class="pcard">
        <header><h3>{{ typeLabel(t.type) }}</h3>
          <span class="sub">{{ count(t.items) }} 个工作包 · {{ t.custom ? '企业自定义（' + (t.updatedAt?.slice(0, 10) ?? '') + '）' : '系统默认' }}</span></header>
        <div class="tblwrap">
          <table>
            <thead><tr><th>编号</th><th>名称</th><th>工期</th><th>前置</th><th>责任角色</th><th>交付物 / 记录</th><th>条件</th></tr></thead>
            <tbody>
              @for (r of t.items; track r.code) {
                @if (r.group) {
                  <tr class="grp"><td>{{ r.code }}</td><td colspan="6">{{ r.name }}{{ r.phase ? '' : '（工作线，贯穿全程）' }}</td></tr>
                } @else {
                  <tr>
                    <td class="c">{{ r.code }}</td>
                    <td>{{ r.milestone ? '◆ ' : '' }}{{ r.name }}</td>
                    <td class="c">{{ r.milestone ? '里程碑' : r.durationDays + ' 天' }}</td>
                    <td class="c">{{ r.predecessors?.join('、') }}</td>
                    <td class="c">{{ r.role }}</td>
                    <td>{{ r.deliverable }}</td>
                    <td>@if (r.condition) { <span class="cond">{{ cond(r.condition) }}</span> }</td>
                  </tr>
                }
              }
            </tbody>
          </table>
        </div>
      </section>
    }
  `,
})
export class PlanTypeTemplates {
  private readonly api = inject(Api);
  readonly types: ProjectType[] = ['A', 'B', 'C'];
  readonly type = signal<ProjectType>('A');
  readonly tpl = signal<PlanTemplate | null>(null);
  readonly error = signal('');
  readonly errors = signal<string[]>([]);
  readonly notice = signal('');

  ngOnInit() { void this.load(); }

  typeLabel(t: ProjectType) { return PROJECT_TYPE_LABELS[t]; }
  cond(c: string) { return COND[c] ?? c; }
  count(rows: PlanTemplateRow[]) { return rows.filter((r) => !r.group).length; }

  async select(t: ProjectType) {
    this.type.set(t);
    this.notice.set(''); this.errors.set([]);
    await this.load();
  }
  async load() {
    try { this.tpl.set(await this.api.get<PlanTemplate>(`/plan-templates/${this.type()}`)); } catch (e) { this.error.set(errorMessage(e, '加载失败')); }
  }
  async exportExcel() {
    try { await this.api.download(`/plan-templates/${this.type()}/export`, `计划模板-${this.type()}类.xlsx`); } catch (e) { this.error.set(errorMessage(e, '导出失败')); }
  }
  async importExcel(input: HTMLInputElement) {
    const f = input.files?.[0];
    input.value = '';
    if (!f) return;
    this.error.set(''); this.errors.set([]); this.notice.set('');
    const form = new FormData();
    form.append('file', f);
    try {
      const t = await this.api.upload<PlanTemplate>(`/plan-templates/${this.type()}/import`, form);
      this.tpl.set(t);
      this.notice.set(`已导入 ${this.count(t.items)} 个工作包。以后立项批准的 ${this.type()} 类项目按新模板生成计划。`);
    } catch (e) {
      const problems = e instanceof HttpErrorResponse ? (e.error as { problems?: string[] } | null)?.problems : undefined;
      if (problems?.length) this.errors.set(problems);
      else this.error.set(errorMessage(e, '导入失败'));
    }
  }
  async reset() {
    if (!await askConfirm(`把 ${this.type()} 类模板恢复为系统默认？企业自定义的内容会丢失。`)) return;
    try {
      this.tpl.set(await this.api.post<PlanTemplate>(`/plan-templates/${this.type()}/reset`));
      this.notice.set('已恢复默认模板');
    } catch (e) { this.error.set(errorMessage(e, '操作失败')); }
  }
}
