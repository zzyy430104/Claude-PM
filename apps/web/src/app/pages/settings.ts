import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { Api, errorMessage } from '../core/api';
import { Brand } from '../core/brand';
import { CalendarSettings } from '../core/models';
import { CostQualitySettings } from '../components/cost-quality-settings';

const DAYS = [
  { n: 1, label: '周一' }, { n: 2, label: '周二' }, { n: 3, label: '周三' }, { n: 4, label: '周四' },
  { n: 5, label: '周五' }, { n: 6, label: '周六' }, { n: 7, label: '周日' },
];
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** 企业设置：品牌、立项、挣值预警阈值、工作日历 */
@Component({
  selector: 'app-settings',
  imports: [CostQualitySettings, ReactiveFormsModule, MatButtonModule, MatCheckboxModule, MatFormFieldModule, MatInputModule],
  styles: `
    section { max-width: 760px; }
    .week { display: flex; gap: 12px; flex-wrap: wrap; margin: 4px 0 12px; }
    textarea { min-height: 96px; font-family: inherit; }
    .ok { color: var(--pm-green); margin-left: 8px; }
  `,
  template: `
    <div class="page">
      <h1>企业设置</h1>
      <form [formGroup]="form" (ngSubmit)="save()">
        <section>
          <h2>品牌</h2>
          <p class="muted">系统名称显示在顶栏和浏览器标签上；企业名称显示在系统名称旁边。</p>
          <div class="row">
            <mat-form-field><mat-label>系统名称</mat-label><input matInput formControlName="systemName" maxlength="40" /></mat-form-field>
            <mat-form-field style="min-width: 280px"><mat-label>企业名称</mat-label><input matInput formControlName="companyName" maxlength="100" /></mat-form-field>
          </div>
        </section>
        <section>
          <h2>立项</h2>
          <p class="muted">立项申请批准后才生成项目。立项人员（申请人、会签人、批准人、计划批准人）在「用户与角色 → 立项与审批角色」里指定。</p>
          <mat-checkbox formControlName="requireCosign">立项需要会签（会签人全部签完意见才进入批准）</mat-checkbox><br />
          <mat-checkbox formControlName="allowDirectProject">小项目免立项（允许项目经理不经立项直接建项目，由项目经理自己批准计划）</mat-checkbox>
        </section>
        <section>
          <h2>挣值预警阈值</h2>
          <p class="muted">
            进度绩效指数（SPI）和成本绩效指数（CPI）等于 1 表示与计划一致。指数低于“关注”线时，项目的进度或成本显示为黄色；低于“告警”线时显示为红色。
          </p>
          <div class="row">
            <mat-form-field><mat-label>关注（黄）线</mat-label><input matInput type="number" step="0.01" formControlName="evmAmber" /></mat-form-field>
            <mat-form-field><mat-label>告警（红）线</mat-label><input matInput type="number" step="0.01" formControlName="evmRed" /></mat-form-field>
          </div>
        </section>
        <section>
          <h2>工作日历</h2>
          <p class="muted">工作包的工期按工作日计算，计划日期会跳过非工作日。修改后，所有项目的排程会立即按新日历重新计算。</p>
          <div class="week">
            @for (d of days; track d.n) {
              <mat-checkbox [checked]="week().includes(d.n)" (change)="toggleDay(d.n, $event.checked)">{{ d.label }}</mat-checkbox>
            }
          </div>
          <mat-form-field style="width: 100%">
            <mat-label>放假日（每行一个日期，如 2026-10-01）</mat-label>
            <textarea matInput formControlName="holidays"></textarea>
          </mat-form-field>
          <mat-form-field style="width: 100%">
            <mat-label>调休上班日（周末补班，每行一个日期）</mat-label>
            <textarea matInput formControlName="extraWorkdays"></textarea>
          </mat-form-field>
        </section>
        <button mat-flat-button type="submit" [disabled]="form.invalid">保存</button>
        @if (saved()) { <span class="ok">已保存</span> }
      </form>
      @if (error()) { <div class="error" role="alert">{{ error() }}</div> }
      <app-cost-quality-settings />
    </div>
  `,
})
export class SettingsPage {
  private readonly api = inject(Api);
  private readonly fb = inject(FormBuilder).nonNullable;
  readonly days = DAYS;
  readonly error = signal('');
  readonly saved = signal(false);
  readonly week = signal<number[]>([1, 2, 3, 4, 5]);
  private readonly brand = inject(Brand);
  readonly form = this.fb.group({
    systemName: ['', [Validators.required, Validators.maxLength(40)]],
    companyName: ['', [Validators.required, Validators.maxLength(100)]],
    evmAmber: [0.95, [Validators.required, Validators.min(0.5), Validators.max(1)]],
    evmRed: [0.9, [Validators.required, Validators.min(0.5), Validators.max(1)]],
    holidays: [''],
    extraWorkdays: [''],
    requireCosign: [false],
    allowDirectProject: [false],
  });

  async ngOnInit() {
    const s = await this.api.get<CalendarSettings>('/tenant-settings');
    this.week.set(s.workWeek);
    this.form.patchValue({ systemName: s.systemName, companyName: s.companyName, evmAmber: s.evmAmber, evmRed: s.evmRed, holidays: s.holidays.join('\n'), extraWorkdays: s.extraWorkdays.join('\n'), requireCosign: !!s.requireCosign, allowDirectProject: !!s.allowDirectProject });
  }

  toggleDay(n: number, on: boolean) {
    this.week.update((w) => (on ? [...new Set([...w, n])].sort() : w.filter((x) => x !== n)));
  }

  private dates(text: string, label: string): string[] | null {
    const list = text.split(/[\s,，、;；]+/).map((x) => x.trim()).filter(Boolean);
    const bad = list.find((d) => !DATE.test(d) || Number.isNaN(Date.parse(d)));
    if (bad) { this.error.set(`${label}里的“${bad}”不是有效日期（格式 2026-10-01）`); return null; }
    return list;
  }

  async save() {
    this.error.set('');
    this.saved.set(false);
    const v = this.form.getRawValue();
    if (v.evmRed >= v.evmAmber) { this.error.set('告警线必须低于关注线'); return; }
    if (!this.week().length) { this.error.set('每周至少要有一个工作日'); return; }
    const holidays = this.dates(v.holidays, '放假日');
    const extraWorkdays = this.dates(v.extraWorkdays, '调休上班日');
    if (!holidays || !extraWorkdays) return;
    try {
      const s = await this.api.patch<CalendarSettings>('/tenant-settings', {
        systemName: v.systemName.trim(), companyName: v.companyName.trim(),
        evmAmber: v.evmAmber, evmRed: v.evmRed, workWeek: this.week(), holidays, extraWorkdays,
        requireCosign: v.requireCosign, allowDirectProject: v.allowDirectProject,
      });
      this.brand.set(s.systemName, s.companyName);
      this.brand.allowDirectProject.set(!!s.allowDirectProject);
      this.week.set(s.workWeek);
      this.form.patchValue({ holidays: s.holidays.join('\n'), extraWorkdays: s.extraWorkdays.join('\n') });
      this.saved.set(true);
    } catch (e) {
      this.error.set(errorMessage(e, '保存失败'));
    }
  }
}
