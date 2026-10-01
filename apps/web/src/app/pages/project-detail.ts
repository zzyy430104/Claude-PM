import { Component, computed, inject, input, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Api } from '../core/api';
import { PROJECT_STATUS_LABELS, Project } from '../core/models';
import { ProjectChanges } from '../components/project-changes';
import { ProjectClosure } from '../components/project-closure';
import { ProjectConfig } from '../components/project-config';
import { ProjectCost } from '../components/project-cost';
import { ProjectDeliverables } from '../components/project-deliverables';
import { ProjectDocuments } from '../components/project-documents';
import { ProjectGates } from '../components/project-gates';
import { ProjectIssues } from '../components/project-issues';
import { ProjectMembers } from '../components/project-members';
import { ProjectRequirements } from '../components/project-requirements';
import { ProjectOverview } from '../components/project-overview';
import { ProjectPhases } from '../components/project-phases';
import { ProjectQuality } from '../components/project-quality';
import { ProjectReviews } from '../components/project-reviews';
import { ProjectRisks } from '../components/project-risks';
import { ProjectTeam } from '../components/project-team';
import { ProjectWbs } from '../components/project-wbs';
import { ProjectPlanApproval } from '../components/project-plan-approval';
import { ProjectReqVersions } from '../components/project-req-versions';

/** 项目内按工作顺序分 7 组，每组下面再分子页；组和子页记在网址里（?g=组&s=子页），刷新和分享链接都回到同一页 */
const GROUPS: { key: string; label: string; subs: { key: string; label: string }[] }[] = [
  { key: 'overview', label: '总览', subs: [{ key: 'overview', label: '总览' }] },
  { key: 'plan', label: '计划', subs: [{ key: 'requirements', label: '项目要求与需求' }, { key: 'wbs', label: 'WBS 与进度' }, { key: 'members', label: '团队与职责' }, { key: 'approval', label: '计划批准' }] },
  { key: 'exec', label: '执行', subs: [{ key: 'phases', label: '阶段与评审' }, { key: 'deliverables', label: '交付物' }] },
  { key: 'ctrl', label: '控制', subs: [{ key: 'issues', label: '问题与行动' }, { key: 'changes', label: '变更' }, { key: 'risks', label: '风险与机会' }, { key: 'cost', label: '成本' }] },
  { key: 'qual', label: '质量', subs: [{ key: 'quality', label: '不符合项' }, { key: 'documents', label: '文档与配置' }] },
  { key: 'comm', label: '沟通', subs: [{ key: 'reviews', label: '项目评审' }, { key: 'team', label: '沟通计划与干系人' }] },
  { key: 'close', label: '收尾', subs: [{ key: 'closure', label: '总结与关闭' }] },
];
/** 每组默认打开的子页 */
const DEFAULT_SUB: Record<string, string> = { overview: 'overview', plan: 'wbs', exec: 'phases', ctrl: 'issues', qual: 'quality', comm: 'reviews', close: 'closure' };

@Component({
  selector: 'app-project-detail',
  imports: [RouterLink, ProjectOverview, ProjectRequirements, ProjectPhases, ProjectWbs, ProjectMembers, ProjectDeliverables, ProjectGates, ProjectReviews, ProjectChanges, ProjectRisks, ProjectIssues, ProjectCost, ProjectQuality, ProjectTeam, ProjectDocuments, ProjectClosure, ProjectConfig, ProjectReqVersions, ProjectPlanApproval],
  styles: `
    .crumb { font-size: 13px; color: var(--pm-muted); margin: 0 0 4px; }
    .crumb a { color: var(--pm-muted); }
    h1 { margin-bottom: 6px !important; }
    .meta { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; color: var(--pm-muted); font-size: 14px; margin: 0 0 18px; }
    .stack > * + * { display: block; margin-top: 20px; }
    .stack > .h-sub { margin: 24px 0 8px !important; font-size: 17px; }
  `,
  template: `
    @if (project(); as p) {
      <div class="page">
        <div class="crumb"><a routerLink="/projects">项目</a> / {{ p.name }}</div>
        <h1>{{ p.name }}</h1>
        <div class="meta">
          <span class="pill" [class.green]="p.status === 'ACTIVE'" [class.amber]="p.status === 'PLANNING'">{{ statusLabel() }}</span>
          @if (p.type) { <span class="pill blue">{{ p.type }} 类</span> }
          @if (p.baselined && !p.planOutdated) { <span class="pill blue">计划已批准</span> }
          @if (p.planOutdated) { <span class="pill amber">计划待重新批准</span> }
          @if (p.planSubmittedAt) { <span class="pill amber">计划待批准</span> }
          <span>编号 {{ p.code }}</span>
        </div>
        <nav class="gtabs" role="tablist" aria-label="项目分组">
          @for (g of groups; track g.key) {
            <button type="button" role="tab" [attr.aria-selected]="group() === g.key" (click)="go(g.key)">{{ g.label }}</button>
          }
        </nav>
        @if (subs().length > 1) {
          <nav class="stabs" role="tablist" aria-label="子页面">
            @for (t of subs(); track t.key) {
              <button type="button" role="tab" [attr.aria-selected]="tab() === t.key" (click)="go(group(), t.key)">{{ t.label }}</button>
            }
          </nav>
        }
        @switch (tab()) {
          @case ('overview') { <app-project-overview [project]="p" (changed)="load()" /> }
          @case ('requirements') { <div class="stack"><app-project-req-versions [project]="p" (changed)="load()" /><h2 class="h-sub">细化需求</h2><app-project-requirements [project]="p" /></div> }
          @case ('approval') { <app-project-plan-approval [project]="p" (changed)="load()" /> }
          @case ('phases') { <div class="stack"><app-project-phases [project]="p" /><app-project-gates [project]="p" /></div> }
          @case ('wbs') { <app-project-wbs [project]="p" /> }
          @case ('deliverables') { <app-project-deliverables [project]="p" /> }
          @case ('members') { <app-project-members [project]="p" /> }
          @case ('reviews') { <app-project-reviews [project]="p" /> }
          @case ('changes') { <app-project-changes [project]="p" /> }
          @case ('risks') { <app-project-risks [project]="p" /> }
          @case ('issues') { <app-project-issues [project]="p" /> }
          @case ('cost') { <app-project-cost [project]="p" /> }
          @case ('quality') { <app-project-quality [project]="p" /> }
          @case ('team') { <app-project-team [project]="p" /> }
          @case ('documents') { <div class="stack"><app-project-documents [project]="p" /><app-project-config [project]="p" /></div> }
          @case ('closure') { <app-project-closure [project]="p" (changed)="load()" /> }
        }
      </div>
    }
  `,
})
export class ProjectDetailPage {
  private readonly api = inject(Api);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  /** 来自路由参数 :id（withComponentInputBinding） */
  readonly id = input.required<string>();
  readonly project = signal<Project | null>(null);
  readonly groups = GROUPS;
  private readonly query = toSignal(this.route.queryParamMap);
  readonly group = computed(() => {
    const g = this.query()?.get('g') ?? 'overview';
    return GROUPS.some((x) => x.key === g) ? g : 'overview';
  });
  readonly subs = computed(() => GROUPS.find((x) => x.key === this.group())!.subs);
  readonly tab = computed(() => {
    const s = this.query()?.get('s');
    return this.subs().some((x) => x.key === s) ? s! : DEFAULT_SUB[this.group()];
  });
  readonly statusLabel = computed(() => {
    const p = this.project();
    return p ? PROJECT_STATUS_LABELS[p.status] : '';
  });

  ngOnInit() {
    void this.load();
  }

  go(g: string, s?: string) {
    void this.router.navigate([], { relativeTo: this.route, queryParams: { g, s: s ?? DEFAULT_SUB[g] }, replaceUrl: true });
  }

  async load() {
    this.project.set(await this.api.get<Project>(`/projects/${this.id()}`));
  }
}
