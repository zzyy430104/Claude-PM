import { Component, effect, inject, input, signal } from '@angular/core';
import { Ai, AiProvenance } from '../core/ai';

/** 记录上的“AI 起草，某某确认”标记 */
@Component({
  selector: 'app-ai-mark',
  template: `@if (p(); as x) { <span class="pill blue" [attr.title]="'确认时间 ' + x.at.slice(0, 16).replace('T', ' ')">AI 起草，{{ x.by }} 确认</span> }`,
})
export class AiMark {
  private readonly ai = inject(Ai);
  readonly entity = input.required<string>();
  readonly id = input.required<string>();
  readonly p = signal<AiProvenance | null>(null);
  constructor() {
    effect(() => { const e = this.entity(), id = this.id(); void this.ai.provenance(e, id).then((x) => this.p.set(x)); });
  }
}
