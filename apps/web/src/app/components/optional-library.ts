import { Component, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { Api, errorMessage } from '../core/api';
import { OptionalWorkPackage, ProjectType } from '../core/models';

interface Draft { name: string; durationDays: number; suggestedPhase: string; roleName: string; deliverable: string; types: ProjectType[] }
const blank = (): Draft => ({ name: '', durationDays: 5, suggestedPhase: '', roleName: '', deliverable: '', types: ['A', 'B'] });

/** 可选工作包库：模板里没有、但部分项目需要的工作包；项目经理在「WBS 与进度」里一键加入 */
@Component({
  selector: 'app-optional-library',
  imports: [MatButtonModule],
  styles: `
    .types { display: flex; gap: 2px; align-items: center; font-size: 14px; padding-bottom: 8px; }
    tr.off td { color: var(--pm-muted); }
    td input.cell { width: 100%; box-sizing: border-box; border: 1px solid transparent; background: transparent; font: inherit; padding: 4px 6px; border-radius: 6px; }
    td input.cell:hover, td input.cell:focus { border-color: var(--pm-line); background: #fff; }
    td input.num { width: 70px; }
  `,
  template: `
    <p class="muted">工期为 0 的是里程碑。“职能角色”填角色名称（与「用户与角色 → 职能角色」一致），加入项目后可按角色一次指定责任人。</p>
    @if (error()) { <div class="error" role="alert">{{ error() }}</div> }
    <section class="pcard">
      <header><h3>新增</h3></header>
      <div class="body">
        <div class="fgrid">
          <label class="fld">工作包名称 <span class="req">*</span><input [value]="draft().name" (change)="set('name', $event)" aria-label="工作包名称" /></label>
          <label class="fld">工期（工作日）<input type="number" min="0" [value]="draft().durationDays" (change)="set('durationDays', $event)" /></label>
          <label class="fld">建议位置<input [value]="draft().suggestedPhase" placeholder="如：产品设计开发" (change)="set('suggestedPhase', $event)" /></label>
          <label class="fld">职能角色<input [value]="draft().roleName" placeholder="如：质量工程师" (change)="set('roleName', $event)" /></label>
          <label class="fld">交付物 / 记录<input [value]="draft().deliverable" (change)="set('deliverable', $event)" /></label>
        </div>
        <div class="types">适用：
          @for (t of all; track t) { <label><input type="checkbox" [checked]="draft().types.includes(t)" (change)="toggleDraft(t, $any($event.target).checked)" /> {{ t }} 类</label> }
        </div>
        <button mat-flat-button type="button" (click)="create()" [disabled]="!draft().name">添加到库</button>
      </div>
    </section>
    <section class="pcard">
      <header><h3>可选工作包库</h3><span class="sub">{{ items().length }} 项；直接在表格里修改</span></header>
      <div class="tblwrap">
        <table>
          <thead><tr><th>工作包</th><th>工期</th><th>建议位置</th><th>职能角色</th><th>交付物 / 记录</th><th>适用</th><th>状态</th></tr></thead>
          <tbody>
            @for (l of items(); track l.id) {
              <tr [class.off]="!l.active">
                <td><input class="cell" [value]="l.name" (change)="update(l, { name: val($event) })" [attr.aria-label]="'名称 ' + l.name" /></td>
                <td><input class="cell num" type="number" min="0" [value]="l.durationDays" (change)="update(l, { durationDays: +val($event) })" /></td>
                <td><input class="cell" [value]="l.suggestedPhase" (change)="update(l, { suggestedPhase: val($event) })" /></td>
                <td><input class="cell" [value]="l.roleName" (change)="update(l, { roleName: val($event) })" /></td>
                <td><input class="cell" [value]="l.deliverable" (change)="update(l, { deliverable: val($event) })" /></td>
                <td style="white-space: nowrap">
                  @for (t of all; track t) { <label><input type="checkbox" [checked]="l.types.includes(t)" (change)="toggle(l, t, $any($event.target).checked)" />{{ t }}</label> }
                </td>
                <td><button mat-button type="button" (click)="update(l, { active: !l.active })">{{ l.active ? '停用' : '启用' }}</button></td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    </section>
  `,
})
export class OptionalLibrary {
  private readonly api = inject(Api);
  readonly all: ProjectType[] = ['A', 'B', 'C'];
  readonly items = signal<OptionalWorkPackage[]>([]);
  readonly draft = signal<Draft>(blank());
  readonly error = signal('');

  ngOnInit() { void this.load(); }

  async load() {
    try { this.items.set(await this.api.get<OptionalWorkPackage[]>('/optional-work-packages')); } catch (e) { this.error.set(errorMessage(e, '加载失败')); }
  }
  val(e: Event) { return (e.target as HTMLInputElement).value.trim(); }
  set(key: keyof Draft, e: Event) {
    const v = this.val(e);
    this.draft.update((d) => ({ ...d, [key]: key === 'durationDays' ? Math.max(0, Math.round(+v || 0)) : v }));
  }
  toggleDraft(t: ProjectType, on: boolean) {
    this.draft.update((d) => ({ ...d, types: on ? [...d.types, t].sort() as ProjectType[] : d.types.filter((x) => x !== t) }));
  }
  async create() {
    this.error.set('');
    try {
      await this.api.post('/optional-work-packages', this.draft());
      this.draft.set(blank());
      await this.load();
    } catch (e) { this.error.set(errorMessage(e, '添加失败')); }
  }
  toggle(l: OptionalWorkPackage, t: ProjectType, on: boolean) {
    return this.update(l, { types: on ? ([...l.types, t].sort() as ProjectType[]) : l.types.filter((x) => x !== t) });
  }
  async update(l: OptionalWorkPackage, patch: Partial<OptionalWorkPackage>) {
    if (patch.name === '') { await this.load(); return; }
    this.error.set('');
    try {
      await this.api.patch(`/optional-work-packages/${l.id}`, patch);
      await this.load();
    } catch (e) { this.error.set(errorMessage(e, '保存失败')); await this.load(); }
  }
}
