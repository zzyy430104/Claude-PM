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
  selector: 'app-login',
  imports: [ReactiveFormsModule, RouterLink, MatButtonModule, MatCardModule, MatFormFieldModule, MatInputModule],
  styles: `
    .wrap { min-height: 100%; display: grid; place-items: center; padding: 16px; }
    mat-card { width: 100%; max-width: 400px; padding: 16px; }
    form { display: flex; flex-direction: column; gap: 4px; }
  `,
  template: `
    <div class="wrap">
      <mat-card>
        <mat-card-header><mat-card-title>登录 Claude-PM</mat-card-title></mat-card-header>
        <mat-card-content>
          <form [formGroup]="form" (ngSubmit)="submit()">
            <mat-form-field>
              <mat-label>企业标识</mat-label>
              <input matInput formControlName="tenantSlug" autocomplete="organization" />
              <mat-hint>平台管理员留空</mat-hint>
            </mat-form-field>
            <mat-form-field>
              <mat-label>邮箱</mat-label>
              <input matInput type="email" formControlName="email" autocomplete="username" />
            </mat-form-field>
            <mat-form-field>
              <mat-label>密码</mat-label>
              <input matInput type="password" formControlName="password" autocomplete="current-password" />
            </mat-form-field>
            @if (error()) { <div class="error" role="alert">{{ error() }}</div> }
            <button mat-flat-button type="submit" [disabled]="form.invalid || busy()">登录</button>
            <a mat-button routerLink="/signup">注册新企业</a>
          </form>
        </mat-card-content>
      </mat-card>
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
