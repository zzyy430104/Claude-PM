import { Component, computed, inject, input, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { Api, errorMessage } from '../core/api';
import { askText } from '../core/i18n';
import { MemberEvalRow, PerfAspect, Project, ProjectEvaluation } from '../core/models';

const GRADE_COLOR: Record<string, string> = { 优秀: 'green', 良好: 'green', 合格: 'amber', 待改进: 'red' };

/** 项目绩效评价（第 5C 章）：项目经理绩效自动计分 + 管理层评语与确认；项目经理评价成员（只针对本项目） */
@Component({
  selector: 'app-project-evaluation',
  imports: [MatButtonModule],
  styles: `
    h4 { margin: 4px 0 6px; font-size: 15px; } h4 small { font-weight: 400; color: var(--pm-muted); font-size: 12.5px; margin-left: 6px; }
    .muted.s { font-size: 13px; margin: 0 0 8px; }
    td input, td select, .inl input, .inl select, textarea { font: inherit; font-size: 14px; border: 1px solid var(--pm-line); border-radius: 8px; padding: 5px 8px; background: #fff; box-sizing: border-box; }
    td input.w { width: 64px; } td input.c { width: 100%; min-width: 140px; }
    .num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
    tr.total td { background: var(--pm-bg-2); font-weight: 700; }
    .inl { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; margin: 10px 0; font-size: 14px; }
    textarea { width: 100%; min-height: 60px; }
    .foot { display: flex; gap: 10px; align-items: center; justify-content: flex-end; flex-wrap: wrap; margin-top: 12px; }
    .foot .sp { flex: 1; font-size: 12.5px; color: var(--pm-muted); }
    td.ref { font-size: 13px; color: var(--pm-muted); }
    td:first-child, td.nw, td:has(> input.w), td:has(> button), td:has(> select) { white-space: nowrap; }
    td.ref { min-width: 200px; }
    hr { border: 0; border-top: 1px solid var(--pm-line); margin: 18px 0; }
  `,
  template: `
    <section class="pcard">
      <header><h3>项目绩效评价</h3><span class="pill">权限受控</span><span class="sub grow">按企业设置的可见范围显示</span>
        @if (ev()?.can?.export) { <button mat-stroked-button type="button" (click)="export()">导出评价单</button> }
      </header>
      <div class="body">
        @if (error()) { <div class="error" role="alert">{{ error() }}</div> }
        @if (ev(); as e) {
          @if (e.pm; as pm) {
            <h4>项目经理 {{ managerNames() }}<small>自动计算 · 本人、所在部门负责人、人事、管理层可见</small></h4>
            <p class="muted s">权重按企业默认值带出，可按本项目调整，调整留记录。@if (pm.aspectsReason) { 本项目调整原因：{{ pm.aspectsReason }} }</p>
            <div class="tblwrap"><table>
              <thead><tr><th>方面</th><th>权重</th><th>目标</th><th>实际</th><th class="num">得分</th></tr></thead>
              <tbody>
                @for (a of pm.aspects; track a.key; let i = $index) {
                  <tr [attr.data-aspect]="a.key">
                    <td>{{ a.name }}</td>
                    <td>@if (weightsEditable()) { <input class="w" type="number" min="0" max="100" [value]="weights()[i]?.weight ?? a.weight" (change)="setWeight(i, +$any($event.target).value)" [attr.aria-label]="'权重 ' + a.name" />% } @else { {{ a.weight }}% }</td>
                    <td>{{ a.target }}</td>
                    <td>{{ a.actual }}@if (a.estimate) { <span class="pill amber">预计</span> }</td>
                    <td class="num">
                      @if (!a.auto && e.can.manage && !pm.confirmedAt) { <input class="w" type="number" min="0" max="100" [value]="a.score ?? ''" (change)="manual(a.key, +$any($event.target).value)" [attr.aria-label]="'得分 ' + a.name" /> }
                      @else { {{ a.score ?? '—' }} }
                    </td>
                  </tr>
                }
                <tr class="total"><td colspan="4">综合@if (pm.adjustedScore !== null) { （计算 {{ pm.total }}，管理层调整：{{ pm.adjustReason }}）}@if (!pm.complete) { <span class="muted">（还有方面未评分）</span> }</td>
                  <td class="num" data-total>{{ pm.score ?? '—' }} @if (pm.grade) { <span [class]="'pill ' + color(pm.grade)">{{ pm.grade }}</span> }</td></tr>
              </tbody>
            </table></div>
            @if (weightsEditable()) {
              <div class="inl">
                @if (weightsDirty()) { <span [class.error]="weightSum() !== 100" style="margin: 0">合计 {{ weightSum() }}%</span><button mat-stroked-button type="button" [disabled]="weightSum() !== 100" (click)="saveWeights()">保存本项目权重</button> }
                @if (pm.customAspects) { <button mat-button type="button" (click)="resetWeights()">恢复企业默认权重</button> }
                @if (e.can.manage) { <button mat-button type="button" (click)="addAspect()">+ 本项目自定义方面</button> }
              </div>
            }
            @if (!pm.confirmedAt) {
              <div class="inl">
                <label>实际交付（入库）日期 <input type="date" [value]="pm.actualDelivery ?? ''" (change)="patchPm({ actualDelivery: $any($event.target).value || null })" aria-label="实际交付日期" /></label>
                <span class="muted" style="font-size: 12.5px">不填时按交付物全部验收的日期；还没验收完按排程预计</span>
              </div>
            }
            @if (e.can.manage && !pm.confirmedAt) {
              <label class="fld" style="display: block">管理层评语<textarea [value]="pm.comment ?? ''" (change)="patchPm({ comment: $any($event.target).value })" aria-label="管理层评语" placeholder="例如：交期提前 10 天的要求变更下仍按期交付"></textarea></label>
              <div class="inl">
                <label>调整分数 <input class="w" type="number" min="0" max="100" #adj [value]="pm.adjustedScore ?? ''" aria-label="调整分数" style="width: 70px" /></label>
                <input #adjr placeholder="调整理由（必填）" [value]="pm.adjustReason ?? ''" aria-label="调整理由" style="flex: 1; min-width: 200px" />
                <button mat-stroked-button type="button" (click)="adjust(adj.value, adjr.value)">保存调整</button>
              </div>
              <div class="foot"><span class="sp">确认后计算结果冻结，通知项目经理、人事和所在部门负责人。</span><button mat-flat-button type="button" (click)="confirmPm()">确认项目经理绩效</button></div>
            } @else if (pm.confirmedAt) {
              <p class="muted s">管理层已于 {{ pm.confirmedAt.slice(0, 10) }} 确认。@if (pm.comment) { 评语：{{ pm.comment }} }</p>
            }
            <hr />
          }

          <h4>项目成员<small>只评价在本项目的表现 · 提交后输出给人事和员工所在部门</small></h4>
          @if (e.members.length) {
            <div class="tblwrap"><table>
              <thead><tr><th>成员</th><th>角色</th><th>参考数据</th>@for (d of e.config.memberDims; track d) { <th>{{ d }}</th> }<th>等级</th><th>评语</th><th></th></tr></thead>
              <tbody>
                @for (m of e.members; track m.userId) {
                  <tr [attr.data-member]="m.name">
                    <td>{{ m.name }}</td><td>{{ m.roleName || '—' }}</td>
                    <td class="ref">{{ m.reference?.text ?? '—' }}</td>
                    @for (d of e.config.memberDims; track d) {
                      <td>@if (m.editable) {
                        <select (change)="score(m, d, +$any($event.target).value)" [attr.aria-label]="m.name + ' ' + d">
                          <option value="" [selected]="m.scores[d] === undefined">—</option>
                          @for (n of [1, 2, 3, 4, 5]; track n) { <option [value]="n" [selected]="m.scores[d] === n">{{ n }}</option> }
                        </select>
                      } @else { {{ m.scores[d] ?? '—' }} }</td>
                    }
                    <td>@if (m.grade) { <span [class]="'pill ' + color(m.grade)">{{ m.grade }}</span> <small class="muted">{{ m.score }}</small> } @else { — }</td>
                    <td>@if (m.editable) { <input class="c" [value]="m.comment" placeholder="评语" (change)="comment(m, $any($event.target).value)" [attr.aria-label]="m.name + ' 评语'" /> } @else { {{ m.comment || '—' }} }</td>
                    <td>
                      @if (e.can.evaluate) {
                        @if (m.status === 'SUBMITTED') { <span class="pill green">已提交@if (m.version > 1) { （第 {{ m.version }} 次）}</span> <button mat-button type="button" (click)="reopen(m)">撤回修改</button> }
                        @else { <button mat-stroked-button type="button" (click)="submit(m)">提交</button> }
                      } @else if (m.status === 'SUBMITTED') { <span class="pill green">已提交</span> }
                    </td>
                  </tr>
                }
              </tbody>
            </table></div>
            @if (e.can.evaluate && drafts().length > 1) {
              <div class="foot"><span class="sp">参考数据由系统统计，打分由项目经理完成；提交后锁定，修改须撤回并重新提交（留记录）。</span><button mat-flat-button type="button" (click)="submitAll()">全部提交并发送人事、部门</button></div>
            }
          } @else { <p class="muted s">没有可评价或可查看的成员评价。</p> }
        }
      </div>
    </section>
  `,
})
export class ProjectEvaluationPanel {
  private readonly api = inject(Api);
  readonly project = input.required<Project>();
  readonly ev = signal<ProjectEvaluation | null>(null);
  readonly error = signal('');
  readonly weights = signal<PerfAspect[]>([]);
  readonly weightsDirty = signal(false);
  readonly weightSum = computed(() => this.weights().reduce((n, a) => n + (a.weight || 0), 0));
  readonly weightsEditable = computed(() => { const e = this.ev(); return !!e?.pm && e.can.setWeights && !e.pm.confirmedAt; });
  readonly managerNames = computed(() => this.ev()?.pm?.managers.map((m) => m.name).join('、') ?? '');
  readonly drafts = computed(() => this.ev()?.members.filter((m) => m.status === 'DRAFT') ?? []);
  private readonly base = () => `/projects/${this.project().id}/evaluation`;

  async ngOnInit() { await this.load(); }
  async load() {
    try {
      const e = await this.api.get<ProjectEvaluation>(this.base());
      this.ev.set(e);
      this.weights.set(e.pm ? e.pm.aspects.map((a) => ({ key: a.key, name: a.name, weight: a.weight })) : []);
      this.weightsDirty.set(false);
    } catch (e) {
      // 没有任何可看的内容时（例如普通成员、评价尚未提交）不显示错误
      const status = (e as { status?: number }).status;
      if (status === 403) this.ev.set(null); else this.error.set(errorMessage(e, '加载失败'));
    }
  }
  color(g: string) { return GRADE_COLOR[g] ?? ''; }

  private async run(fn: () => Promise<unknown>, fallback: string) {
    this.error.set('');
    try { await fn(); } catch (e) { this.error.set(errorMessage(e, fallback)); }
    await this.load();
  }

  setWeight(i: number, w: number) { this.weights.update((x) => x.map((a, j) => (j === i ? { ...a, weight: w } : a))); this.weightsDirty.set(true); }
  saveWeights() {
    const reason = askText('调整本项目权重的原因（留记录）');
    if (!reason?.trim()) return;
    return this.run(() => this.api.put(`${this.base()}/aspects`, { aspects: this.weights(), reason: reason.trim() }), '保存失败');
  }
  resetWeights() {
    const reason = askText('恢复企业默认权重的原因');
    if (!reason?.trim()) return;
    return this.run(() => this.api.put(`${this.base()}/aspects`, { aspects: null, reason: reason.trim() }), '保存失败');
  }
  addAspect() {
    const name = askText('自定义方面名称（如 客户满意）');
    if (!name?.trim()) return;
    let n = 1;
    while (this.weights().some((a) => a.key === `P_${n}`)) n++;
    this.weights.update((x) => [...x, { key: `P_${n}`, name: name.trim(), weight: 0 }]);
    this.weightsDirty.set(true);
    return Promise.resolve();
  }
  manual(key: string, v: number) { return this.run(() => this.api.put(`${this.base()}/pm`, { manualScores: { [key]: v } }), '保存失败'); }
  patchPm(patch: Record<string, unknown>) { return this.run(() => this.api.put(`${this.base()}/pm`, patch), '保存失败'); }
  adjust(score: string, reason: string) {
    return this.patchPm(score === '' ? { adjustedScore: null } : { adjustedScore: +score, adjustReason: reason });
  }
  confirmPm() {
    if (!confirm('确认项目经理绩效？确认后计算结果冻结，不能再修改。')) return;
    return this.run(() => this.api.post(`${this.base()}/pm/confirm`, {}), '确认失败');
  }

  score(m: MemberEvalRow, dim: string, v: number) { if (v) return this.run(() => this.api.put(`${this.base()}/members/${m.userId}`, { scores: { [dim]: v } }), '保存失败'); return undefined; }
  comment(m: MemberEvalRow, v: string) { return this.run(() => this.api.put(`${this.base()}/members/${m.userId}`, { scores: {}, comment: v }), '保存失败'); }
  submit(m: MemberEvalRow) { return this.run(() => this.api.post(`${this.base()}/members/${m.userId}/submit`, {}), '提交失败'); }
  async submitAll() {
    this.error.set('');
    for (const m of this.drafts()) {
      try { await this.api.post(`${this.base()}/members/${m.userId}/submit`, {}); } catch (e) { this.error.set(`${m.name}：${errorMessage(e, '提交失败')}`); break; }
    }
    await this.load();
  }
  reopen(m: MemberEvalRow) {
    const reason = askText(`撤回 ${m.name} 的评价进行修改，原因：`);
    if (!reason?.trim()) return;
    return this.run(() => this.api.post(`${this.base()}/members/${m.userId}/reopen`, { reason: reason.trim() }), '撤回失败');
  }
  export() { return this.run(() => this.api.download(`/evaluations/export?projectId=${this.project().id}`, `evaluation-${this.project().code}.xlsx`), '导出失败'); }
}
