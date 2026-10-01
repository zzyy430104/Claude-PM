import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import { FormBuilder, FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatTableModule } from '@angular/material/table';
import { firstValueFrom } from 'rxjs';
import { ApprovalRoles } from '../components/approval-roles';
import { API, AuthService } from '../core/auth.service';
import { Department, FunctionalRole, ROLE_LABELS, Role, TENANT_ROLES, UserRow } from '../core/models';

@Component({
  selector: 'app-users',
  imports: [ApprovalRoles, ReactiveFormsModule, MatButtonModule, MatFormFieldModule, MatInputModule, MatSelectModule, MatSlideToggleModule, MatTableModule],
  styles: `
    .reset { display: inline-flex; gap: 8px; align-items: center; }
    .reset input, .rname { height: 32px; border: 1px solid var(--pm-line); border-radius: 8px; padding: 0 10px; font: inherit; width: 200px; background: var(--pm-card); }
    .rname.off { color: var(--pm-muted); text-decoration: line-through; }
    .roles td { vertical-align: middle !important; }
  `,
  template: `
    <div class="page">
      <h1>用户与角色</h1>
      <nav class="stabs" role="tablist" aria-label="用户与角色">
        <button type="button" role="tab" [attr.aria-selected]="view() === 'users'" (click)="view.set('users')">用户</button>
        <button type="button" role="tab" [attr.aria-selected]="view() === 'roles'" (click)="view.set('roles')">职能角色</button>
        <button type="button" role="tab" [attr.aria-selected]="view() === 'approval'" (click)="view.set('approval')">立项与审批角色</button>
      </nav>
      @if (view() === 'approval') {
        <app-approval-roles [users]="activeUsers()" [canEdit]="canEdit()" />
      } @else if (view() === 'roles') {
        <p class="muted">职能角色用于模板和计划里按角色指定责任人。模板和项目引用的是角色本身，改名后各处同步显示新名称。停用的角色不能再分配给用户。</p>
        @if (canEdit()) {
          <form class="row" (submit)="$event.preventDefault(); addRole()">
            <mat-form-field><mat-label>新角色名称</mat-label><input matInput [formControl]="newRole" maxlength="30" /></mat-form-field>
            <button mat-flat-button type="submit" [disabled]="newRole.invalid">新增角色</button>
          </form>
        }
        @if (error()) { <div class="error" role="alert">{{ error() }}</div> }
        <table class="roles">
          <thead><tr><th>角色名称</th><th>用户数</th><th>状态</th></tr></thead>
          <tbody>
            @for (r of fRoles(); track r.id) {
              <tr>
                <td>
                  @if (canEdit()) {
                    <input class="rname" [class.off]="!r.active" [value]="r.name" maxlength="30" [attr.aria-label]="'角色名称 ' + r.name" (change)="renameRole(r, $any($event.target).value)" />
                  } @else { {{ r.name }} }
                </td>
                <td>{{ countOf(r.id) }}</td>
                <td><mat-slide-toggle [checked]="r.active" [disabled]="!canEdit()" (change)="patchRole(r, { active: $event.checked })" [attr.aria-label]="'启用 ' + r.name">{{ r.active ? '启用' : '停用' }}</mat-slide-toggle></td>
              </tr>
            }
          </tbody>
        </table>
      } @else {

      @if (canEdit()) {
        <form class="row" [formGroup]="form" (ngSubmit)="create()">
          <mat-form-field><mat-label>姓名</mat-label><input matInput formControlName="name" /></mat-form-field>
          <mat-form-field><mat-label>邮箱</mat-label><input matInput type="email" formControlName="email" /></mat-form-field>
          <mat-form-field><mat-label>初始密码</mat-label><input matInput type="password" formControlName="password" autocomplete="new-password" /></mat-form-field>
          <mat-form-field>
            <mat-label>角色</mat-label>
            <mat-select formControlName="role">
              @for (r of roles; track r) { <mat-option [value]="r">{{ label(r) }}</mat-option> }
            </mat-select>
          </mat-form-field>
          <mat-form-field>
            <mat-label>职能角色</mat-label>
            <mat-select formControlName="functionalRoleId">
              <mat-option value="">不指定</mat-option>
              @for (r of activeRoles(); track r.id) { <mat-option [value]="r.id">{{ r.name }}</mat-option> }
            </mat-select>
          </mat-form-field>
          <mat-form-field>
            <mat-label>部门</mat-label>
            <mat-select formControlName="departmentId">
              <mat-option value="">不指定</mat-option>
              @for (d of activeDepts(); track d.id) { <mat-option [value]="d.id">{{ d.name }}</mat-option> }
            </mat-select>
          </mat-form-field>
          <button mat-flat-button type="submit" [disabled]="form.invalid || busy()">添加用户</button>
        </form>
      }
      @if (error()) { <div class="error" role="alert">{{ error() }}</div> }
      @if (notice()) { <div class="panel" role="status" style="margin-bottom: 12px">{{ notice() }}</div> }
      <p class="muted">新建用户或重置密码后，本人首次登录必须修改密码。</p>

      <table mat-table [dataSource]="users()">
        <ng-container matColumnDef="name"><th mat-header-cell *matHeaderCellDef>姓名</th><td mat-cell *matCellDef="let u">{{ u.name }}</td></ng-container>
        <ng-container matColumnDef="email"><th mat-header-cell *matHeaderCellDef>邮箱</th><td mat-cell *matCellDef="let u">{{ u.email }}</td></ng-container>
        <ng-container matColumnDef="role">
          <th mat-header-cell *matHeaderCellDef>角色</th>
          <td mat-cell *matCellDef="let u">
            @if (canEdit() && u.id !== me()?.id) {
              <mat-select [value]="u.role" (selectionChange)="update(u, { role: $event.value })" aria-label="角色">
                @for (r of roles; track r) { <mat-option [value]="r">{{ label(r) }}</mat-option> }
              </mat-select>
            } @else { {{ label(u.role) }} }
          </td>
        </ng-container>
        <ng-container matColumnDef="frole">
          <th mat-header-cell *matHeaderCellDef>职能角色</th>
          <td mat-cell *matCellDef="let u">
            @if (canEdit()) {
              <mat-select [value]="u.functionalRoleId ?? ''" (selectionChange)="update(u, { functionalRoleId: $event.value || null })" aria-label="职能角色">
                <mat-option value="">不指定</mat-option>
                @for (r of fRoles(); track r.id) { <mat-option [value]="r.id" [disabled]="!r.active">{{ r.name }}</mat-option> }
              </mat-select>
            } @else { {{ roleName(u.functionalRoleId) }} }
          </td>
        </ng-container>
        <ng-container matColumnDef="dept">
          <th mat-header-cell *matHeaderCellDef>部门</th>
          <td mat-cell *matCellDef="let u">
            @if (canEdit()) {
              <mat-select [value]="u.departmentId ?? ''" (selectionChange)="update(u, { departmentId: $event.value || null })" aria-label="部门">
                <mat-option value="">不指定</mat-option>
                @for (d of depts(); track d.id) { <mat-option [value]="d.id" [disabled]="!d.active">{{ d.name }}</mat-option> }
              </mat-select>
            } @else { {{ deptName(u.departmentId) }} }
          </td>
        </ng-container>
        <ng-container matColumnDef="active">
          <th mat-header-cell *matHeaderCellDef>启用</th>
          <td mat-cell *matCellDef="let u">
            <mat-slide-toggle [checked]="u.active" [disabled]="!canEdit() || u.id === me()?.id" (change)="update(u, { active: $event.checked })" aria-label="启用" />
          </td>
        </ng-container>
        <ng-container matColumnDef="actions">
          <th mat-header-cell *matHeaderCellDef></th>
          <td mat-cell *matCellDef="let u">
            @if (canEdit() && u.id !== me()?.id) {
              @if (resetting() === u.id) {
                <span class="reset">
                  <input type="password" [formControl]="resetPw" placeholder="新的临时密码（至少 8 位）" autocomplete="new-password" aria-label="新的临时密码" (keydown.enter)="reset(u)" />
                  <button mat-flat-button type="button" (click)="reset(u)" [disabled]="resetPw.invalid">确认重置</button>
                  <button mat-button type="button" (click)="resetting.set(null)">取消</button>
                </span>
              } @else {
                <button mat-button (click)="startReset(u)">重置密码</button>
              }
            }
            @if (u.mustChangePassword) { <span class="muted">待本人改密</span> }
          </td>
        </ng-container>
        <tr mat-header-row *matHeaderRowDef="cols"></tr>
        <tr mat-row *matRowDef="let row; columns: cols"></tr>
      </table>
      }
    </div>
  `,
})
export class UsersPage {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);
  private readonly fb = inject(FormBuilder).nonNullable;

  readonly cols = ['name', 'email', 'role', 'frole', 'dept', 'active', 'actions'];
  readonly view = signal<'users' | 'roles' | 'approval'>('users');
  readonly activeUsers = computed(() => this.users().filter((u) => u.active));
  readonly fRoles = signal<FunctionalRole[]>([]);
  readonly depts = signal<Department[]>([]);
  readonly activeDepts = computed(() => this.depts().filter((d) => d.active));
  readonly activeRoles = computed(() => this.fRoles().filter((r) => r.active));
  readonly newRole = new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.maxLength(30)] });
  readonly resetting = signal<string | null>(null);
  readonly resetPw = new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.minLength(8)] });
  readonly notice = signal('');
  readonly roles = TENANT_ROLES;
  readonly users = signal<UserRow[]>([]);
  readonly error = signal('');
  readonly busy = signal(false);
  readonly me = this.auth.user;
  readonly canEdit = computed(() => this.auth.hasRole('TENANT_ADMIN'));
  readonly form = this.fb.group({
    name: ['', Validators.required],
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(8)]],
    role: ['MEMBER' as Role, Validators.required],
    functionalRoleId: [''],
    departmentId: [''],
  });

  constructor() {
    void this.load();
  }

  label(r: Role) {
    return ROLE_LABELS[r];
  }

  async load() {
    const [users, roles, depts] = await Promise.all([
      firstValueFrom(this.http.get<UserRow[]>(`${API}/users`)),
      firstValueFrom(this.http.get<FunctionalRole[]>(`${API}/functional-roles`)),
      firstValueFrom(this.http.get<Department[]>(`${API}/departments`)),
    ]);
    this.users.set(users);
    this.fRoles.set(roles);
    this.depts.set(depts);
  }

  roleName(id: string | null | undefined) {
    return this.fRoles().find((r) => r.id === id)?.name ?? '—';
  }
  deptName(id: string | null | undefined) {
    return this.depts().find((d) => d.id === id)?.name ?? '—';
  }
  countOf(id: string) {
    return this.users().filter((u) => u.functionalRoleId === id).length;
  }
  async addRole() {
    if (this.newRole.invalid) return;
    this.error.set('');
    try {
      await firstValueFrom(this.http.post(`${API}/functional-roles`, { name: this.newRole.value.trim() }));
      this.newRole.reset('');
      await this.load();
    } catch (e) {
      this.error.set(this.message(e, '新增失败', '已有同名角色'));
    }
  }
  async renameRole(r: FunctionalRole, name: string) {
    name = name.trim();
    if (!name || name === r.name) return this.load();
    await this.patchRole(r, { name });
  }
  async patchRole(r: FunctionalRole, patch: Partial<Pick<FunctionalRole, 'name' | 'active'>>) {
    this.error.set('');
    try {
      await firstValueFrom(this.http.patch(`${API}/functional-roles/${r.id}`, patch));
    } catch (e) {
      this.error.set(this.message(e, '保存失败', '已有同名角色'));
    }
    await this.load();
  }

  async create() {
    if (this.form.invalid) return;
    this.busy.set(true);
    this.error.set('');
    try {
      const v = this.form.getRawValue();
      await firstValueFrom(this.http.post(`${API}/users`, { ...v, functionalRoleId: v.functionalRoleId || undefined, departmentId: v.departmentId || undefined }));
      this.form.reset({ name: '', email: '', password: '', role: 'MEMBER', functionalRoleId: '', departmentId: '' });
      await this.load();
    } catch (e) {
      this.error.set(this.message(e, '添加失败'));
    } finally {
      this.busy.set(false);
    }
  }

  async update(u: UserRow, patch: Partial<Pick<UserRow, 'role' | 'active' | 'functionalRoleId' | 'departmentId'>>) {
    this.error.set('');
    try {
      await firstValueFrom(this.http.patch(`${API}/users/${u.id}`, patch));
    } catch (e) {
      this.error.set(this.message(e, '更新失败'));
    }
    await this.load();
  }

  startReset(u: UserRow) {
    this.resetPw.reset('');
    this.notice.set('');
    this.resetting.set(u.id);
  }

  /** 管理员设置临时密码；对方原有登录全部失效，下次登录必须自己改密 */
  async reset(u: UserRow) {
    if (this.resetPw.invalid) return;
    this.error.set('');
    try {
      await firstValueFrom(this.http.patch(`${API}/users/${u.id}`, { password: this.resetPw.value }));
      this.resetting.set(null);
      this.notice.set(`已重置 ${u.name} 的密码。请把临时密码告知本人，对方下次登录后需要修改。`);
      await this.load();
    } catch (e) {
      this.error.set(this.message(e, '重置失败'));
    }
  }

  private message(e: unknown, fallback: string, conflict = '该邮箱已存在') {
    if (e instanceof HttpErrorResponse) {
      if (e.status === 409) return conflict;
      if (e.status === 403) return '没有权限执行此操作';
    }
    return fallback;
  }
}
