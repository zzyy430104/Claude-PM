import { Component, computed, input } from '@angular/core';
import { ProjectType, Requirements } from '../core/models';
import { requirementRows } from '../core/requirements';

/** 项目要求表格；给出 before 时并排对比，改动的行标黄 */
@Component({
  selector: 'app-requirements-view',
  styles: `
    .cat { display: inline-block; font-size: 11.5px; font-weight: 700; border-radius: 6px; padding: 1px 7px; background: var(--pm-bg-2); color: var(--pm-muted); }
    .old { color: var(--pm-muted); }
    .gone td { color: var(--pm-muted); text-decoration: line-through; }
  `,
  template: `
    <div class="tblwrap">
      <table>
        <thead><tr><th style="width: 70px">类别</th><th>要求</th>@if (before()) { <th>{{ beforeLabel() }}</th> }<th>{{ before() ? afterLabel() : '内容' }}</th></tr></thead>
        <tbody>
          @for (row of rows(); track row.key) {
            <tr [class.changed]="row.changed" [class.gone]="row.removed">
              <td><span class="cat">{{ row.cat }}</span></td>
              <td>{{ row.label }}</td>
              @if (before()) { <td class="old">{{ row.old ?? '—' }}</td> }
              <td>{{ row.removed ? '（删除）' : row.value }}@if (row.changed && !row.removed) { <span class="changed-tag">{{ row.old === undefined ? '新增' : '已变更' }}</span> }</td>
            </tr>
          }
        </tbody>
      </table>
    </div>
  `,
})
export class RequirementsView {
  readonly value = input.required<Requirements>();
  readonly type = input.required<ProjectType>();
  readonly before = input<Requirements | null>(null);
  readonly beforeType = input<ProjectType | null>(null);
  readonly beforeLabel = input('变更前');
  readonly afterLabel = input('变更后');

  readonly rows = computed(() => {
    const now = requirementRows(this.value(), this.type());
    const b = this.before();
    if (!b) return now.map((r) => ({ ...r, old: undefined as string | undefined, changed: false, removed: false }));
    const prev = requirementRows(b, this.beforeType() ?? this.type());
    const prevMap = new Map(prev.map((r) => [r.key, r.value]));
    const out = now.map((r) => {
      const old = prevMap.get(r.key);
      return { ...r, old, changed: old !== r.value, removed: false };
    });
    const keys = new Set(now.map((r) => r.key));
    for (const r of prev) if (!keys.has(r.key)) out.push({ ...r, old: r.value, changed: true, removed: true });
    return out;
  });
}
