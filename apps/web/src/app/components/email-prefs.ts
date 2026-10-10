import { Component, inject, signal } from '@angular/core';
import { Api, errorMessage } from '../core/api';

const CATS: [string, string, string][] = [
  ['APPROVAL', '审批', '立项、计划、变更、项目要求变更、售后交接等待你处理或已有结论'],
  ['TASK', '分配给我的任务', '行动项、问题、不符合项措施、培训'],
  ['MEETING', '会议', '会议通知（含日历邀请）、变更、取消、纪要'],
  ['ANNOUNCEMENT', '公告', '项目公告与已读提醒'],
  ['DISCUSSION', '讨论', '有人 @ 你，或你参与的讨论有新回复'],
  ['ALERT', '预警', '风险、超支、复查到期等预警'],
  ['OTHER', '其他', '绩效评价单等其他通知'],
];

/** 个人设置：哪些通知同时发邮件（站内通知总是保留） */
@Component({
  selector: 'app-email-prefs',
  template: `
    <h2>邮件通知</h2>
    <p class="muted">站内通知总会保留；这里选择哪些类别同时发邮件。@if (!enabled()) { 当前系统没有配置邮件服务，设置会在配置后生效。}</p>
    @if (error()) { <div class="error" role="alert">{{ error() }}</div> }
    <div class="panel" style="max-width: 640px">
      @for (c of cats; track c[0]) {
        <label style="display: flex; gap: 10px; align-items: baseline; padding: 6px 0">
          <input type="checkbox" [checked]="prefs()[c[0]] !== false" (change)="set(c[0], $any($event.target).checked)" [attr.aria-label]="'邮件 ' + c[1]" />
          <span><b>{{ c[1] }}</b> <span class="muted" style="font-size: 13px">{{ c[2] }}</span></span>
        </label>
      }
      @if (saved()) { <span style="color: var(--pm-green); font-size: 13px">已保存</span> }
    </div>
  `,
})
export class EmailPrefs {
  private readonly api = inject(Api);
  readonly cats = CATS;
  readonly prefs = signal<Record<string, boolean>>({});
  readonly enabled = signal(true);
  readonly saved = signal(false);
  readonly error = signal('');
  async ngOnInit() {
    try { const x = await this.api.get<{ enabled: boolean; prefs: Record<string, boolean> }>('/notifications/email-prefs'); this.prefs.set(x.prefs); this.enabled.set(x.enabled); } catch (e) { this.error.set(errorMessage(e, '加载失败')); }
  }
  async set(k: string, v: boolean) {
    this.saved.set(false);
    try { const x = await this.api.put<{ prefs: Record<string, boolean> }>('/notifications/email-prefs', { ...this.prefs(), [k]: v }); this.prefs.set(x.prefs); this.saved.set(true); } catch (e) { this.error.set(errorMessage(e, '保存失败')); }
  }
}
