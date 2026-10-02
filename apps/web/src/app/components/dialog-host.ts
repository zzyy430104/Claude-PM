import { Component, computed, ElementRef, effect, viewChild } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { dialogQueue } from '../core/dialog';
import { Modal } from './modal';

/** 显示 askConfirm / askText 的对话框（放在根组件里，登录页等任何页面都可用） */
@Component({
  selector: 'app-dialog-host',
  imports: [MatButtonModule, Modal],
  styles: `
    .msg { white-space: pre-line; font-size: 14px; line-height: 1.6; margin: 2px 0 12px; color: var(--pm-text); }
    textarea { width: 100%; box-sizing: border-box; min-height: 72px; font: inherit; font-size: 14px; border: 1px solid var(--pm-line); border-radius: 8px; padding: 8px 10px; resize: vertical; }
    textarea:focus { outline: 2px solid var(--pm-primary-soft); border-color: var(--pm-primary); }
    .danger { background: var(--pm-red) !important; color: #fff !important; }
  `,
  template: `
    @if (cur(); as d) {
      <app-modal [title]="d.kind === 'confirm' ? '请确认' : '请填写'" width="440px" (closed)="answer(d.kind === 'confirm' ? false : null)" data-dialog>
        <div class="msg">{{ d.message }}</div>
        @if (d.kind === 'prompt') {
          <textarea #box [value]="d.value" (keydown.enter)="$event.preventDefault(); ok(box.value)" aria-label="填写内容"></textarea>
        }
        <ng-container footer>
          <button mat-button type="button" (click)="answer(d.kind === 'confirm' ? false : null)">取消</button>
          <button mat-flat-button type="button" #okBtn [class.danger]="danger()" (click)="ok(box()?.nativeElement?.value ?? '')">确定</button>
        </ng-container>
      </app-modal>
    }
  `,
})
export class DialogHost {
  readonly cur = computed(() => dialogQueue()[0] ?? null);
  /** 删除、作废、取消之类的操作，确定按钮用红色 */
  readonly danger = computed(() => { const d = this.cur(); return !!d && d.kind === 'confirm' && /删除|作废|取消|停用|撤销|驳回|关闭|移除|放弃/.test(d.message); });
  readonly box = viewChild<ElementRef<HTMLTextAreaElement>>('box');
  readonly okBtn = viewChild<unknown, ElementRef<HTMLButtonElement>>('okBtn', { read: ElementRef });

  constructor() {
    // 打开时把焦点放到输入框（输入框）或确定按钮（确认框），回车即可确认
    effect(() => {
      if (!this.cur()) return;
      const box = this.box(); const btn = this.okBtn();
      setTimeout(() => (box?.nativeElement ?? btn?.nativeElement)?.focus());
    });
  }

  ok(text: string) {
    const d = this.cur();
    if (!d) return;
    this.answer(d.kind === 'confirm' ? true : text);
  }

  answer(v: string | boolean | null) {
    const d = this.cur();
    if (!d) return;
    dialogQueue.update((q) => q.slice(1));
    d.resolve(v);
  }
}
