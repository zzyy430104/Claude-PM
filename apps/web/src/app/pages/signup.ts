import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { Router, RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { AuthService } from '../core/auth.service';

@Component({
  selector: 'app-signup',
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
            <h1>注册新企业</h1>
            <p class="sub">创建企业并成为它的管理员</p>
            <mat-form-field appearance="outline">
              <mat-label>企业名称</mat-label>
              <input matInput formControlName="tenantName" />
            </mat-form-field>
            <mat-form-field appearance="outline">
              <mat-label>企业标识</mat-label>
              <input matInput formControlName="tenantSlug" />
              <mat-hint>3–40 位小写字母、数字或连字符，登录时使用</mat-hint>
              @if (form.controls.tenantSlug.invalid && form.controls.tenantSlug.touched) {
                <mat-error>格式不正确</mat-error>
              }
            </mat-form-field>
            <mat-form-field appearance="outline">
              <mat-label>管理员姓名</mat-label>
              <input matInput formControlName="adminName" />
            </mat-form-field>
            <mat-form-field appearance="outline">
              <mat-label>管理员邮箱</mat-label>
              <input matInput type="email" formControlName="adminEmail" autocomplete="username" />
            </mat-form-field>
            <mat-form-field appearance="outline">
              <mat-label>密码（至少 8 位）</mat-label>
              <input matInput type="password" formControlName="password" autocomplete="new-password" />
            </mat-form-field>
            @if (error()) { <div class="error" role="alert">{{ error() }}</div> }
            <button mat-flat-button type="submit" [disabled]="form.invalid || busy()">创建企业并登录</button>
            <a mat-button routerLink="/login">已有账号，去登录</a>
          </form>
      </section>
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
