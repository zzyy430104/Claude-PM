import { Component, computed, inject, input, signal } from '@angular/core';
import { MatTabsModule } from '@angular/material/tabs';
import { Api } from '../core/api';
import { PROJECT_STATUS_LABELS, Project } from '../core/models';
import { ProjectDeliverables } from '../components/project-deliverables';
import { ProjectMembers } from '../components/project-members';
import { ProjectOverview } from '../components/project-overview';
import { ProjectPhases } from '../components/project-phases';
import { ProjectWbs } from '../components/project-wbs';
import { ProjectCost } from '../components/project-cost';
import { ProjectQuality } from '../components/project-quality';
import { ProjectTeam } from '../components/project-team';
import { ProjectChanges } from '../components/project-changes';
import { ProjectGates } from '../components/project-gates';
import { ProjectIssues } from '../components/project-issues';
import { ProjectReviews } from '../components/project-reviews';
import { ProjectRisks } from '../components/project-risks';

/** 项目详情：各模块以标签页挂载，后续批次在此追加 */
@Component({
  selector: 'app-project-detail',
  imports: [MatTabsModule, ProjectOverview, ProjectPhases, ProjectWbs, ProjectMembers, ProjectDeliverables, ProjectGates, ProjectReviews, ProjectChanges, ProjectRisks, ProjectIssues, ProjectCost, ProjectQuality, ProjectTeam],
  template: `
    @if (project(); as p) {
      <div class="page">
        <h1>{{ p.code }} · {{ p.name }}</h1>
        <p>{{ statusLabel() }}{{ p.baselined ? ' · 已建立基线' : '' }}</p>
        <mat-tab-group animationDuration="0ms">
          <mat-tab label="概览与计划"><ng-template matTabContent><app-project-overview [project]="p" (changed)="load()" /></ng-template></mat-tab>
          <mat-tab label="阶段"><ng-template matTabContent><app-project-phases [project]="p" /></ng-template></mat-tab>
          <mat-tab label="WBS 与进度"><ng-template matTabContent><app-project-wbs [project]="p" /></ng-template></mat-tab>
          <mat-tab label="关口评审"><ng-template matTabContent><app-project-gates [project]="p" /></ng-template></mat-tab>
          <mat-tab label="项目评审"><ng-template matTabContent><app-project-reviews [project]="p" /></ng-template></mat-tab>
          <mat-tab label="变更控制"><ng-template matTabContent><app-project-changes [project]="p" /></ng-template></mat-tab>
          <mat-tab label="风险与机会"><ng-template matTabContent><app-project-risks [project]="p" /></ng-template></mat-tab>
          <mat-tab label="问题与行动"><ng-template matTabContent><app-project-issues [project]="p" /></ng-template></mat-tab>
          <mat-tab label="成本"><ng-template matTabContent><app-project-cost [project]="p" /></ng-template></mat-tab>
          <mat-tab label="质量与不符合项"><ng-template matTabContent><app-project-quality [project]="p" /></ng-template></mat-tab>
          <mat-tab label="沟通与培训"><ng-template matTabContent><app-project-team [project]="p" /></ng-template></mat-tab>
          <mat-tab label="交付物"><ng-template matTabContent><app-project-deliverables [project]="p" /></ng-template></mat-tab>
          <mat-tab label="成员"><ng-template matTabContent><app-project-members [project]="p" /></ng-template></mat-tab>
        </mat-tab-group>
      </div>
    }
  `,
})
export class ProjectDetailPage {
  private readonly api = inject(Api);
  /** 来自路由参数 :id（withComponentInputBinding） */
  readonly id = input.required<string>();
  readonly project = signal<Project | null>(null);
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
