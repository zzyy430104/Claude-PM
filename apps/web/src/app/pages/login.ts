import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { Router, RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { AuthService } from '../core/auth.service';

@Component({
  selector: 'app-login',
  imports: [ReactiveFormsModule, RouterLink, MatButtonModule, MatFormFieldModule, MatInputModule],
  template: `
    <div class="auth">
      <section class="auth-brand">
        <div class="logo"><span class="mark">PM</span>Claude-PM</div>
        <div>
          <h2>轨道交通项目管理与质量协同平台</h2>
          <p>按 ISO 22163:2023 组织项目策划、关口评审、变更控制和不符合项闭环，审核时一键导出证据包。</p>
        </div>
        <small>ISO 22163:2023</small>
      </section>
      <section class="auth-form">
        <form [formGroup]="form" (ngSubmit)="submit()">
          <h1>登录</h1>
          <p class="sub">使用管理员分配的账号登录</p>
          <mat-form-field appearance="outline">
            <mat-label>企业标识</mat-label>
            <input matInput formControlName="tenantSlug" autocomplete="organization" />
            <mat-hint>平台管理员留空</mat-hint>
          </mat-form-field>
          <mat-form-field appearance="outline">
            <mat-label>邮箱</mat-label>
            <input matInput type="email" formControlName="email" autocomplete="username" />
          </mat-form-field>
          <mat-form-field appearance="outline">
            <mat-label>密码</mat-label>
            <input matInput type="password" formControlName="password" autocomplete="current-password" />
          </mat-form-field>
          @if (error()) { <div class="error" role="alert">{{ error() }}</div> }
          <button mat-flat-button type="submit" [disabled]="form.invalid || busy()">登录</button>
          <a mat-button routerLink="/signup">注册新企业</a>
        </form>
      </section>
    </div>
  `,
})
export class LoginPage {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly fb = inject(FormBuilder).nonNullable;

  readonly busy = signal(false);
  readonly error = signal('');
  readonly form = this.fb.group({
    tenantSlug: [''],
    email: ['', [Validators.required, Validators.email]],
    password: ['', Validators.required],
  });

  async submit() {
    if (this.form.invalid) return;
    this.busy.set(true);
    this.error.set('');
    const { tenantSlug, email, password } = this.form.getRawValue();
    try {
      await this.auth.login({ tenantSlug: tenantSlug.trim() || undefined, email, password });
      await this.router.navigateByUrl('/');
    } catch (e) {
      this.error.set(
        e instanceof HttpErrorResponse && e.status === 401
          ? '企业标识、邮箱或密码不正确'
          : '登录失败，请稍后重试',
      );
    } finally {
      this.busy.set(false);
    }
  }
}
