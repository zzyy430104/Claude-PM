import { Component, inject, signal } from '@angular/core';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { Api } from '../core/api';
import { Lesson } from '../core/models';

@Component({
  selector: 'app-knowledge',
  imports: [MatFormFieldModule, MatInputModule],
  styles: `.box { border: 1px solid var(--mat-sys-outline-variant); border-radius: 8px; padding: 8px 16px; margin: 8px 0; } .meta { font-size: 13px; color: var(--mat-sys-on-surface-variant); }`,
  template: `
    <div class="page">
      <h1>经验教训库</h1>
      <p>汇总本企业所有项目的经验教训与良好实践，供投标和新项目策划参考。</p>
      <mat-form-field style="width: 100%"><mat-label>搜索</mat-label><input matInput (input)="search($any($event.target).value)" /></mat-form-field>
      @for (l of rows(); track l.id) {
        <div class="box"><strong>{{ l.kind === 'LESSON' ? '教训' : '良好实践' }} · {{ l.title }}</strong> <span class="meta">来自 {{ l.project?.code }} {{ l.project?.name }}</span>
          <div class="meta">{{ l.description }}</div><div>建议：{{ l.recommendation }}</div></div>
      }
      @if (rows().length === 0) { <p>没有匹配的记录。</p> }
    </div>
  `,
})
export class KnowledgePage {
  private readonly api = inject(Api);
  readonly rows = signal<Lesson[]>([]);
  constructor() { void this.search(''); }
  async search(q: string) { this.rows.set(await this.api.get<Lesson[]>(`/lessons?q=${encodeURIComponent(q)}`)); }
}
