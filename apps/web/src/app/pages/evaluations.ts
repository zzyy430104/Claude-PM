import { Component, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { Api, errorMessage } from '../core/api';
import { EvaluationSheet } from '../core/models';

const GRADE_COLOR: Record<string, string> = { 优秀: 'green', 良好: 'green', 合格: 'amber', 待改进: 'red' };

/** 项目绩效评价单：人事、部门负责人、管理层看各自范围内的评价单，本人看自己的；可按时间段导出 */
@Component({
  selector: 'app-evaluations',
  imports: [MatButtonModule],
  styles: `
    .bar { display: flex; gap: 10px; align-items: flex-end; flex-wrap: wrap; margin: 0 0 16px; }
    .bar .fld { min-width: 160px; }
    td small { display: block; color: var(--pm-muted); font-size: 12.5px; white-space: pre-line; }
    .num { text-align: right; white-space: nowrap; }
  `,
  template: `
    <div class="page">
      <h1>绩效评价单</h1>
      <p class="muted">项目经理对成员的评价只针对该项目的表现，系统内不做跨项目汇总；评价单输出给人事和员工所在部门，由它们纳入各自的考核。查看和导出都记审计日志。</p>
      @if (error()) { <div class="error" role="alert">{{ error() }}</div> }
      <div class="bar">
        <label class="fld">从<input type="date" #f aria-label="开始日期" /></label>
        <label class="fld">到<input type="date" #t aria-label="结束日期" /></label>
        <button mat-stroked-button type="button" (click)="load(f.value, t.value)">筛选</button>
        <button mat-flat-button type="button" (click)="export(f.value, t.value)">导出 Excel</button>
      </div>
      <section class="pcard">
        <header><h3>项目经理绩效</h3><span class="sub">{{ pms().length }} 份（管理层已确认）</span></header>
        <div class="tblwrap"><table>
          <thead><tr><th>项目</th><th>项目经理</th><th>部门</th><th>各方面</th><th class="num">综合</th><th>评语</th><th>确认日期</th></tr></thead>
          <tbody>
            @for (x of pms(); track x.id + x.userId) {
              <tr [attr.data-sheet]="x.name">
                <td>{{ x.project.code }} {{ x.project.name }}</td><td>{{ x.name }}</td><td>{{ x.department || '—' }}</td>
                <td>@for (a of x.aspects ?? []; track a.key) { <small>{{ a.name }} {{ a.weight }}%：{{ a.score ?? '—' }}（{{ a.actual }}）</small> }</td>
                <td class="num">{{ x.score }} <span [class]="'pill ' + color(x.grade)">{{ x.grade }}</span></td>
                <td>{{ x.comment || '—' }}@if (x.adjustReason) { <small>调整：{{ x.adjustReason }}</small> }</td>
                <td>{{ x.submittedAt?.slice(0, 10) }}</td>
              </tr>
            } @empty { <tr><td colspan="7" class="muted">没有可查看的项目经理绩效</td></tr> }
          </tbody>
        </table></div>
      </section>
      <section class="pcard">
        <header><h3>项目成员评价</h3><span class="sub">{{ members().length }} 份（项目经理已提交）</span></header>
        <div class="tblwrap"><table>
          <thead><tr><th>项目</th><th>成员</th><th>部门</th><th>角色</th><th>参考数据</th><th>各维度</th><th class="num">综合</th><th>评语</th><th>评价人</th><th>提交日期</th></tr></thead>
          <tbody>
            @for (x of members(); track x.id) {
              <tr [attr.data-sheet]="x.name">
                <td>{{ x.project.code }} {{ x.project.name }}</td><td>{{ x.name }}</td><td>{{ x.department || '—' }}</td><td>{{ x.roleName || '—' }}</td>
                <td><small>{{ x.reference?.text ?? '—' }}</small></td>
                <td>@for (d of dims(x); track d[0]) { <small>{{ d[0] }}：{{ d[1] }}</small> }</td>
                <td class="num">{{ x.score }} <span [class]="'pill ' + color(x.grade)">{{ x.grade }}</span></td>
                <td>{{ x.comment || '—' }}</td><td>{{ x.evaluator }}</td>
                <td>{{ x.submittedAt?.slice(0, 10) }}@if ((x.version ?? 1) > 1) { <small>第 {{ x.version }} 次提交</small> }</td>
              </tr>
            } @empty { <tr><td colspan="10" class="muted">没有可查看的成员评价</td></tr> }
          </tbody>
        </table></div>
      </section>
    </div>
  `,
})
export class EvaluationsPage {
  private readonly api = inject(Api);
  readonly pms = signal<EvaluationSheet[]>([]);
  readonly members = signal<EvaluationSheet[]>([]);
  readonly error = signal('');

  ngOnInit() { void this.load('', ''); }
  private query(from: string, to: string) { const q = new URLSearchParams(); if (from) q.set('from', from); if (to) q.set('to', to); const s = q.toString(); return s ? `?${s}` : ''; }
  async load(from: string, to: string) {
    this.error.set('');
    try {
      const x = await this.api.get<{ pms: EvaluationSheet[]; members: EvaluationSheet[] }>(`/evaluations${this.query(from, to)}`);
      this.pms.set(x.pms); this.members.set(x.members);
    } catch (e) { this.error.set(errorMessage(e, '加载失败')); }
  }
  async export(from: string, to: string) {
    this.error.set('');
    try { await this.api.download(`/evaluations/export${this.query(from, to)}`, `evaluations-${new Date().toISOString().slice(0, 10)}.xlsx`); } catch (e) { this.error.set(errorMessage(e, '导出失败')); }
  }
  color(g: string) { return GRADE_COLOR[g] ?? ''; }
  dims(x: EvaluationSheet) { return Object.entries(x.scores ?? {}); }
}
