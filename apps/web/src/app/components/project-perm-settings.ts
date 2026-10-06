import { Component, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { Api, errorMessage } from '../core/api';
import { askConfirm } from '../core/dialog';

interface PermView { config: { grants: Record<string, string[]> }; roles: { id: string; name: string }[]; rows: { key: string; label: string }[] }

/** 企业设置 → 项目权限：各项内容除项目经理外哪些角色可以编辑（前提是该项目成员） */
@Component({
  selector: 'app-project-perm-settings',
  imports: [MatButtonModule],
  styles: `
    th.c, td.c { text-align: center; white-space: nowrap; }
    td.c input { width: 16px; height: 16px; cursor: pointer; }
    td.fixed { color: var(--pm-muted); }
    th.lab, tbody td:first-child { min-width: 230px; }
    th.grp { font-size: 12px; border-bottom: 1px solid var(--pm-line); }
    .ok { color: var(--pm-green); font-size: 13px; }
    .note { font-size: 12.5px; color: var(--pm-muted); margin: 8px 0 0; line-height: 1.6; }
  `,
  template: `
    <section class="pcard" data-perm>
      <header><h3>项目权限</h3><span class="sub">项目里各项内容，除项目经理外哪些人可以编辑；前提是该项目的成员。职能角色在「用户与角色」里给每个人设置</span></header>
      @if (error()) { <div class="error" role="alert" style="margin: 12px 20px 0">{{ error() }}</div> }
      @if (v(); as x) {
        <div class="tblwrap"><table>
          <thead>
            <tr><th rowspan="2" class="lab">内容</th><th colspan="2" class="c grp">项目角色</th>@if (x.roles.length) { <th [attr.colspan]="x.roles.length" class="c grp">职能角色（项目成员）</th> }</tr>
            <tr><th class="c">项目经理</th><th class="c">项目质量经理</th>@for (r of x.roles; track r.id) { <th class="c">{{ r.name }}</th> }</tr>
          </thead>
          <tbody>
            @for (row of x.rows; track row.key) {
              <tr [attr.data-row]="row.key">
                <td>{{ row.label }}</td>
                <td class="c fixed">✓</td>
                <td class="c"><input type="checkbox" [checked]="has(row.key, 'PQM')" (change)="toggle(row.key, 'PQM', $any($event.target).checked)" [attr.aria-label]="row.label + ' 项目质量经理'" /></td>
                @for (r of x.roles; track r.id) {
                  <td class="c"><input type="checkbox" [checked]="has(row.key, r.id)" (change)="toggle(row.key, r.id, $any($event.target).checked)" [attr.aria-label]="row.label + ' ' + r.name" /></td>
                }
              </tr>
            }
          </tbody>
        </table></div>
        <div class="body">
          <div style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap">
            <button mat-flat-button type="button" [disabled]="!dirty()" (click)="save()">保存项目权限</button>
            <button mat-button type="button" (click)="reset()">恢复默认</button>
            @if (saved()) { <span class="ok">已保存</span> }
          </div>
          <p class="note">固定不变（ISO 22163 职责分离）：立项审批和计划批准由「用户与角色」里的审批角色负责；变更审批由变更控制委员会（CCB）成员负责；关口评审结论、项目关闭、项目成员调整由项目经理负责。工作包进度由负责人本人或项目经理更新。所有项目成员都能查看全部内容，登记问题、风险、不符合项和变更申请。权限修改记入审计日志。</p>
        </div>
      }
    </section>
  `,
})
export class ProjectPermSettings {
  private readonly api = inject(Api);
  readonly v = signal<PermView | null>(null);
  readonly error = signal('');
  readonly dirty = signal(false);
  readonly saved = signal(false);

  async ngOnInit() {
    try { this.v.set(await this.api.get<PermView>('/project-permissions')); } catch (e) { this.error.set(errorMessage(e, '加载失败')); }
  }
  has(key: string, col: string) { return this.v()!.config.grants[key]?.includes(col) ?? false; }
  toggle(key: string, col: string, on: boolean) {
    this.v.update((x) => {
      if (!x) return x;
      const cur = x.config.grants[key] ?? [];
      const next = on ? [...new Set([...cur, col])] : cur.filter((c) => c !== col);
      return { ...x, config: { grants: { ...x.config.grants, [key]: next } } };
    });
    this.dirty.set(true); this.saved.set(false);
  }
  async save() {
    this.error.set('');
    try {
      this.v.set(await this.api.put<PermView>('/project-permissions', { grants: this.v()!.config.grants }));
      this.dirty.set(false); this.saved.set(true);
    } catch (e) { this.error.set(errorMessage(e, '保存失败')); }
  }
  async reset() {
    if (!(await askConfirm('恢复为默认的项目权限？按职能角色名称（采购、设计、制造、质量等）重新生成。'))) return;
    this.error.set('');
    try {
      this.v.set(await this.api.put<PermView>('/project-permissions', { reset: true }));
      this.dirty.set(false); this.saved.set(true);
    } catch (e) { this.error.set(errorMessage(e, '恢复失败')); }
  }
}
