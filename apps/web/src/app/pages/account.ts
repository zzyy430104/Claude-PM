import { Component, inject, signal } from '@angular/core';
import { AbstractControl, FormBuilder, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { errorMessage } from '../core/api';
import { AuthService } from '../core/auth.service';

const sameAsNew = (c: AbstractControl): ValidationErrors | null =>
  c.get('newPassword')?.value === c.get('confirm')?.value ? null : { mismatch: true };

@Component({
  selector: 'app-account',
  imports: [ReactiveFormsModule, MatButtonModule, MatFormFieldModule, MatInputModule],
  styles: `
    form { max-width: 420px; display: flex; flex-direction: column; gap: 4px; }
    .notice { max-width: 420px; background: var(--pm-amber-bg); color: #7a5206; border-radius: 8px; padding: 10px 14px; margin: 0 0 16px; }
    .ok { max-width: 420px; background: var(--pm-green-bg); color: var(--pm-green); border-radius: 8px; padding: 10px 14px; margin: 0 0 16px; }
    dl { display: grid; grid-template-columns: 90px 1fr; gap: 6px 12px; margin: 0 0 20px; } dt { color: var(--pm-muted); } dd { margin: 0; }
  `,
  template: `
    <div class="page">
      <h1>个人设置</h1>
      <dl class="panel" style="max-width: 420px">
        <dt>姓名</dt><dd>{{ auth.user()?.name }}</dd>
        <dt>邮箱</dt><dd>{{ auth.user()?.email }}</dd>
      </dl>
      <h2>修改密码</h2>
      @if (auth.user()?.mustChangePassword) {
        <div class="notice" role="status">你的密码是管理员设置的，请先修改为只有你自己知道的密码，然后才能继续使用系统。</div>
      }
      @if (done()) { <div class="ok" role="status">密码已修改。其他设备上的登录已失效。</div> }
      <form [formGroup]="form" (ngSubmit)="submit()">
        <mat-form-field><mat-label>当前密码</mat-label><input matInput type="password" formControlName="currentPassword" autocomplete="current-password" /></mat-form-field>
        <mat-form-field><mat-label>新密码（至少 8 位）</mat-label><input matInput type="password" formControlName="newPassword" autocomplete="new-password" /></mat-form-field>
        <mat-form-field><mat-label>再次输入新密码</mat-label><input matInput type="password" formControlName="confirm" autocomplete="new-password" /></mat-form-field>
        @if (form.hasError('mismatch') && form.controls.confirm.dirty) { <div class="error" role="alert">两次输入的新密码不一致</div> }
        @if (error()) { <div class="error" role="alert">{{ error() }}</div> }
        <button mat-flat-button type="submit" [disabled]="form.invalid || busy()">修改密码</button>
      </form>
    </div>
  `,
})
export class AccountPage {
  readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly fb = inject(FormBuilder).nonNullable;
  readonly busy = signal(false);
  readonly error = signal('');
  readonly done = signal(false);
  readonly form = this.fb.group(
    {
      currentPassword: ['', Validators.required],
      newPassword: ['', [Validators.required, Validators.minLength(8), Validators.maxLength(128)]],
      confirm: ['', Validators.required],
    },
    { validators: sameAsNew },
  );

  async submit() {
    if (this.form.invalid) return;
    const forced = !!this.auth.user()?.mustChangePassword;
    this.busy.set(true);
    this.error.set('');
    this.done.set(false);
    const { currentPassword, newPassword } = this.form.getRawValue();
    try {
      await this.auth.changePassword(currentPassword, newPassword);
      this.form.reset();
      this.done.set(true);
      if (forced) await this.router.navigateByUrl('/');
    } catch (e) {
      this.error.set(errorMessage(e, '修改失败'));
    } finally {
      this.busy.set(false);
    }
  }
}
