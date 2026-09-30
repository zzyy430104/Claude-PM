import { Component, computed, inject, input, signal } from '@angular/core';
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
import { ProjectOverview } from '../components/project-overview';
import { ProjectPhases } from '../components/project-phases';
import { ProjectQuality } from '../components/project-quality';
import { ProjectReviews } from '../components/project-reviews';
import { ProjectRisks } from '../components/project-risks';
import { ProjectTeam } from '../components/project-team';
import { ProjectWbs } from '../components/project-wbs';

/** 项目模块导航：按用途分三行，功能多时也不会被挤到看不见的位置 */
const GROUPS: { title: string; tabs: { key: string; label: string }[] }[] = [
  { title: '策划与执行', tabs: [
    { key: 'overview', label: '概览与计划' }, { key: 'phases', label: '阶段' }, { key: 'wbs', label: 'WBS 与进度' },
    { key: 'deliverables', label: '交付物' }, { key: 'members', label: '成员' },
  ] },
  { title: '评审与控制', tabs: [
    { key: 'gates', label: '关口评审' }, { key: 'reviews', label: '项目评审' }, { key: 'changes', label: '变更控制' },
    { key: 'risks', label: '风险与机会' }, { key: 'issues', label: '问题与行动' },
  ] },
  { title: '成本、质量与记录', tabs: [
    { key: 'cost', label: '成本' }, { key: 'quality', label: '质量与不符合项' }, { key: 'team', label: '沟通与培训' },
    { key: 'documents', label: '文档' }, { key: 'config', label: '配置管理' }, { key: 'closure', label: '经验教训与关闭' },
  ] },
];

@Component({
  selector: 'app-project-detail',
  imports: [ProjectOverview, ProjectPhases, ProjectWbs, ProjectMembers, ProjectDeliverables, ProjectGates, ProjectReviews, ProjectChanges, ProjectRisks, ProjectIssues, ProjectCost, ProjectQuality, ProjectTeam, ProjectDocuments, ProjectClosure, ProjectConfig],
  styles: `
    h1 { margin-bottom: 6px !important; }
    .status { display: inline-block; padding: 2px 10px; border-radius: 999px; background: #dbe5f0; color: var(--pm-primary-strong); font-size: 12px; font-weight: 500; margin: 0 0 16px; }
    .nav { background: var(--pm-card); border: 1px solid var(--pm-line); border-radius: var(--pm-radius); box-shadow: var(--pm-shadow); padding: 8px 14px; margin: 0 0 20px; }
    .row-nav { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; padding: 5px 0; }
    .row-nav + .row-nav { border-top: 1px solid var(--pm-line); }
    .group { font-size: 12px; font-weight: 600; color: var(--pm-muted); width: 130px; }
    button[role=tab] { border: 0; background: none; padding: 6px 14px; border-radius: 8px; cursor: pointer; font: inherit; font-weight: 500; color: var(--pm-text); }
    button[role=tab]:hover { background: var(--pm-bg); }
    button[role=tab][aria-selected=true] { background: var(--pm-primary); color: #fff; }
  `,
  template: `
    @if (project(); as p) {
      <div class="page">
        <h1>{{ p.code }} · {{ p.name }}</h1>
        <p class="status">{{ statusLabel() }}{{ p.baselined ? ' · 已建立基线' : '' }}</p>
        <nav class="nav" role="tablist" aria-label="项目模块">
          @for (g of groups; track g.title) {
            <div class="row-nav">
              <span class="group">{{ g.title }}</span>
              @for (t of g.tabs; track t.key) {
                <button type="button" role="tab" [attr.aria-selected]="tab() === t.key" (click)="tab.set(t.key)">{{ t.label }}</button>
              }
            </div>
          }
        </nav>
        @switch (tab()) {
          @case ('overview') { <app-project-overview [project]="p" (changed)="load()" /> }
          @case ('phases') { <app-project-phases [project]="p" /> }
          @case ('wbs') { <app-project-wbs [project]="p" /> }
          @case ('deliverables') { <app-project-deliverables [project]="p" /> }
          @case ('members') { <app-project-members [project]="p" /> }
          @case ('gates') { <app-project-gates [project]="p" /> }
          @case ('reviews') { <app-project-reviews [project]="p" /> }
          @case ('changes') { <app-project-changes [project]="p" /> }
          @case ('risks') { <app-project-risks [project]="p" /> }
          @case ('issues') { <app-project-issues [project]="p" /> }
          @case ('cost') { <app-project-cost [project]="p" /> }
          @case ('quality') { <app-project-quality [project]="p" /> }
          @case ('team') { <app-project-team [project]="p" /> }
          @case ('documents') { <app-project-documents [project]="p" /> }
          @case ('config') { <app-project-config [project]="p" /> }
          @case ('closure') { <app-project-closure [project]="p" (changed)="load()" /> }
        }
      </div>
    }
  `,
})
export class ProjectDetailPage {
  private readonly api = inject(Api);
  /** 来自路由参数 :id（withComponentInputBinding） */
  readonly id = input.required<string>();
  readonly project = signal<Project | null>(null);
  readonly tab = signal('overview');
  readonly groups = GROUPS;
  readonly statusLabel = computed(() => {
    const p = this.project();
    return p ? PROJECT_STATUS_LABELS[p.status] : '';
  });

  ngOnInit() {
    void this.load();
  }

  async load() {
    this.project.set(await this.api.get<Project>(`/projects/${this.id()}`));
  }
}
