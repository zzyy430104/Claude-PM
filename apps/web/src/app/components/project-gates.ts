import { Component, computed, inject, input, signal } from '@angular/core';
import { askText } from '../core/i18n';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { DatePipe } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { Api, errorMessage } from '../core/api';
import { DECISION_LABELS, GateReview, Member, PROJECT_ROLE_LABELS, Phase, Project, Readiness } from '../core/models';

const STATUS = { PLANNED: '未开始', ACTIVE: '进行中', CLOSED: '已关闭' } as const;

@Component({
  selector: 'app-project-gates',
  imports: [ReactiveFormsModule, DatePipe, MatButtonModule, MatCheckboxModule, MatFormFieldModule, MatInputModule, MatSelectModule],
  styles: `.sum-grid { display: grid; grid-template-columns: 3fr 2fr; gap: 16px; margin: 10px 0; } @media (max-width: 900px) { .sum-grid { grid-template-columns: 1fr; } } h4 { margin: 8px 0 4px; font-size: 13px; } .phase { border: 1px solid var(--mat-sys-outline-variant); border-radius: 8px; padding: 12px 16px; margin: 12px 0; } .phase.active { border-color: var(--mat-sys-primary); } .warn { color: var(--mat-sys-error); } h3 { margin: 0 0 6px; } ul { margin: 4px 0; } .meta { font-size: 13px; color: var(--mat-sys-on-surface-variant); }`,
  template: `
    @if (error()) { <div class="error" role="alert">{{ error() }}</div> }
    @if (!project().baselined) { <p>项目计划批准并启动后，才能进行阶段关口评审。</p> }
    @for (p of phases(); track p.id) {
      <div class="phase" [class.active]="p.status === 'ACTIVE'">
        <h3>{{ p.order }}. {{ p.name }} · {{ status[p.status] }}</h3>

        @if (p.status === 'ACTIVE') {
          @if (readiness(); as r) {
            <div class="meta">
              关口就绪情况：清单未通过 {{ r.checklistFailed.length }} 项；未核验工作包 {{ r.pendingWorkPackages.length }} 个；未接受交付物 {{ r.pendingDeliverables.length }} 个；此前遗留的未关闭问题
              <span [class.warn]="r.priorOpenIssues.length > 0">{{ r.priorOpenIssues.length }} 个</span>
            </div>
            <div class="sum-grid">
              <div>
                <h4>工作包（从第 {{ r.wbsLevel ?? 1 }} 级 WBS 起汇总）</h4>
                @if (r.wbsGroups?.length) {
                  <table>
                    <thead><tr><th>工作包</th><th>末级工作包</th><th>已完成</th><th>已验证</th></tr></thead>
                    <tbody>
                      @for (g of r.wbsGroups; track g.id) {
                        <tr><td>{{ g.code }} {{ g.name }}</td><td>{{ g.leaves }}</td><td>{{ g.done }}</td><td [class.warn]="g.verified < g.leaves">{{ g.verified }}</td></tr>
                      }
                    </tbody>
                  </table>
                } @else { <p class="meta">本阶段还没有归属的工作包（在「WBS 与进度」里为工作包指定所属阶段）。</p> }
              </div>
              <div>
                <h4>本阶段交付物</h4>
                @if (r.deliverables?.length) {
                  <table>
                    <thead><tr><th>交付物</th><th>状态</th></tr></thead>
                    <tbody>
                      @for (d of r.deliverables; track d.id) { <tr><td>{{ d.name }}</td><td [class.warn]="d.status !== 'ACCEPTED'">{{ dlStatus[d.status] }}</td></tr> }
                    </tbody>
                  </table>
                } @else { <p class="meta">本阶段没有交付物。</p> }
              </div>
            </div>
          }
          @if (!openReview() && manage()) { <button mat-flat-button (click)="createReview(p)">发起关口评审</button> }
        }

        @if (openReview(); as g) {
          @if (g.phaseId === p.id) {
            <h4>评审进行中</h4>
            @for (c of checklist(); track c.item) {
              @if (autoOf(c.item); as a) {
                <div><mat-checkbox [checked]="a.passed" [disabled]="true">{{ c.item }}</mat-checkbox> <span class="meta">系统判断：{{ a.detail }}</span></div>
              } @else {
                <div><mat-checkbox [checked]="c.passed" [disabled]="!canEdit()" (change)="toggle(c.item, $event.checked)">{{ c.item }}</mat-checkbox></div>
              }
            }
            @if (canEdit()) {
              <form [formGroup]="attendeeForm" class="row">
                <mat-form-field style="min-width: 320px">
                  <mat-label>出席者</mat-label>
                  <mat-select formControlName="attendees" multiple>
                    @for (m of members(); track m.userId) { <mat-option [value]="m.userId">{{ m.user?.name }}（{{ m.projectRole }}）</mat-option> }
                  </mat-select>
                </mat-form-field>
                <button mat-stroked-button type="button" (click)="saveReview(g)">保存清单与出席者</button>
              </form>
            }
            @if (p.mandatoryRoles.length) { <div class="meta">必选参与者：{{ roles(p.mandatoryRoles) }}</div> }
            @if (p.optionalRoles?.length) { <div class="meta">可选参与者：{{ roles(p.optionalRoles!) }}</div> }

            @if (readiness()?.priorOpenIssues?.length && project().permissions?.topManagement && !g.overrideAuthorizedById) {
              <button mat-button (click)="authorize(g)">最高管理层授权：带遗留问题通过</button>
            }
            @if (g.overrideAuthorizedById) { <div class="meta">已获最高管理层授权（{{ g.overrideReason }}）</div> }

            @if (manage()) {
              <form [formGroup]="decisionForm">
                <div class="row">
                  <mat-form-field>
                    <mat-label>评审结论</mat-label>
                    <mat-select formControlName="decision">
                      <mat-option value="APPROVED">通过</mat-option>
                      <mat-option value="CONDITIONAL">有条件通过（需行动计划）</mat-option>
                      <mat-option value="REJECTED">拒绝</mat-option>
                    </mat-select>
                  </mat-form-field>
                  <mat-form-field style="min-width: 320px"><mat-label>结论说明</mat-label><input matInput formControlName="note" /></mat-form-field>
                </div>
                <mat-form-field style="width: 100%"><mat-label>行动计划（每行一项）</mat-label><textarea matInput formControlName="actions"></textarea></mat-form-field>
                <button mat-flat-button type="button" (click)="decide(g)" [disabled]="decisionForm.invalid">记录评审结论</button>
              </form>
            }
          }
        }
      </div>
    }

    <h2>历史评审记录</h2>
    @for (g of decided(); track g.id) {
      <div class="phase">
        <strong>{{ phaseName(g.phaseId) }}</strong> · {{ decisionLabel(g) }} · {{ g.decidedAt | date: 'yyyy-MM-dd HH:mm' }}
        <div class="meta">{{ g.decisionNote }}{{ g.escalated ? '（已升级）' : '' }}{{ g.overrideAuthorizedById ? '（最高管理层授权通过）' : '' }}</div>
      </div>
    }
    @if (decided().length === 0) { <p>暂无已完成的评审。</p> }
  `,
})
export class ProjectGates {
  private readonly api = inject(Api);
  private readonly fb = inject(FormBuilder).nonNullable;
  readonly project = input.required<Project>();
  readonly status = STATUS;
  readonly phases = signal<Phase[]>([]);
  readonly reviews = signal<GateReview[]>([]);
  readonly members = signal<Member[]>([]);
  readonly readiness = signal<Readiness | null>(null);
  roles(rs: string[]) { return rs.map((r) => PROJECT_ROLE_LABELS[r as keyof typeof PROJECT_ROLE_LABELS] ?? r).join('、'); }
  readonly dlStatus = { PLANNED: '计划中', SUBMITTED: '已提交', ACCEPTED: '已接受', REJECTED: '被退回' } as const;
  readonly error = signal('');
  readonly checklist = signal<GateReview['checklistResults']>([]);
  readonly manage = computed(() => !!this.project().permissions?.manage);
  readonly canEdit = computed(() => !!(this.project().permissions?.manage || this.project().permissions?.quality));
  readonly openReview = computed(() => this.reviews().find((r) => r.status === 'OPEN') ?? null);
  readonly decided = computed(() => this.reviews().filter((r) => r.status === 'DECIDED'));
  readonly attendeeForm = this.fb.group({ attendees: [[] as string[]] });
  readonly decisionForm = this.fb.group({ decision: ['APPROVED'], note: [''] , actions: [''] });

  phaseName(id: string) { return this.phases().find((p) => p.id === id)?.name ?? ''; }
  /** 由系统按采购计划、FAI 记录判断的检查项 */
  autoOf(item: string): { passed: boolean; detail: string } | null {
    const c = ((this.readiness() as unknown as { checklist?: unknown })?.checklist as { item: string; passed: boolean; auto?: boolean; detail?: string }[] | undefined)?.find((x) => x.item === item && x.auto);
    return c ? { passed: c.passed, detail: c.detail ?? '' } : null;
  }
  decisionLabel(g: GateReview) { return g.decision ? DECISION_LABELS[g.decision] : ''; }

  async ngOnInit() {
    this.members.set(await this.api.get<Member[]>(`/projects/${this.project().id}/members`));
    await this.load();
  }

  async load() {
    const id = this.project().id;
    this.phases.set(await this.api.get<Phase[]>(`/projects/${id}/phases`));
    this.reviews.set(await this.api.get<GateReview[]>(`/projects/${id}/gate-reviews`));
    const active = this.phases().find((p) => p.status === 'ACTIVE');
    this.readiness.set(active ? await this.api.get<Readiness>(`/projects/${id}/phases/${active.id}/readiness`) : null);
    const open = this.openReview();
    if (open) {
      this.checklist.set(open.checklistResults);
      this.attendeeForm.patchValue({ attendees: open.attendees });
    }
  }

  private async run(fn: () => Promise<unknown>, fallback: string) {
    this.error.set('');
    try { await fn(); } catch (e) { this.error.set(errorMessage(e, fallback)); }
    await this.load();
  }

  toggle(item: string, passed: boolean) {
    this.checklist.update((list) => list.map((c) => (c.item === item ? { ...c, passed } : c)));
  }
  createReview(p: Phase) { return this.run(() => this.api.post(`/projects/${this.project().id}/phases/${p.id}/gate-reviews`), '发起失败'); }
  saveReview(g: GateReview) {
    return this.run(() => this.api.patch(`/projects/${this.project().id}/gate-reviews/${g.id}`, {
      checklistResults: this.checklist(), attendees: this.attendeeForm.getRawValue().attendees,
    }), '保存失败');
  }
  authorize(g: GateReview) {
    const reason = askText('请填写授权理由（将记入审计日志）');
    return reason && reason.length >= 5
      ? this.run(() => this.api.post(`/projects/${this.project().id}/gate-reviews/${g.id}/authorize-override`, { reason }), '授权失败')
      : Promise.resolve();
  }
  async decide(g: GateReview) {
    const v = this.decisionForm.getRawValue();
    const actions = v.actions.split('\n').map((s) => s.trim()).filter(Boolean).map((title) => ({ title }));
    // 先保存清单与出席者，再提交结论
    await this.saveReview(g);
    if (this.error()) return;
    await this.run(() => this.api.post(`/projects/${this.project().id}/gate-reviews/${g.id}/decision`, {
      decision: v.decision, note: v.note, actions: actions.length ? actions : undefined,
    }), '记录失败');
    if (!this.error()) this.decisionForm.reset({ decision: 'APPROVED', note: '', actions: '' });
  }
}
