import { Component, computed, inject, input, output, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { Api, errorMessage } from '../core/api';
import { askText } from '../core/i18n';
import { PlanApprovalStatus, PlanVersion, Project } from '../core/models';

/**
 * 计划批准：计划对照项目要求逐项检查（交期、成本、交付物、责任人、风险），
 * 全部通过后项目经理提交，管理层（计划批准人，立项批准人也可）批准；批准即保存一版计划作为对比基准。
 */
@Component({
  selector: 'app-project-plan-approval',
  imports: [RouterLink, MatButtonModule],
  styles: `
    .side .mdc-button { width: 100%; margin: 8px 0 0 !important; }
    .note { color: var(--pm-muted); font-size: 13px; margin: 10px 0 0; }
  `,
  template: `
    @if (error()) { <div class="error" role="alert">{{ error() }}</div> }
    @if (status(); as s) {
      @if (!s.needsApproval) {
        <div class="banner">本项目没有经过立项，由项目经理在「总览」里自行批准计划。下面的检查供参考。</div>
      } @else if (s.outdated) {
        <div class="banner amber">项目要求已变更为 v{{ project().requirementVersion }}，计划需要对照新的项目要求调整，再提交重新批准。</div>
      } @else if (s.baselined) {
        <div class="banner green">计划已批准。以后修改需要走变更；项目要求变化时走“项目要求变更”。</div>
      }
      <div class="split">
        <div>
          <section class="pcard">
            <header><h2>{{ project().requirementVersion ? '对照项目要求 v' + project().requirementVersion + ' 的检查' : '计划检查' }}</h2><span class="grow"></span>
              <span class="pill" [class.green]="s.ok" [class.red]="!s.ok">{{ s.ok ? '通过' : '未通过' }}</span></header>
            <div class="body">
              <ul class="checks">@for (c of s.checks; track c.key) { <li [class.no]="!c.ok">{{ c.message }}</li> }</ul>
              <p class="note">未通过的项需要先修改计划；如果确实做不到项目要求，请发起<a [routerLink]="[]" [queryParams]="{ g: 'plan', s: 'requirements' }">项目要求变更</a>，不能在项目内直接放行。</p>
            </div>
          </section>
          @if (versions().length) {
            <section class="pcard">
              <header><h3>历史版本</h3></header>
              <div class="tblwrap">
                <table>
                  <thead><tr><th>版本</th><th>批准日期</th><th>说明</th><th>工作包</th></tr></thead>
                  <tbody>
                    @for (v of versions(); track v.id) {
                      <tr><td>计划 v{{ v.version }}</td><td>{{ v.createdAt.slice(0, 10) }}</td><td>{{ v.note }}</td><td>{{ v.snapshot.workPackages.length }} 个</td></tr>
                    }
                  </tbody>
                </table>
              </div>
            </section>
          }
        </div>
        @if (s.needsApproval) {
          <aside class="side">
            <section class="pcard">
              <header><h3>提交批准</h3></header>
              <div class="body">
                <ol class="steps">
                  <li [class.done]="!!s.submittedAt || (s.baselined && !s.outdated)" [class.now]="open() && !s.submittedAt"><b>1</b>项目经理提交<small>检查全部通过才能提交</small></li>
                  <li [class.done]="s.baselined && !s.outdated" [class.now]="!!s.submittedAt"><b>2</b>管理层批准<small>计划批准人；立项批准人也可批准</small></li>
                  <li [class.done]="s.baselined && !s.outdated"><b>3</b>生效<small>保存为新一版计划，作为进度和成本的对比基准</small></li>
                </ol>
                @if (s.can.submit) { <button mat-flat-button type="button" (click)="submit()" [disabled]="busy() || !s.ok">提交计划批准</button> }
                @if (s.submittedAt && !s.can.approve) { <p class="note">已于 {{ s.submittedAt.slice(0, 10) }} 提交，等待批准。</p> }
                @if (s.can.approve) {
                  <button mat-flat-button type="button" (click)="approve()" [disabled]="busy() || !s.ok">批准计划</button>
                  <button mat-stroked-button type="button" (click)="returnPlan()" [disabled]="busy()">退回修改</button>
                }
              </div>
            </section>
          </aside>
        }
      </div>
    }
  `,
})
export class ProjectPlanApproval {
  private readonly api = inject(Api);
  readonly project = input.required<Project>();
  readonly changed = output<void>();
  readonly status = signal<PlanApprovalStatus | null>(null);
  readonly versions = signal<PlanVersion[]>([]);
  readonly error = signal('');
  readonly busy = signal(false);
  readonly open = computed(() => { const s = this.status(); return !!s && (!s.baselined || s.outdated); });

  ngOnInit() { void this.load(); }

  async load() {
    try {
      const id = this.project().id;
      const [s, v] = await Promise.all([
        this.api.get<PlanApprovalStatus>(`/projects/${id}/plan-approval`),
        this.api.get<PlanVersion[]>(`/projects/${id}/plan-versions`),
      ]);
      this.status.set(s); this.versions.set(v);
    } catch (e) { this.error.set(errorMessage(e, '加载失败')); }
  }

  private async act(path: string, body: unknown = {}) {
    this.error.set(''); this.busy.set(true);
    try {
      this.status.set(await this.api.post<PlanApprovalStatus>(`/projects/${this.project().id}/plan-approval/${path}`, body));
      this.versions.set(await this.api.get<PlanVersion[]>(`/projects/${this.project().id}/plan-versions`));
      this.changed.emit();
    } catch (e) { this.error.set(errorMessage(e, '操作失败')); } finally { this.busy.set(false); }
  }
  submit() { return this.act('submit'); }
  approve() {
    if (!confirm('批准后计划生效，作为进度和成本的对比基准。确定批准？')) return;
    return this.act('approve');
  }
  returnPlan() {
    const note = askText('退回理由');
    if (!note?.trim()) return;
    return this.act('return', { note: note.trim() });
  }
}
