import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatTableModule } from '@angular/material/table';
import { firstValueFrom } from 'rxjs';
import { API } from '../core/auth.service';
import { TenantRow } from '../core/models';

@Component({
  selector: 'app-tenants',
  imports: [ReactiveFormsModule, MatButtonModule, MatFormFieldModule, MatInputModule, MatSlideToggleModule, MatTableModule],
  template: `
    <div class="page">
      <h1>租户管理</h1>
      <form class="row" [formGroup]="form" (ngSubmit)="create()">
        <mat-form-field><mat-label>企业名称</mat-label><input matInput formControlName="name" /></mat-form-field>
        <mat-form-field><mat-label>企业标识</mat-label><input matInput formControlName="slug" /></mat-form-field>
        <mat-form-field><mat-label>管理员姓名</mat-label><input matInput formControlName="adminName" /></mat-form-field>
        <mat-form-field><mat-label>管理员邮箱</mat-label><input matInput type="email" formControlName="adminEmail" /></mat-form-field>
        <mat-form-field><mat-label>初始密码</mat-label><input matInput type="password" formControlName="adminPassword" autocomplete="new-password" /></mat-form-field>
        <button mat-flat-button type="submit" [disabled]="form.invalid || busy()">创建租户</button>
      </form>
      @if (error()) { <div class="error" role="alert">{{ error() }}</div> }
      <table mat-table [dataSource]="tenants()">
        <ng-container matColumnDef="name"><th mat-header-cell *matHeaderCellDef>企业</th><td mat-cell *matCellDef="let t">{{ t.name }}</td></ng-container>
        <ng-container matColumnDef="slug"><th mat-header-cell *matHeaderCellDef>标识</th><td mat-cell *matCellDef="let t">{{ t.slug }}</td></ng-container>
        <ng-container matColumnDef="active">
          <th mat-header-cell *matHeaderCellDef>启用</th>
          <td mat-cell *matCellDef="let t"><mat-slide-toggle [checked]="t.active" (change)="setActive(t, $event.checked)" aria-label="启用" /></td>
        </ng-container>
        <tr mat-header-row *matHeaderRowDef="cols"></tr>
        <tr mat-row *matRowDef="let row; columns: cols"></tr>
      </table>
    </div>
  `,
})
export class TenantsPage {
  private readonly http = inject(HttpClient);
  private readonly fb = inject(FormBuilder).nonNullable;
  readonly cols = ['name', 'slug', 'active'];
  readonly tenants = signal<TenantRow[]>([]);
  readonly error = signal('');
  readonly busy = signal(false);
  readonly form = this.fb.group({
    name: ['', [Validators.required, Validators.minLength(2)]],
    slug: ['', [Validators.required, Validators.pattern(/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/)]],
    adminName: ['', Validators.required],
    adminEmail: ['', [Validators.required, Validators.email]],
    adminPassword: ['', [Validators.required, Validators.minLength(8)]],
  });

  constructor() {
    void this.load();
  }

  async load() {
    this.tenants.set(await firstValueFrom(this.http.get<TenantRow[]>(`${API}/platform/tenants`)));
  }

  async create() {
    if (this.form.invalid) return;
    this.busy.set(true);
    this.error.set('');
    try {
      await firstValueFrom(this.http.post(`${API}/platform/tenants`, this.form.getRawValue()));
      this.form.reset();
      await this.load();
    } catch (e) {
      this.error.set(e instanceof HttpErrorResponse && e.status === 409 ? '企业标识已存在' : '创建失败');
    } finally {
      this.busy.set(false);
    }
  }

  async setActive(t: TenantRow, active: boolean) {
    await firstValueFrom(this.http.patch(`${API}/platform/tenants/${t.id}`, { active }));
    await this.load();
  }
}
