import { Component, inject, input, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { Api, errorMessage } from '../core/api';
import { APPROVAL_ROLE_DEFAULTS, APPROVAL_ROLE_LABELS, ApprovalAssignment, ApprovalRoleKind, UserRow } from '../core/models';

interface Entry { userId: string; basis: string; validFrom: string; validTo: string }
const KINDS: ApprovalRoleKind[] = ['INITIATOR', 'COSIGNER', 'APPROVER', 'PLAN_APPROVER'];

/** 立项与审批角色：按人指定立项申请人、会签人、立项批准人、计划批准人，附授权依据和有效期 */
@Component({
  selector: 'app-approval-roles',
  imports: [MatButtonModule],
  styles: `
    .ok { color: var(--pm-green); margin-left: 8px; font-size: 13px; }
  `,
  template: `
    <p class="muted">某类没有指定人员时按系统角色默认；指定后只有列出的人（在有效期内）有这项权限。申请人不能批准自己的申请。</p>
    @if (error()) { <div class="error" role="alert">{{ error() }}</div> }
    @for (k of kinds; track k) {
      <section class="pcard" [attr.data-kind]="k">
        <header><h3>{{ label(k) }}</h3><span class="sub">{{ entries()[k].length ? '已指定 ' + entries()[k].length + ' 人' : hint(k) }}</span></header>
        <div class="body">
          <div class="listed">
            @for (e of entries()[k]; track $index; let i = $index) {
              <div class="line">
                <label class="fld">人员
                  <select [value]="e.userId" [disabled]="!canEdit()" (change)="patch(k, i, 'userId', $event)">
                    <option value="">请选择</option>
                    @for (u of users(); track u.id) { <option [value]="u.id" [selected]="u.id === e.userId">{{ u.name }}</option> }
                  </select></label>
                <label class="fld">授权依据 <input [value]="e.basis" [disabled]="!canEdit()" placeholder="如：授权书 2026-01 号" (change)="patch(k, i, 'basis', $event)" /></label>
                <label class="fld" style="max-width: 160px">生效日 <input type="date" [value]="e.validFrom" [disabled]="!canEdit()" (change)="patch(k, i, 'validFrom', $event)" /></label>
                <label class="fld" style="max-width: 160px">失效日 <input type="date" [value]="e.validTo" [disabled]="!canEdit()" (change)="patch(k, i, 'validTo', $event)" /></label>
                @if (canEdit()) { <button type="button" class="x" (click)="remove(k, i)" aria-label="移除">×</button> }
              </div>
            }
          </div>
          @if (canEdit()) {
            <button type="button" class="addlink" (click)="add(k)">+ 添加人员</button>
            <div style="margin-top: 10px">
              <button mat-flat-button type="button" (click)="save(k)">保存{{ label(k) }}</button>
              @if (saved() === k) { <span class="ok">已保存</span> }
            </div>
          }
        </div>
      </section>
    }
  `,
})
export class ApprovalRoles {
  private readonly api = inject(Api);
  readonly users = input.required<UserRow[]>();
  readonly canEdit = input(false);
  readonly kinds = KINDS;
  readonly entries = signal<Record<ApprovalRoleKind, Entry[]>>({ INITIATOR: [], COSIGNER: [], APPROVER: [], PLAN_APPROVER: [] });
  readonly error = signal('');
  readonly saved = signal<ApprovalRoleKind | null>(null);

  ngOnInit() { void this.load(); }

  async load() {
    try {
      const rows = await this.api.get<ApprovalAssignment[]>('/approval-roles');
      const out: Record<ApprovalRoleKind, Entry[]> = { INITIATOR: [], COSIGNER: [], APPROVER: [], PLAN_APPROVER: [] };
      for (const r of rows) out[r.kind].push({ userId: r.userId, basis: r.basis, validFrom: r.validFrom?.slice(0, 10) ?? '', validTo: r.validTo?.slice(0, 10) ?? '' });
      this.entries.set(out);
    } catch (e) { this.error.set(errorMessage(e, '加载失败')); }
  }

  label(k: ApprovalRoleKind) { return APPROVAL_ROLE_LABELS[k]; }
  hint(k: ApprovalRoleKind) { return APPROVAL_ROLE_DEFAULTS[k]; }
  private edit(k: ApprovalRoleKind, fn: (list: Entry[]) => Entry[]) {
    this.saved.set(null);
    this.entries.update((m) => ({ ...m, [k]: fn([...m[k]]) }));
  }
  add(k: ApprovalRoleKind) { this.edit(k, (l) => [...l, { userId: '', basis: '', validFrom: '', validTo: '' }]); }
  remove(k: ApprovalRoleKind, i: number) { this.edit(k, (l) => l.filter((_, j) => j !== i)); }
  patch(k: ApprovalRoleKind, i: number, key: keyof Entry, e: Event) {
    const v = (e.target as HTMLInputElement).value;
    this.edit(k, (l) => l.map((x, j) => (j === i ? { ...x, [key]: key === 'basis' ? v.trim() : v } : x)));
  }

  async save(k: ApprovalRoleKind) {
    this.error.set('');
    const list = this.entries()[k].filter((e) => e.userId);
    try {
      await this.api.put(`/approval-roles/${k}`, {
        entries: list.map((e) => ({ userId: e.userId, basis: e.basis || undefined, validFrom: e.validFrom || null, validTo: e.validTo || null })),
      });
      await this.load();
      this.saved.set(k);
    } catch (e) { this.error.set(errorMessage(e, '保存失败')); }
  }
}
