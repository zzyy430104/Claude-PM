import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, inject, input, output, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { Api, errorMessage } from '../core/api';
import { I18n } from '../core/i18n';
import { Member, PROJECT_ROLE_LABELS, Performance, PlanVersion, Project, RISK_LABELS } from '../core/models';
import { TriangleComponent } from './triangle';

interface OrgNode { userId: string; reportsToUserId?: string | null }
interface Interfaces { workSplit?: string; interfaces?: string; channels?: string; processes?: string }
interface Plan {
  objectives: string; frameConditions: string; exclusions: string;
  responsibilities: string; executionRules: string; version: number;
  orgChart: OrgNode[]; interfaces: Interfaces;
}

@Component({
  selector: 'app-project-overview',
  imports: [NgTemplateOutlet, TriangleComponent, ReactiveFormsModule, MatButtonModule, MatFormFieldModule, MatInputModule, MatSelectModule],
  styles: `
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 8px 24px; margin: 0 0 20px; }
    dt { font-size: 12px; color: var(--pm-muted); } dd { margin: 0 0 4px; font-weight: 500; }
    .approve { border-left: 3px solid var(--pm-accent); }
    .approve h3 { margin: 0 0 6px; }
    .approve ul { margin: 6px 0 12px; padding-left: 20px; }
    .approve .btns { display: flex; gap: 8px; }
    .toolbar { display: flex; gap: 8px; flex-wrap: wrap; margin: 0 0 8px; }
    .org li { margin: 4px 0; } .org ul { list-style: none; padding-left: 20px; border-left: 1px solid var(--pm-line); margin: 4px 0 4px 6px; }
    .org > ul { border-left: 0; padding-left: 0; margin-left: 0; }
    .role { color: var(--pm-muted); font-size: 12px; margin-left: 6px; }
    .org-edit td { vertical-align: middle; }
    .ver td { vertical-align: top; }
    .hint { color: var(--pm-muted); font-size: 13px; margin: 0 0 8px; }
    .lvl { font: inherit; font-weight: 500; border: 1px solid #c5cfdb; border-radius: 6px; padding: 2px 6px; background: #fff; }
  `,
  template: `
    <app-triangle [perf]="perf()" />
    <dl class="grid panel">
      <div><dt>风险等级</dt><dd>{{ risk(project().riskLevel) }}（评审周期 {{ project().reviewIntervalDays }} 天）</dd></div>
      <div><dt>项目周期</dt><dd>{{ project().startDate.slice(0, 10) }} → {{ project().endDate.slice(0, 10) }}</dd></div>
      <div><dt>客户交期</dt><dd>{{ project().customerDeliveryDate?.slice(0, 10) ?? '—' }}</dd></div>
      <div><dt>预算</dt><dd>{{ project().budget ? (+project().budget!).toLocaleString() : '—' }}</dd></div>
      <div><dt>阶段评审起始 WBS 层级</dt><dd>
        @if (manage()) {
          <select class="lvl" [value]="project().gateReviewWbsLevel ?? 1" (change)="setLevel($any($event.target).value)" aria-label="阶段评审起始 WBS 层级">
            @for (l of [1, 2, 3, 4]; track l) { <option [value]="l">第 {{ l }} 级</option> }
          </select>
        } @else { 第 {{ project().gateReviewWbsLevel ?? 1 }} 级 }
      </dd></div>
    </dl>

    @if (!project().baselined && project().permissions?.manage) {
      <div class="panel approve">
        <h3>计划批准</h3>
        @if (!confirming()) {
          <p class="hint" style="margin: 0 0 10px">阶段、WBS、依赖、成员、预算都确认后，批准计划并启动项目。</p>
          <button mat-flat-button (click)="confirming.set(true)">批准计划并启动项目</button>
        } @else {
          <p style="margin: 0">批准后：</p>
          <ul>
            <li>项目状态变为“进行中”，第一个阶段开始；</li>
            <li>系统保存当前计划的快照（第 1 版），作为以后计划与实际对比的依据；</li>
            <li>新增或删除工作包和需求、修改预算、项目日期和客户交期，都必须先有已批准的变更申请；</li>
            <li>批准不能撤销。</li>
          </ul>
          <div class="btns">
            <button mat-flat-button (click)="approve()">确认批准</button>
            <button mat-button (click)="confirming.set(false)">取消</button>
          </div>
        }
      </div>
    }
    @if (error()) { <div class="error" role="alert">{{ error() }}</div> }
    @if (canExport()) { <div class="toolbar"><button mat-stroked-button (click)="exportPack()">导出审核证据包</button></div> }

    @if (versions().length) {
      <h2>计划批准版本</h2>
      <table class="ver">
        <thead><tr><th>版本</th><th>时间</th><th>原因</th><th>项目周期</th><th>客户交期</th><th>预算</th><th>工作包</th></tr></thead>
        <tbody>
          @for (v of versions(); track v.id) {
            <tr>
              <td>第 {{ v.version }} 版</td>
              <td>{{ v.createdAt.slice(0, 10) }}</td>
              <td>{{ v.note }}</td>
              <td>{{ v.snapshot.project.startDate }} → {{ v.snapshot.project.endDate }}</td>
              <td>{{ v.snapshot.project.customerDeliveryDate ?? '—' }}</td>
              <td>{{ v.snapshot.project.budget ? (+v.snapshot.project.budget).toLocaleString() : '—' }}</td>
              <td>{{ v.snapshot.workPackages.length }} 个</td>
            </tr>
          }
        </tbody>
      </table>
    }

    <h2>项目管理计划（第 {{ plan()?.version ?? 0 }} 版）</h2>
    <form [formGroup]="form" (ngSubmit)="save()">
      @for (f of fields; track f.key) {
        <mat-form-field style="width: 100%">
          <mat-label>{{ f.label }}</mat-label>
          <textarea matInput [formControlName]="f.key" [readonly]="!manage()"></textarea>
        </mat-form-field>
      }

      <h3>项目组织图</h3>
      <p class="hint">为每位成员指定向谁汇报，系统据此画出组织图。成员在「成员」标签里维护。</p>
      @if (manage()) {
        <table class="org-edit">
          <thead><tr><th>成员</th><th>项目角色</th><th>汇报给</th></tr></thead>
          <tbody>
            @for (m of members(); track m.userId) {
              <tr>
                <td>{{ m.user?.name }}</td>
                <td>{{ roleLabel(m) }}</td>
                <td>
                  <mat-select [value]="reportsTo(m.userId)" (selectionChange)="setReportsTo(m.userId, $event.value)" [attr.aria-label]="'汇报给 ' + m.user?.name" style="min-width: 160px">
                    <mat-option value="">（最高层）</mat-option>
                    @for (o of members(); track o.userId) { @if (o.userId !== m.userId) { <mat-option [value]="o.userId">{{ o.user?.name }}</mat-option> } }
                  </mat-select>
                </td>
              </tr>
            }
          </tbody>
        </table>
      }
      <div class="panel org">
        <ul>
          @for (n of tree(); track n.userId) {
            <ng-container *ngTemplateOutlet="node; context: { $implicit: n }" />
          }
        </ul>
        @if (members().length === 0) { <span class="hint">还没有项目成员。</span> }
      </div>
      <ng-template #node let-n>
        <li>{{ n.name }}<span class="role">{{ n.role }}</span>
          @if (n.children.length) {
            <ul>@for (c of n.children; track c.userId) { <ng-container *ngTemplateOutlet="node; context: { $implicit: c }" /> }</ul>
          }
        </li>
      </ng-template>

      <h3>多场地或联合体（如适用）</h3>
      <div formGroupName="interfaces">
        @for (f of interfaceFields; track f.key) {
          <mat-form-field style="width: 100%">
            <mat-label>{{ f.label }}</mat-label>
            <textarea matInput [formControlName]="f.key" [readonly]="!manage()"></textarea>
          </mat-form-field>
        }
      </div>
      @if (manage()) { <button mat-flat-button type="submit">保存计划</button> }
      @if (saved()) { <span> 已保存</span> }
    </form>
  `,
})
export class ProjectOverview {
  private readonly api = inject(Api);
  private readonly fb = inject(FormBuilder).nonNullable;
  readonly i18n = inject(I18n);
  readonly project = input.required<Project>();
  readonly canExport = () => { const p = this.project().permissions; return !!(p?.manage || p?.quality || p?.topManagement); };
  readonly manage = computed(() => !!this.project().permissions?.manage);
  readonly changed = output<void>();
  readonly plan = signal<Plan | null>(null);
  readonly members = signal<Member[]>([]);
  readonly versions = signal<PlanVersion[]>([]);
  readonly perf = signal<Performance | null>(null);
  readonly orgChart = signal<OrgNode[]>([]);
  readonly confirming = signal(false);
  readonly error = signal('');
  readonly saved = signal(false);
  readonly fields = [
    { key: 'objectives', label: '项目目标' },
    { key: 'frameConditions', label: '框架条件与假设' },
    { key: 'exclusions', label: '范围排除项' },
    { key: 'responsibilities', label: '职责与权限' },
    { key: 'executionRules', label: '项目执行规则' },
  ] as const;
  readonly interfaceFields = [
    { key: 'workSplit', label: '工作分工与运作接口' },
    { key: 'interfaces', label: '各方的职责与权限' },
    { key: 'channels', label: '沟通渠道（项目内部及与客户、相关方）' },
    { key: 'processes', label: '适用的过程和成文信息' },
  ] as const;
  readonly form = this.fb.group({
    objectives: [''], frameConditions: [''], exclusions: [''], responsibilities: [''], executionRules: [''],
    interfaces: this.fb.group({ workSplit: [''], interfaces: [''], channels: [''], processes: [''] }),
  });

  /** 按“汇报给”组成树；指向已不在项目里的人或形成环的，挂到最高层 */
  readonly tree = computed(() => {
    type N = { userId: string; name: string; role: string; children: N[] };
    const ms = this.members();
    const byId = new Map<string, N>(ms.map((m) => [m.userId, { userId: m.userId, name: m.user?.name ?? '', role: this.roleLabel(m), children: [] }]));
    const roots: N[] = [];
    for (const m of ms) {
      const n = byId.get(m.userId)!;
      let boss = this.reportsTo(m.userId);
      const seen = new Set([m.userId]);
      let cur = boss;
      while (cur && !seen.has(cur)) { seen.add(cur); cur = this.reportsTo(cur); }
      if (cur) boss = '';
      const parent = boss ? byId.get(boss) : undefined;
      (parent ? parent.children : roots).push(n);
    }
    return roots;
  });

  risk(r: Project['riskLevel']) { return RISK_LABELS[r]; }
  roleLabel(m: Member) { return this.i18n.t(PROJECT_ROLE_LABELS[m.projectRole]); }
  reportsTo(userId: string) { return this.orgChart().find((n) => n.userId === userId)?.reportsToUserId ?? ''; }
  setReportsTo(userId: string, boss: string) {
    this.orgChart.update((o) => [...o.filter((n) => n.userId !== userId), { userId, reportsToUserId: boss || null }]);
  }

  async ngOnInit() {
    const id = this.project().id;
    const [plan, members, versions] = await Promise.all([
      this.api.get<Plan>(`/projects/${id}/plan`),
      this.api.get<Member[]>(`/projects/${id}/members`),
      this.api.get<PlanVersion[]>(`/projects/${id}/plan-versions`),
    ]);
    this.plan.set(plan);
    this.members.set(members.filter((m) => m.active));
    this.versions.set(versions);
    this.orgChart.set(Array.isArray(plan.orgChart) ? plan.orgChart : []);
    this.perf.set(await this.api.get<Performance>(`/projects/${id}/performance`));
    this.form.patchValue({ ...plan, interfaces: plan.interfaces ?? {} });
  }

  async approve() {
    this.error.set('');
    try {
      await this.api.post(`/projects/${this.project().id}/baseline`);
      this.confirming.set(false);
      this.versions.set(await this.api.get<PlanVersion[]>(`/projects/${this.project().id}/plan-versions`));
      this.perf.set(await this.api.get<Performance>(`/projects/${this.project().id}/performance`));
      this.changed.emit();
    } catch (e) {
      this.error.set(errorMessage(e, '批准计划失败'));
    }
  }

  async setLevel(level: string) {
    this.error.set('');
    try {
      await this.api.patch(`/projects/${this.project().id}`, { gateReviewWbsLevel: Number(level) });
      this.changed.emit();
    } catch (e) {
      this.error.set(errorMessage(e, '保存失败'));
    }
  }

  async exportPack() {
    this.error.set('');
    try {
      await this.api.download(`/projects/${this.project().id}/evidence-pack`, `evidence-${this.project().code}.zip`);
    } catch (e) {
      this.error.set(errorMessage(e, '导出失败'));
    }
  }

  async save() {
    this.error.set('');
    this.saved.set(false);
    try {
      this.plan.set(await this.api.put<Plan>(`/projects/${this.project().id}/plan`, { ...this.form.getRawValue(), orgChart: this.orgChart() }));
      this.saved.set(true);
    } catch (e) {
      this.error.set(errorMessage(e, '保存失败'));
    }
  }
}
