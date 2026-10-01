import { Component, inject, signal } from '@angular/core';
import { Api, errorMessage } from '../core/api';
import { ProjectHandover } from '../components/project-handover';

interface Row { projectId: string; project?: { id: string; code: string; name: string }; status: string; submittedAt: string | null; confirmedAt: string | null }

/** 等我确认的售后交接：接收人往往不是项目成员，在这里查看并确认 */
@Component({
  selector: 'app-handovers',
  imports: [ProjectHandover],
  template: `
    <div class="page">
      <h1>售后交接</h1>
      <p class="muted">项目经理发起、需要你确认接收的售后交接。</p>
      @if (error()) { <div class="error" role="alert">{{ error() }}</div> }
      @for (r of rows(); track r.projectId) {
        <h2 style="font-size: 16px">{{ r.project?.code }} {{ r.project?.name }}</h2>
        <app-project-handover [projectId]="r.projectId" (changed)="load()" />
      } @empty { <p class="muted">没有需要你确认的售后交接。</p> }
    </div>
  `,
})
export class HandoversPage {
  private readonly api = inject(Api);
  readonly rows = signal<Row[]>([]);
  readonly error = signal('');
  ngOnInit() { void this.load(); }
  async load() {
    try { this.rows.set(await this.api.get<Row[]>('/handovers/mine')); } catch (e) { this.error.set(errorMessage(e, '加载失败')); }
  }
}
