import { Component, HostListener, input, output } from '@angular/core';
import { CdkDrag, CdkDragHandle } from '@angular/cdk/drag-drop';
import { portalToBody } from '../core/portal';

/**
 * 通用弹窗：居中显示，按住标题栏可以拖动；Esc 或右上角 × 关闭。
 * 内容用 <ng-content>，底部按钮放在带 footer 属性的元素里。
 * 里面的输入框用紧凑尺寸；下拉请用原生 select（Material 下拉面板会被弹窗盖住）。
 */
@Component({
  selector: 'app-modal',
  imports: [CdkDrag, CdkDragHandle],
  styles: `
    .shade { position: fixed; inset: 0; background: rgba(20, 26, 24, .38); z-index: 1000; display: flex; align-items: flex-start; justify-content: center; padding: 8vh 16px 16px; box-sizing: border-box; }
    .win { background: var(--pm-card); border-radius: 12px; box-shadow: 0 12px 40px rgba(0,0,0,.22); max-width: 100%; max-height: 84vh; display: flex; flex-direction: column; }
    header { display: flex; align-items: center; gap: 12px; padding: 12px 16px 10px; border-bottom: 1px solid var(--pm-line); cursor: move; user-select: none; }
    header h3 { margin: 0; font-size: 15px; flex: 1; }
    .x { border: 0; background: none; font-size: 20px; line-height: 1; cursor: pointer; color: var(--pm-muted); padding: 0 4px; }
    .body { padding: 12px 16px; overflow: auto; font-size: 13px; }
    footer { display: flex; justify-content: flex-end; gap: 8px; padding: 10px 16px; border-top: 1px solid var(--pm-line); }
    footer:empty { display: none; }
    /* 紧凑表单 */
    .body ::ng-deep .fgrid { grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 8px 12px; margin: 0; }
    .body ::ng-deep .fld { font-size: 12px; }
    .body ::ng-deep .fld > :is(input, select, textarea) { font-size: 13px; padding: 5px 8px; border-radius: 7px; }
    .body ::ng-deep .chk { display: flex; align-items: center; gap: 6px; font-size: 13px; color: var(--pm-text); }
  `,
  template: `
    <div class="shade">
      <div class="win" cdkDrag cdkDragBoundary=".shade" role="dialog" aria-modal="true" [attr.aria-label]="title()" [style.width]="width()">
        <header cdkDragHandle><h3>{{ title() }}</h3><button type="button" class="x" (click)="closed.emit()" aria-label="关闭">×</button></header>
        <div class="body"><ng-content /></div>
        <footer><ng-content select="[footer]" /></footer>
      </div>
    </div>
  `,
})
export class Modal {
  readonly title = input('');
  readonly width = input('640px');
  readonly closed = output<void>();
  constructor() { portalToBody(); }
  @HostListener('document:keydown.escape') esc() { this.closed.emit(); }
}
