import { Component, inject, input, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { Api, errorMessage } from '../core/api';
import { FAI_RESULT_LABELS, FaiRecordRow, FaiResult, FaiView, Member, Project } from '../core/models';

const COLOR: Record<FaiResult, string> = { PASS: 'green', CONDITIONAL: 'amber', FAIL: 'red' };

/** FAI 记录：只记结论和追溯信息，报告本身按企业现有方式编制保存；遗留项生成行动项 */
@Component({
  selector: 'app-project-fai',
  imports: [MatButtonModule],
  styles: `
    .banner { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; background: var(--pm-blue-bg); border-radius: var(--pm-radius); padding: 12px 18px; margin: 0 0 16px; font-size: 14px; }
    .banner.warn { background: var(--pm-amber-bg); }
    textarea { min-height: 70px; }
    td small { display: block; color: var(--pm-muted); font-size: 12.5px; }
    td.code { font-family: ui-monospace, monospace; white-space: nowrap; }
  `,
  template: `
    @if (error()) { <div class="error" role="alert">{{ error() }}</div> }
    @if (v(); as x) {
      <div class="banner" [class.warn]="x.state === 'AMBER' || x.state === 'RED'">
        <span>
          @if (x.requirement; as r) {
            本项目要求（项目要求 v{{ r.version }}）：<b>{{ r.fai ? '需要 FAI' + (r.customerWitness ? '，客户见证' : '') : '不做 FAI（' + (r.faiReason || '未写理由') + '）' }}</b>。
          }
          当前：{{ x.text }}@if (x.firstPass === false) { （不是一次通过） }
        </span>
      </div>
      @if (x.canEdit) {
        <section class="pcard">
          <header><h3>新建 FAI 记录</h3></header>
          <div class="body">
            <div class="fgrid">
              <label class="fld">报告编号 <span class="req">*</span><input #no aria-label="报告编号" placeholder="FAI-2026-031" /></label>
              <label class="fld">日期 <span class="req">*</span><input #dt type="date" aria-label="FAI 日期" /></label>
              <label class="fld">产品 / 零件号 <span class="req">*</span><input #pt aria-label="产品零件号" /></label>
              <label class="fld">结论<select #rs aria-label="FAI 结论" (change)="result.set($any($event.target).value)">@for (k of results; track k[0]) { <option [value]="k[0]">{{ k[1] }}</option> }</select></label>
              <label class="fld">客户见证人（如有）<input #wt aria-label="见证人" /></label>
              <label class="fld">报告存放位置<input #lc aria-label="存放位置" placeholder="如 质量部共享盘 /FAI/2026/031" /></label>
            </div>
            @if (result() !== 'PASS') {
              <div class="fgrid">
                <label class="fld" style="grid-column: 1 / -1">遗留项（每行一项，生成行动项）@if (result() === 'CONDITIONAL') { <span class="req">*</span> }<textarea #op aria-label="遗留项"></textarea></label>
                <label class="fld">责任人<select #ow aria-label="遗留项责任人"><option value="">—</option>@for (m of members(); track m.userId) { <option [value]="m.userId">{{ m.user?.name }}</option> }</select></label>
                <label class="fld">完成期限<input #dd type="date" aria-label="遗留项期限" /></label>
              </div>
              <button mat-flat-button type="button" (click)="create(no.value, dt.value, pt.value, rs.value, wt.value, lc.value, op.value, ow.value, dd.value)">保存 FAI 记录</button>
            } @else {
              <button mat-flat-button type="button" (click)="create(no.value, dt.value, pt.value, rs.value, wt.value, lc.value, '', '', '')">保存 FAI 记录</button>
            }
          </div>
        </section>
      }
      <section class="pcard">
        <header><h3>FAI 记录</h3><span class="sub">只记结论和追溯信息，报告本身按企业现有方式编制保存</span></header>
        <div class="tblwrap"><table>
          <thead><tr><th>报告编号</th><th>日期</th><th>产品 / 零件</th><th>结论</th><th>见证</th><th>存放位置</th><th>遗留项</th><th>登记人</th></tr></thead>
          <tbody>
            @for (r of x.records; track r.id) {
              <tr [attr.data-fai]="r.reportNo">
                <td class="code">{{ r.reportNo }}</td><td>{{ r.date }}</td><td>{{ r.part }}</td>
                <td><span [class]="'pill ' + color(r)">{{ label(r) }}</span></td>
                <td>{{ r.witnessed ? (r.witness || '已见证') : '—' }}</td>
                <td>{{ r.location || '—' }}</td>
                <td>@for (a of r.actions; track a.id) { <small>{{ a.status === 'CLOSED' ? '✓' : '○' }} {{ a.title }}</small> } @empty { — }</td>
                <td>{{ r.createdBy }}</td>
              </tr>
            } @empty { <tr><td colspan="8" class="muted">还没有 FAI 记录</td></tr> }
          </tbody>
        </table></div>
      </section>
    }
  `,
})
export class ProjectFai {
  private readonly api = inject(Api);
  readonly project = input.required<Project>();
  readonly v = signal<FaiView | null>(null);
  readonly members = signal<Member[]>([]);
  readonly error = signal('');
  readonly result = signal<FaiResult>('PASS');
  readonly results = Object.entries(FAI_RESULT_LABELS) as [FaiResult, string][];

  async ngOnInit() {
    try { this.members.set(await this.api.get<Member[]>(`/projects/${this.project().id}/members`)); } catch { /* 只读用户 */ }
    await this.load();
  }
  async load() {
    try { this.v.set(await this.api.get<FaiView>(`/projects/${this.project().id}/fai`)); } catch (e) { this.error.set(errorMessage(e, '加载失败')); }
  }
  label(r: FaiRecordRow) { return FAI_RESULT_LABELS[r.result]; }
  color(r: FaiRecordRow) { return COLOR[r.result]; }
  async create(reportNo: string, date: string, part: string, result: string, witness: string, location: string, points: string, ownerId: string, dueDate: string) {
    if (!reportNo.trim() || !date || !part.trim()) { this.error.set('请填写报告编号、日期和产品 / 零件号'); return; }
    this.error.set('');
    try {
      await this.api.post(`/projects/${this.project().id}/fai`, {
        reportNo: reportNo.trim(), date, part: part.trim(), result, witnessed: !!witness.trim(), witness: witness.trim(), location: location.trim(),
        openPoints: points.split('\n').map((x) => x.trim()).filter(Boolean), ownerId: ownerId || undefined, dueDate: dueDate || undefined,
      });
      this.result.set('PASS');
      await this.load();
    } catch (e) { this.error.set(errorMessage(e, '保存失败')); }
  }
}
