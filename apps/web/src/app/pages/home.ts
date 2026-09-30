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
    .dot3 { display: inline-block; width: 12px; height: 12px; border-radius: 50%; background: var(--pm-green); }
    .dot3.RED { background: var(--pm-red); } .dot3.AMBER { background: var(--pm-amber); }
    .idx { font-size: 11.5px; color: var(--pm-muted); margin-top: 2px; white-space: nowrap; }
    .reasons { font-size: 12px; color: var(--pm-muted); margin-top: 4px; }
    .todo { list-style: none; margin: 0; padding: 0; }
    .todo li { padding: 10px 0; border-bottom: 1px solid var(--pm-line); }
    .todo li:last-child { border-bottom: 0; }
    .bar { height: 6px; background: #e4e9f0; border-radius: 3px; width: 90px; margin-top: 6px; overflow: hidden; }
    .bar i { display: block; height: 100%; background: var(--pm-accent); }
  `,
  template: `
    <div class="page">
      <h1>{{ i18n.t('欢迎，') }}{{ i18n.lang() === 'en' ? ' ' : '' }}{{ auth.user()?.name }}</h1>
      @if (!auth.hasRole('PLATFORM_ADMIN')) {
        @if (todos().length) {
          <h2>{{ i18n.t('我的待办') }}</h2>
          <div class="panel">
            <ul class="todo">
              @for (t of todos(); track $index) {
                <li><a [routerLink]="t.link">{{ t.projectCode }}</a> · {{ t.title }}{{ t.dueDate ? ' · ' + t.dueDate : '' }}</li>
              }
            </ul>
          </div>
        }
        @if (data(); as d) {
          <h2>{{ i18n.t('项目组合') }}</h2>
          <div class="stats">
            <div class="stat"><b>{{ d.totals.projects }}</b><span>{{ i18n.t('项目') }}</span></div>
            <div class="stat red"><b>{{ d.totals.red }}</b><span>{{ i18n.t('告警') }}</span></div>
            <div class="stat amber"><b>{{ d.totals.amber }}</b><span>{{ i18n.t('关注') }}</span></div>
            <div class="stat green"><b>{{ d.totals.green }}</b><span>{{ i18n.t('正常') }}</span></div>
          </div>
          <div class="tbl">
          <table>
            <thead><tr><th>{{ i18n.t('健康度') }}</th><th>{{ i18n.t('项目') }}</th><th>{{ i18n.t('质量') }}</th><th>{{ i18n.t('进度') }}</th><th>{{ i18n.t('成本') }}</th><th>{{ i18n.t('当前阶段') }}</th><th>{{ i18n.t('完成') }}</th><th>{{ i18n.t('预计完工') }}</th><th>{{ i18n.t('未关闭问题') }}</th></tr></thead>
            <tbody>
              @for (p of d.projects; track p.id) {
                <tr>
                  <td><span [class]="'badge ' + p.health">{{ i18n.t(healthLabel[p.health]) }}</span><div class="reasons">{{ reasonText(p.reasons) }}</div></td>
                  <td><a [routerLink]="['/projects', p.id]">{{ p.code }}</a> {{ p.name }}</td>
                  <td><span [class]="'dot3 ' + (p.triangle?.quality ?? 'GREEN')" [attr.title]="i18n.t('质量')"></span></td>
                  <td><span [class]="'dot3 ' + (p.triangle?.schedule ?? 'GREEN')"></span><div class="idx">SPI {{ p.spi ?? '—' }}</div></td>
                  <td><span [class]="'dot3 ' + (p.triangle?.cost ?? 'GREEN')"></span><div class="idx">CPI {{ p.cpi ?? '—' }}</div></td>
                  <td>{{ p.activePhase ? i18n.t(p.activePhase) : '—' }}</td>
                  <td>{{ p.progress.actual }}% / {{ p.progress.planned }}%<div class="bar"><i [style.width.%]="p.progress.actual"></i></div></td>
                  <td style="white-space: nowrap">{{ p.progress.projectedEnd }}</td>
                  <td>{{ p.openIssues }}</td>
                </tr>
              }
            </tbody>
          </table>
          </div>
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
