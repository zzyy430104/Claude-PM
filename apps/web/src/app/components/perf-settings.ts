import { Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { Api, errorMessage } from '../core/api';
import { Department, PerfConfig } from '../core/models';

interface Person { id: string; name: string }
const AUTO = ['TIME', 'QUALITY', 'COST'];
const RULES: [keyof PerfConfig['rules'], string][] = [
  ['latePerDay', '时间：每晚 1 个工作日扣分'],
  ['faiNotFirstPass', '质量：FAI 没有一次通过扣分'],
  ['fpyTarget', '质量：一次合格率目标（%）'],
  ['fpyPerPct', '质量：一次合格率每低 1 个百分点扣分'],
  ['majorNc', '质量：每个重大不符合项扣分'],
  ['criticalNc', '质量：每个严重不符合项扣分'],
  ['customerNc', '质量：每个客户投诉扣分'],
  ['capScore', '成本：完工成本到达成本上限时的得分'],
  ['overCapPerPct', '成本：超过上限后每超 1% 再扣分'],
  ['overTargetPerPct', '成本：没有上限时每超目标 1% 扣分'],
];

/** 企业设置 → 部门与负责人、项目绩效评价（方面与权重、计分规则、成员评价维度、等级、可见范围） */
@Component({
  selector: 'app-perf-settings',
  imports: [MatButtonModule],
  styles: `
    td input, td select { font: inherit; font-size: 13.5px; border: 1px solid var(--pm-line); border-radius: 6px; padding: 4px 6px; box-sizing: border-box; background: #fff; }
    td input.w { width: 70px; } td input.n { width: 100%; }
    .ok { color: var(--pm-green); margin-left: 8px; }
    .sum { font-weight: 700; } .sum.bad { color: var(--pm-red); }
    .checks label { display: block; font-size: 14px; margin: 4px 0; }
    tr.off td { color: var(--pm-muted); }
  `,
  template: `
    <section class="pcard" style="margin-top: 24px">
      <header><h3>部门与负责人</h3><span class="sub">项目绩效评价单发给员工所在部门的负责人；在“用户与角色”里给用户选部门</span></header>
      <div class="body">
        @if (deptError()) { <div class="error" role="alert">{{ deptError() }}</div> }
        <div class="tblwrap"><table>
          <thead><tr><th>部门</th><th>负责人</th><th>状态</th></tr></thead>
          <tbody>
            @for (d of depts(); track d.id) {
              <tr [class.off]="!d.active" [attr.data-dept]="d.name">
                <td><input class="n" [value]="d.name" (change)="patchDept(d, { name: $any($event.target).value })" aria-label="部门名称" /></td>
                <td><select (change)="patchDept(d, { headId: $any($event.target).value || null })" aria-label="部门负责人">
                  <option value="">未指定</option>@for (p of people(); track p.id) { <option [value]="p.id" [selected]="p.id === d.headId">{{ p.name }}</option> }</select></td>
                <td><button mat-button type="button" (click)="patchDept(d, { active: !d.active })">{{ d.active ? '停用' : '启用' }}</button></td>
              </tr>
            } @empty { <tr><td colspan="3" class="muted">还没有部门</td></tr> }
          </tbody>
        </table></div>
        <div style="display: flex; gap: 8px; margin-top: 10px; flex-wrap: wrap">
          <input #dn class="sm" placeholder="部门名称" aria-label="新部门名称" style="font: inherit; padding: 6px 8px; border: 1px solid var(--pm-line); border-radius: 8px" />
          <select #dh aria-label="新部门负责人" style="font: inherit; padding: 6px 8px; border: 1px solid var(--pm-line); border-radius: 8px"><option value="">负责人</option>@for (p of people(); track p.id) { <option [value]="p.id">{{ p.name }}</option> }</select>
          <button mat-stroked-button type="button" (click)="addDept(dn.value, dh.value); dn.value = ''">添加部门</button>
        </div>
      </div>
    </section>

    <section class="pcard">
      <header><h3>项目绩效评价</h3><span class="sub">默认值作参考，可以修改；单个项目还可在“总结与关闭”里按项目调整权重</span></header>
      <div class="body">
        @if (error()) { <div class="error" role="alert">{{ error() }}</div> }
        @if (c(); as x) {
          <h4>项目经理绩效：评价方面与权重</h4>
          <p class="muted" style="font-size: 13px">时间、质量、成本按项目数据自动计分（不需要时把权重设为 0）；自定义方面由管理层打分。</p>
          <div class="tblwrap"><table>
            <thead><tr><th>方面</th><th>权重（%）</th><th>计分</th><th></th></tr></thead>
            <tbody>
              @for (a of x.aspects; track a.key; let i = $index) {
                <tr [attr.data-aspect]="a.key">
                  <td><input class="n" [value]="a.name" (change)="setAspect(i, 'name', $any($event.target).value)" aria-label="方面名称" /></td>
                  <td><input class="w" type="number" min="0" max="100" [value]="a.weight" (change)="setAspect(i, 'weight', +$any($event.target).value)" aria-label="权重" /></td>
                  <td>{{ auto(a.key) ? '自动' : '管理层评分' }}</td>
                  <td>@if (!auto(a.key)) { <button mat-button type="button" (click)="removeAspect(i)">删除</button> }</td>
                </tr>
              }
              <tr><td>合计</td><td><span class="sum" [class.bad]="sum() !== 100">{{ sum() }}%</span></td><td colspan="2">@if (sum() !== 100) { <span class="muted">合计须为 100%</span> }</td></tr>
            </tbody>
          </table></div>
          <button mat-button type="button" (click)="addAspect()">+ 自定义方面</button>

          <h4>计分规则</h4>
          <div class="tblwrap"><table><tbody>
            @for (r of rules; track r[0]) { <tr><td>{{ r[1] }}</td><td><input class="w" type="number" min="0" max="100" [value]="x.rules[r[0]]" (change)="setRule(r[0], +$any($event.target).value)" [attr.aria-label]="r[1]" /></td></tr> }
          </tbody></table></div>

          <h4>成员评价维度（1–5 分）</h4>
          <div class="fgrid"><label class="fld">维度（用顿号或逗号分隔）<input [value]="x.memberDims.join('、')" (change)="setDims($any($event.target).value)" aria-label="成员评价维度" /></label></div>

          <h4>等级（综合分）</h4>
          <div class="fgrid">
            <label class="fld">优秀 ≥<input type="number" [value]="x.grades.excellent" (change)="setGrade('excellent', +$any($event.target).value)" aria-label="优秀" /></label>
            <label class="fld">良好 ≥<input type="number" [value]="x.grades.good" (change)="setGrade('good', +$any($event.target).value)" aria-label="良好" /></label>
            <label class="fld">合格 ≥<input type="number" [value]="x.grades.pass" (change)="setGrade('pass', +$any($event.target).value)" aria-label="合格" /></label>
          </div>
          <p class="muted" style="font-size: 12.5px">成员综合分 = 各维度平均分 × 20；低于“合格”为“待改进”。</p>

          <h4>可见范围</h4>
          <p class="muted" style="font-size: 13px">管理层和项目经理（评价人）始终可见；其他项目成员看不到别人的评价。</p>
          <div class="checks">
            <label><input type="checkbox" [checked]="x.visibility.memberSelf" (change)="setVis('memberSelf', $any($event.target).checked)" /> 被评价人提交后可以看到自己的评价</label>
            <label><input type="checkbox" [checked]="x.visibility.deptHead" (change)="setVis('deptHead', $any($event.target).checked)" /> 员工所在部门负责人可见（并收到评价单）</label>
            <label><input type="checkbox" [checked]="x.visibility.hr" (change)="setVis('hr', $any($event.target).checked)" /> 人事可见（并收到评价单、可批量导出）</label>
          </div>
          <div style="margin-top: 12px">
            <button mat-flat-button type="button" [disabled]="sum() !== 100" (click)="save()">保存绩效评价设置</button>
            <button mat-button type="button" (click)="reset()">恢复默认</button>
            @if (saved()) { <span class="ok">已保存</span> }
          </div>
        }
      </div>
    </section>
  `,
})
export class PerfSettings {
  private readonly api = inject(Api);
  readonly c = signal<PerfConfig | null>(null);
  readonly depts = signal<Department[]>([]);
  readonly people = signal<Person[]>([]);
  readonly error = signal('');
  readonly deptError = signal('');
  readonly saved = signal(false);
  readonly rules = RULES;
  readonly sum = computed(() => this.c()?.aspects.reduce((n, a) => n + (a.weight || 0), 0) ?? 0);
  private defaults: PerfConfig | null = null;

  async ngOnInit() {
    try {
      const [c, d, depts, people] = await Promise.all([
        this.api.get<PerfConfig>('/perf-settings'), this.api.get<PerfConfig>('/perf-settings/defaults'),
        this.api.get<Department[]>('/departments'), this.api.get<Person[]>('/users/directory'),
      ]);
      this.c.set(c); this.defaults = d; this.depts.set(depts); this.people.set(people);
    } catch (e) { this.error.set(errorMessage(e, '加载失败')); }
  }
  auto(k: string) { return AUTO.includes(k); }
  private edit(fn: (c: PerfConfig) => void) { this.saved.set(false); this.c.update((x) => { const n = structuredClone(x!); fn(n); return n; }); }
  setAspect(i: number, f: 'name' | 'weight', v: string | number) { this.edit((c) => { c.aspects[i] = { ...c.aspects[i], [f]: v }; }); }
  addAspect() {
    this.edit((c) => { let n = 1; while (c.aspects.some((a) => a.key === `CUSTOM_${n}`)) n++; c.aspects.push({ key: `CUSTOM_${n}`, name: '客户满意', weight: 0 }); });
  }
  removeAspect(i: number) { this.edit((c) => { c.aspects.splice(i, 1); }); }
  setRule(k: keyof PerfConfig['rules'], v: number) { this.edit((c) => { c.rules[k] = v; }); }
  setDims(v: string) { this.edit((c) => { c.memberDims = v.split(/[、,，]/).map((x) => x.trim()).filter(Boolean); }); }
  setGrade(k: keyof PerfConfig['grades'], v: number) { this.edit((c) => { c.grades[k] = v; }); }
  setVis(k: keyof PerfConfig['visibility'], v: boolean) { this.edit((c) => { c.visibility[k] = v; }); }
  reset() { if (this.defaults && confirm('恢复为默认的权重、规则、维度、等级和可见范围？')) { this.c.set(structuredClone(this.defaults)); this.saved.set(false); } }
  async save() {
    this.error.set('');
    try { this.c.set(await this.api.put<PerfConfig>('/perf-settings', this.c())); this.saved.set(true); } catch (e) { this.error.set(errorMessage(e, '保存失败')); }
  }

  async addDept(name: string, headId: string) {
    if (!name.trim()) { this.deptError.set('请填写部门名称'); return; }
    this.deptError.set('');
    try { await this.api.post('/departments', { name: name.trim(), headId: headId || undefined }); } catch (e) { this.deptError.set(errorMessage(e, '添加失败')); }
    this.depts.set(await this.api.get<Department[]>('/departments'));
  }
  async patchDept(d: Department, patch: Partial<Department>) {
    if (patch.name !== undefined && !patch.name.trim()) return;
    this.deptError.set('');
    try { await this.api.patch(`/departments/${d.id}`, patch); } catch (e) { this.deptError.set(errorMessage(e, '保存失败')); }
    this.depts.set(await this.api.get<Department[]>('/departments'));
  }
}
