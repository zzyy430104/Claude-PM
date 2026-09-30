import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { Router, RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { AuthService } from '../core/auth.service';

@Component({
  selector: 'app-signup',
  imports: [ReactiveFormsModule, RouterLink, MatButtonModule, MatCardModule, MatFormFieldModule, MatInputModule],
  styles: `
    .wrap { min-height: 100%; display: grid; place-items: center; padding: 16px; }
    mat-card { width: 100%; max-width: 440px; padding: 16px; }
    form { display: flex; flex-direction: column; gap: 4px; }
  `,
  template: `
    <div class="wrap">
      <mat-card>
        <mat-card-header><mat-card-title>注册新企业</mat-card-title></mat-card-header>
        <mat-card-content>
          <form [formGroup]="form" (ngSubmit)="submit()">
            <mat-form-field>
              <mat-label>企业名称</mat-label>
              <input matInput formControlName="tenantName" />
            </mat-form-field>
            <mat-form-field>
              <mat-label>企业标识</mat-label>
              <input matInput formControlName="tenantSlug" />
              <mat-hint>3–40 位小写字母、数字或连字符，登录时使用</mat-hint>
              @if (form.controls.tenantSlug.invalid && form.controls.tenantSlug.touched) {
                <mat-error>格式不正确</mat-error>
              }
            </mat-form-field>
            <mat-form-field>
              <mat-label>管理员姓名</mat-label>
              <input matInput formControlName="adminName" />
            </mat-form-field>
            <mat-form-field>
              <mat-label>管理员邮箱</mat-label>
              <input matInput type="email" formControlName="adminEmail" autocomplete="username" />
            </mat-form-field>
            <mat-form-field>
              <mat-label>密码（至少 8 位）</mat-label>
              <input matInput type="password" formControlName="password" autocomplete="new-password" />
            </mat-form-field>
            @if (error()) { <div class="error" role="alert">{{ error() }}</div> }
            <button mat-flat-button type="submit" [disabled]="form.invalid || busy()">创建企业并登录</button>
            <a mat-button routerLink="/login">已有账号，去登录</a>
          </form>
        </mat-card-content>
      </mat-card>
    </div>
  `,
})
export class SignupPage {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly fb = inject(FormBuilder).nonNullable;

  readonly busy = signal(false);
  readonly error = signal('');
  readonly form = this.fb.group({
    tenantName: ['', [Validators.required, Validators.minLength(2)]],
    tenantSlug: ['', [Validators.required, Validators.pattern(/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/)]],
    adminName: ['', Validators.required],
    adminEmail: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(8)]],
  });

  async submit() {
    if (this.form.invalid) return;
    this.busy.set(true);
    this.error.set('');
    const v = this.form.getRawValue();
    try {
      await this.auth.signup(v);
      await this.auth.login({ tenantSlug: v.tenantSlug, email: v.adminEmail, password: v.password });
      await this.router.navigateByUrl('/');
    } catch (e) {
      const status = e instanceof HttpErrorResponse ? e.status : 0;
      this.error.set(
        status === 409 ? '企业标识已被占用'
        : status === 403 ? '当前部署未开放自助注册，请联系平台管理员'
        : '注册失败，请检查输入后重试',
      );
    } finally {
      this.busy.set(false);
    }
  }
}
