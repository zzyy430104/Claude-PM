import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Api } from '../core/api';
import { AuthService } from '../core/auth.service';
import { Dashboard, Todo } from '../core/models';
import { I18n } from '../core/i18n';

const HEALTH = { RED: '告警', AMBER: '关注', GREEN: '正常' } as const;

@Component({
  selector: 'app-home',
  imports: [RouterLink],
  styles: `
    .cards { display: flex; gap: 12px; flex-wrap: wrap; margin: 12px 0 24px; }
    .card { padding: 12px 20px; border-radius: 8px; background: var(--mat-sys-surface-container); min-width: 110px; }
    .card b { display: block; font-size: 24px; }
    table { width: 100%; border-collapse: collapse; font-size: 14px; }
    th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--mat-sys-outline-variant); vertical-align: top; }
    .dot { display: inline-block; width: 10px; height: 10px; border-radius: 50%; margin-right: 6px; }
    .RED { background: #d93025; } .AMBER { background: #f9ab00; } .GREEN { background: #1e8e3e; }
    .reasons { font-size: 12px; color: var(--mat-sys-on-surface-variant); }
    ul { padding-left: 18px; }
  `,
  template: `
    <div class="page">
      <h1>{{ i18n.t('欢迎，') }}{{ i18n.lang() === 'en' ? ' ' : '' }}{{ auth.user()?.name }}</h1>
      @if (!auth.hasRole('PLATFORM_ADMIN')) {
        @if (todos().length) {
          <h2>{{ i18n.t('我的待办') }}</h2>
          <ul>
            @for (t of todos(); track $index) {
              <li><a [routerLink]="t.link">{{ t.projectCode }}</a> · {{ t.title }}{{ t.dueDate ? ' · ' + t.dueDate : '' }}</li>
            }
          </ul>
        }
        @if (data(); as d) {
          <h2>{{ i18n.t('项目组合') }}</h2>
          <div class="cards">
            <div class="card"><b>{{ d.totals.projects }}</b>{{ i18n.t('项目') }}</div>
            <div class="card"><b>{{ d.totals.red }}</b><span class="dot RED"></span>{{ i18n.t('告警') }}</div>
            <div class="card"><b>{{ d.totals.amber }}</b><span class="dot AMBER"></span>{{ i18n.t('关注') }}</div>
            <div class="card"><b>{{ d.totals.green }}</b><span class="dot GREEN"></span>{{ i18n.t('正常') }}</div>
          </div>
          <table>
            <thead><tr><th>{{ i18n.t('健康度') }}</th><th>{{ i18n.t('项目') }}</th><th>{{ i18n.t('当前阶段') }}</th><th>{{ i18n.t('进度') }}</th><th>{{ i18n.t('预计完工') }}</th><th>{{ i18n.t('未关闭问题') }}</th></tr></thead>
            <tbody>
              @for (p of d.projects; track p.id) {
                <tr>
                  <td><span class="dot" [class]="'dot ' + p.health"></span>{{ i18n.t(healthLabel[p.health]) }}<div class="reasons">{{ reasonText(p.reasons) }}</div></td>
                  <td><a [routerLink]="['/projects', p.id]">{{ p.code }}</a> {{ p.name }}</td>
                  <td>{{ p.activePhase ? i18n.t(p.activePhase) : '—' }}</td>
                  <td>{{ p.progress.actual }}% / {{ p.progress.planned }}%</td>
                  <td>{{ p.progress.projectedEnd }}</td>
                  <td>{{ p.openIssues }}</td>
                </tr>
              }
            </tbody>
          </table>
          @if (d.projects.length === 0) { <p>{{ i18n.t('暂无可见的项目。') }}</p> }
        }
      }
    </div>
  `,
})
export class HomePage {
  private readonly api = inject(Api);
  readonly auth = inject(AuthService);
  readonly i18n = inject(I18n);
  readonly data = signal<Dashboard | null>(null);
  readonly todos = signal<Todo[]>([]);
  readonly healthLabel = HEALTH;
  readonly hasProjects = computed(() => (this.data()?.projects.length ?? 0) > 0);

  /** 健康度原因是服务端生成的中文句子，英文界面下经词典翻译；翻不了的保持原文 */
  reasonText(rs: string[]) { return rs.map((r) => this.i18n.t(r)).join(' · '); }

  async ngOnInit() {
    if (this.auth.hasRole('PLATFORM_ADMIN')) return;
    this.data.set(await this.api.get<Dashboard>('/dashboard'));
    this.todos.set(await this.api.get<Todo[]>('/me/todos'));
  }
}
