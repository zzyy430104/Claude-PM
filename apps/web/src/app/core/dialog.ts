import { signal } from '@angular/core';

/**
 * 系统内的确认框和输入框（代替浏览器自带的 confirm / prompt）：样式统一、可以拖动，手机上也好用。
 * 由根组件里的 <app-dialog-host> 显示；一次只显示一个，其余排队。
 * 浏览器端到端测试在页面上设 window.__pmNativeDialogs = true，改用浏览器自带对话框，便于自动应答。
 */
export interface DialogRequest {
  kind: 'confirm' | 'prompt';
  message: string;
  value: string;
  resolve: (v: string | boolean | null) => void;
}

export const dialogQueue = signal<DialogRequest[]>([]);

const native = () => !!(window as unknown as { __pmNativeDialogs?: boolean }).__pmNativeDialogs;

function open<T>(kind: DialogRequest['kind'], message: string, value: string): Promise<T> {
  return new Promise<T>((resolve) => dialogQueue.update((q) => [...q, { kind, message, value, resolve: resolve as (v: unknown) => void }]));
}

/** 确认框：确定返回 true，取消或关闭返回 false */
export function askConfirm(message: string): Promise<boolean> {
  if (native()) return Promise.resolve(window.confirm(message));
  return open<boolean>('confirm', message, '');
}

/** 输入框：确定返回填写的文字，取消或关闭返回 null */
export function askText(message: string, value = ''): Promise<string | null> {
  if (native()) return Promise.resolve(window.prompt(message, value));
  return open<string | null>('prompt', message, value);
}
