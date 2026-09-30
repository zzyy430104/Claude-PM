import { Component, inject, input, signal } from '@angular/core';
import { MatChipsModule } from '@angular/material/chips';
import { Api } from '../core/api';
import { PROJECT_ROLE_LABELS, Phase, Project } from '../core/models';

const STATUS = { PLANNED: '未开始', ACTIVE: '进行中', CLOSED: '已关闭' } as const;

@Component({
  selector: 'app-project-phases',
  imports: [MatChipsModule],
  styles: `.phase { border: 1px solid var(--mat-sys-outline-variant); border-radius: 8px; padding: 12px 16px; margin: 12px 0; } .phase.active { border-color: var(--mat-sys-primary); } h3 { margin: 0 0 4px; } ul { margin: 4px 0; }`,
  template: `
    @for (p of phases(); track p.id) {
      <div class="phase" [class.active]="p.status === 'ACTIVE'">
        <h3>{{ p.order }}. {{ p.name }} · {{ status[p.status] }}</h3>
        <div>必选参与者：{{ roles(p) }}</div>
        @if (p.checklist.length) {
          <div>关口清单：</div>
          <ul>@for (c of p.checklist; track c) { <li>{{ c }}</li> }</ul>
        }
      </div>
    }
  `,
})
export class ProjectPhases {
  private readonly api = inject(Api);
  readonly project = input.required<Project>();
  readonly phases = signal<Phase[]>([]);
  readonly status = STATUS;

  roles(p: Phase) {
    return p.mandatoryRoles.map((r) => PROJECT_ROLE_LABELS[r]).join('、') || '无';
  }

  async ngOnInit() {
    this.phases.set(await this.api.get<Phase[]>(`/projects/${this.project().id}/phases`));
  }
}
