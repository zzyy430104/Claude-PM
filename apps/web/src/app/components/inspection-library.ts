import { Component, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { Api, errorMessage } from '../core/api';
import { Brand } from '../core/brand';
import { InspectionTemplate } from '../core/models';

/** 企业检验项库：工作包里可直接选用的常用检验 / 验证项 */
@Component({
  selector: 'app-inspection-library',
  imports: [MatButtonModule],
  styles: `
    tr.off td { color: var(--pm-muted); }
    td input.cell, td select.cell { width: 100%; box-sizing: border-box; border: 1px solid transparent; background: transparent; font: inherit; padding: 4px 6px; border-radius: 6px; }
    td input.cell:hover, td input.cell:focus, td select.cell:hover { border-color: var(--pm-line); background: #fff; }
  `,
  template: `
    <p class="muted">工作包详情的“质量”页可以从这里一键加入检验项。类别在“企业设置 → 检验 / 验证项类别”维护。</p>
    @if (error()) { <div class="error" role="alert">{{ error() }}</div> }
    <section class="pcard">
      <header><h3>新增</h3></header>
      <div class="body">
        <div class="fgrid">
          <label class="fld">名称<input #n aria-label="检验项名称" /></label>
          <label class="fld">类别<select #c>@for (x of brand.inspectionCategories(); track x) { <option>{{ x }}</option> }</select></label>
          <label class="fld">要求 / 准则<input #r /></label>
          <label class="fld">方法<input #m /></label>
          <label class="fld">记录<input #rec /></label>
        </div>
        <button mat-flat-button type="button" (click)="create(n.value, c.value, r.value, m.value, rec.value); n.value = ''">添加到库</button>
      </div>
    </section>
    <section class="pcard">
      <header><h3>检验项库</h3><span class="sub">{{ items().length }} 项；直接在表格里修改</span></header>
      <div class="tblwrap"><table>
        <thead><tr><th>检验 / 验证项</th><th>类别</th><th>要求 / 准则</th><th>方法</th><th>记录</th><th>状态</th></tr></thead>
        <tbody>
          @for (t of items(); track t.id) {
            <tr [class.off]="!t.active">
              <td><input class="cell" [value]="t.name" (change)="update(t, { name: $any($event.target).value })" [attr.aria-label]="'名称 ' + t.name" /></td>
              <td><select class="cell" (change)="update(t, { category: $any($event.target).value })">@for (x of cats(t.category); track x) { <option [selected]="x === t.category">{{ x }}</option> }</select></td>
              <td><input class="cell" [value]="t.requirement" (change)="update(t, { requirement: $any($event.target).value })" /></td>
              <td><input class="cell" [value]="t.method" (change)="update(t, { method: $any($event.target).value })" /></td>
              <td><input class="cell" [value]="t.record" (change)="update(t, { record: $any($event.target).value })" /></td>
              <td><button mat-button type="button" (click)="update(t, { active: !t.active })">{{ t.active ? '停用' : '启用' }}</button></td>
            </tr>
          }
        </tbody>
      </table></div>
    </section>
  `,
})
export class InspectionLibrary {
  private readonly api = inject(Api);
  readonly brand = inject(Brand);
  readonly items = signal<InspectionTemplate[]>([]);
  readonly error = signal('');

  ngOnInit() { void this.load(); void this.brand.load(); }
  async load() {
    try { this.items.set(await this.api.get<InspectionTemplate[]>('/inspection-templates')); } catch (e) { this.error.set(errorMessage(e, '加载失败')); }
  }
  cats(cur: string) { const c = this.brand.inspectionCategories(); return c.includes(cur) ? c : [...c, cur]; }
  async create(name: string, category: string, requirement: string, method: string, record: string) {
    if (!name.trim()) { this.error.set('请填写名称'); return; }
    this.error.set('');
    try { await this.api.post('/inspection-templates', { name: name.trim(), category, requirement, method, record }); await this.load(); } catch (e) { this.error.set(errorMessage(e, '添加失败')); }
  }
  async update(t: InspectionTemplate, patch: Partial<InspectionTemplate>) {
    if (patch.name !== undefined && !patch.name.trim()) { await this.load(); return; }
    this.error.set('');
    try { await this.api.patch(`/inspection-templates/${t.id}`, patch); await this.load(); } catch (e) { this.error.set(errorMessage(e, '保存失败')); await this.load(); }
  }
}
