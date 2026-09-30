import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { Api, errorMessage } from '../core/api';

/** 企业设置：挣值预警阈值 */
@Component({
  selector: 'app-settings',
  imports: [ReactiveFormsModule, MatButtonModule, MatFormFieldModule, MatInputModule],
  template: `
    <div class="page">
      <h1>企业设置</h1>
      <h2>挣值预警阈值</h2>
      <p class="muted" style="max-width: 640px">
        进度绩效指数（SPI）和成本绩效指数（CPI）等于 1 表示与计划一致。指数低于“关注”线时，项目的进度或成本显示为黄色；低于“告警”线时显示为红色。
      </p>
      <form class="row" [formGroup]="form" (ngSubmit)="save()">
        <mat-form-field><mat-label>关注（黄）线</mat-label><input matInput type="number" step="0.01" formControlName="evmAmber" /></mat-form-field>
        <mat-form-field><mat-label>告警（红）线</mat-label><input matInput type="number" step="0.01" formControlName="evmRed" /></mat-form-field>
        <button mat-flat-button type="submit" [disabled]="form.invalid">保存</button>
        @if (saved()) { <span>已保存</span> }
      </form>
      @if (error()) { <div class="error" role="alert">{{ error() }}</div> }
    </div>
  `,
})
export class SettingsPage {
  private readonly api = inject(Api);
  private readonly fb = inject(FormBuilder).nonNullable;
  readonly error = signal('');
  readonly saved = signal(false);
  readonly form = this.fb.group({
    evmAmber: [0.95, [Validators.required, Validators.min(0.5), Validators.max(1)]],
    evmRed: [0.9, [Validators.required, Validators.min(0.5), Validators.max(1)]],
  });

  async ngOnInit() {
    this.form.patchValue(await this.api.get<{ evmAmber: number; evmRed: number }>('/tenant-settings'));
  }

  async save() {
    this.error.set('');
    this.saved.set(false);
    const v = this.form.getRawValue();
    if (v.evmRed >= v.evmAmber) { this.error.set('告警线必须低于关注线'); return; }
    try {
      this.form.patchValue(await this.api.patch<{ evmAmber: number; evmRed: number }>('/tenant-settings', v));
      this.saved.set(true);
    } catch (e) {
      this.error.set(errorMessage(e, '保存失败'));
    }
  }
}
