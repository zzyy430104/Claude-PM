import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatTableModule } from '@angular/material/table';
import { firstValueFrom } from 'rxjs';
import { API, AuthService } from '../core/auth.service';
import { ROLE_LABELS, Role, TENANT_ROLES, UserRow } from '../core/models';

@Component({
  selector: 'app-users',
  imports: [ReactiveFormsModule, MatButtonModule, MatFormFieldModule, MatInputModule, MatSelectModule, MatSlideToggleModule, MatTableModule],
  template: `
    <div class="page">
      <h1>用户管理</h1>

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
          <button mat-flat-button type="submit" [disabled]="form.invalid || busy()">添加用户</button>
        </form>
      }
      @if (error()) { <div class="error" role="alert">{{ error() }}</div> }

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
        <ng-container matColumnDef="active">
          <th mat-header-cell *matHeaderCellDef>启用</th>
          <td mat-cell *matCellDef="let u">
            <mat-slide-toggle [checked]="u.active" [disabled]="!canEdit() || u.id === me()?.id" (change)="update(u, { active: $event.checked })" aria-label="启用" />
          </td>
        </ng-container>
        <tr mat-header-row *matHeaderRowDef="cols"></tr>
        <tr mat-row *matRowDef="let row; columns: cols"></tr>
      </table>
    </div>
  `,
})
export class UsersPage {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);
  private readonly fb = inject(FormBuilder).nonNullable;

  readonly cols = ['name', 'email', 'role', 'active'];
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
  });

  constructor() {
    void this.load();
  }

  label(r: Role) {
    return ROLE_LABELS[r];
  }

  async load() {
    this.users.set(await firstValueFrom(this.http.get<UserRow[]>(`${API}/users`)));
  }

  async create() {
    if (this.form.invalid) return;
    this.busy.set(true);
    this.error.set('');
    try {
      await firstValueFrom(this.http.post(`${API}/users`, this.form.getRawValue()));
      this.form.reset({ name: '', email: '', password: '', role: 'MEMBER' });
      await this.load();
    } catch (e) {
      this.error.set(this.message(e, '添加失败'));
    } finally {
      this.busy.set(false);
    }
  }

  async update(u: UserRow, patch: Partial<Pick<UserRow, 'role' | 'active'>>) {
    this.error.set('');
    try {
      await firstValueFrom(this.http.patch(`${API}/users/${u.id}`, patch));
    } catch (e) {
      this.error.set(this.message(e, '更新失败'));
    }
    await this.load();
  }

  private message(e: unknown, fallback: string) {
    if (e instanceof HttpErrorResponse) {
      if (e.status === 409) return '该邮箱已存在';
      if (e.status === 403) return '没有权限执行此操作';
    }
    return fallback;
  }
}
