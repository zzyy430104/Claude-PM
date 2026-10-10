import { afterNextRender, DestroyRef, ElementRef, inject } from '@angular/core';

/**
 * 把组件挂到 body 下：抽屉、弹窗用 position: fixed 覆盖全屏，
 * 但放在侧边栏布局的内容区里时，Safari 会让顶栏盖住它（内容区自成一个层叠上下文）。
 * 在组件构造函数里调用。
 */
export function portalToBody() {
  const el = inject(ElementRef<HTMLElement>).nativeElement as HTMLElement;
  afterNextRender(() => document.body.appendChild(el));
  inject(DestroyRef).onDestroy(() => el.remove());
}
