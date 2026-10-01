import { Component, computed, inject, input, signal } from '@angular/core';
import { askText } from '../core/i18n';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { Discussion } from './discussion';
import { Api, errorMessage } from '../core/api';
import { AuthService } from '../core/auth.service';
import { Member, NC_SEVERITY_LABELS, NC_SOURCE_LABELS, NC_STATUS_LABELS, Nonconformity, Project, QualityPlan } from '../core/models';

const NEXT: Record<string, { to: string; label: string }> = {
  OPEN: { to: 'ANALYSIS', label: '开始原因分析' },
  ANALYSIS: { to: 'ACTION', label: '进入措施执行' },
  ACTION: { to: 'VERIFICATION', label: '措施完成，提交验证' },
  VERIFICATION: { to: 'CLOSED', label: '验证有效并关闭' },
};

@Component({
  selector: 'app-project-quality',
  imports: [Discussion, ReactiveFormsModule, MatButtonModule, MatFormFieldModule, MatInputModule, MatSelectModule],
  styles: `.box { border: 1px solid var(--mat-sys-outline-variant); border-radius: 8px; padding: 12px 16px; margin: 12px 0; } .meta { font-size: 13px; color: var(--mat-sys-on-surface-variant); } .bad { color: var(--mat-sys-error); }`,
  template: `
    @if (error()) { <div class="error" role="alert">{{ error() }}</div> }
    @if (part() !== 'nc') {
    <h2>项目质量计划（第 {{ plan()?.version ?? 0 }} 版{{ plan()?.approvedAt ? '，已批准' : '，未批准' }}）</h2>
    <form [formGroup]="planForm">
      <mat-form-field style="width: 100%"><mat-label>质量目标</mat-label><textarea matInput formControlName="objectives" [readonly]="!canPlan()"></textarea></mat-form-field>
      <mat-form-field style="width: 100%"><mat-label>项目专用程序 / 表单</mat-label><textarea matInput formControlName="procedures" [readonly]="!canPlan()"></textarea></mat-form-field>
      <mat-form-field style="width: 100%"><mat-label>质量活动（每行：QA 或 QC | 名称 | 频次）</mat-label><textarea matInput rows="4" formControlName="activities" [readonly]="!canPlan()" placeholder="QA | 过程审核 | 每月&#10;QC | 焊缝无损检测 | 每批"></textarea></mat-form-field>
      @if (canPlan()) { <button mat-flat-button type="button" (click)="savePlan()">保存计划</button> }
      @if (quality() && plan() && plan()!.version > 0 && !plan()!.approvedAt) { <button mat-stroked-button type="button" (click)="approve()">质量经理批准</button> }
    </form>

    }
    @if (part() !== 'plan') {
    <h2>不符合项 / 整改（CAR）</h2>
    <form class="row" [formGroup]="ncForm" (ngSubmit)="addNc()">
      <mat-form-field style="min-width: 240px"><mat-label>标题</mat-label><input matInput formControlName="title" /></mat-form-field>
      <mat-form-field><mat-label>严重程度</mat-label><mat-select formControlName="severity">@for (k of severities; track k) { <mat-option [value]="k">{{ sevLabels[k] }}</mat-option> }</mat-select></mat-form-field>
      <mat-form-field><mat-label>来源</mat-label><mat-select formControlName="source">@for (k of sources; track k) { <mat-option [value]="k">{{ srcLabels[k] }}</mat-option> }</mat-select></mat-form-field>
      <mat-form-field style="min-width: 320px"><mat-label>描述</mat-label><input matInput formControlName="description" /></mat-form-field>
      <button mat-flat-button type="submit" [disabled]="ncForm.invalid">登记不符合项</button>
    </form>
    @for (n of ncs(); track n.id) {
      <div class="box">
        <strong>{{ n.code }} · {{ n.title }}</strong>
        <span [class.bad]="n.severity !== 'MINOR'"> {{ sevLabels[n.severity] }}</span> · {{ srcLabels[n.source] }} · {{ statusLabels[n.status] }}
        <div class="meta">{{ n.description }}</div>
        @if (n.containment) { <div class="meta">遏制措施：{{ n.containment }}</div> }
        @if (n.rootCause) { <div class="meta">根本原因：{{ n.rootCause }}</div> }
        @if (n.correctiveAction) { <div class="meta">纠正措施：{{ n.correctiveAction }}（负责人 {{ owner(n) }}，期限 {{ n.actionDueDate?.slice(0, 10) ?? '—' }}）</div> }
        @if (n.effectivenessNote) { <div class="meta">有效性验证：{{ n.effectivenessNote }}</div> }
        @if (n.status !== 'CLOSED' && canEditNc(n)) {
          <form class="row" [formGroup]="ncEdit" (ngSubmit)="saveNc(n)">
            <mat-form-field><mat-label>遏制措施</mat-label><input matInput formControlName="containment" /></mat-form-field>
            <mat-form-field><mat-label>根本原因</mat-label><input matInput formControlName="rootCause" /></mat-form-field>
            <mat-form-field><mat-label>纠正措施</mat-label><input matInput formControlName="correctiveAction" /></mat-form-field>
            <mat-form-field><mat-label>措施负责人</mat-label><mat-select formControlName="actionOwnerId"><mat-option value="">未指定</mat-option>@for (m of members(); track m.userId) { <mat-option [value]="m.userId">{{ m.user?.name }}</mat-option> }</mat-select></mat-form-field>
            <mat-form-field><mat-label>完成期限</mat-label><input matInput type="date" formControlName="actionDueDate" /></mat-form-field>
            <button mat-stroked-button type="submit">保存</button>
          </form>
        }
        @if (n.status !== 'CLOSED') {
          @if (next(n); as nx) { <button mat-button (click)="move(n, nx.to)">{{ nx.label }}</button> }
          @if (n.status === 'VERIFICATION') { <button mat-button (click)="move(n, 'ACTION', true)">措施无效，退回</button> }
        }
        <button mat-button (click)="toggleTalk(n.id)">{{ talkLabel(n.id) }}</button>
        @if (talk() === n.id) { <app-discussion [projectId]="project().id" entityType="NONCONFORMITY" [entityId]="n.id" [canPost]="project().status !== 'CLOSED'" /> }
      </div>
    }
    @if (ncs().length === 0) { <p>暂无不符合项。</p> }
    }
  `,
})
export class ProjectQuality {
  private readonly api = inject(Api);
  private readonly auth = inject(AuthService);
  private readonly fb = inject(FormBuilder).nonNullable;
  readonly project = input.required<Project>();
  /** 展开讨论的对象，以及各对象的讨论条数 */
  readonly talk = signal<string | null>(null);
  readonly talkCounts = signal<Record<string, number>>({});
  talkLabel(id: string) { const n = this.talkCounts()[id]; return n ? `讨论 (${n})` : '讨论'; }
  toggleTalk(id: string) { this.talk.set(this.talk() === id ? null : id); void this.loadTalk(); }
  async loadTalk() { try { this.talkCounts.set(await this.api.get<Record<string, number>>(`/projects/${this.project().id}/comment-counts?type=NONCONFORMITY`)); } catch { /* 忽略 */ } }
  /** plan：只显示质量计划（质量策划页）；nc：只显示不符合项；all：都显示 */
  readonly part = input<'all' | 'plan' | 'nc'>('all');
  readonly plan = signal<QualityPlan | null>(null);
  readonly ncs = signal<Nonconformity[]>([]);
  readonly members = signal<Member[]>([]);
  readonly error = signal('');
  readonly severities = Object.keys(NC_SEVERITY_LABELS) as (keyof typeof NC_SEVERITY_LABELS)[];
  readonly sources = Object.keys(NC_SOURCE_LABELS) as (keyof typeof NC_SOURCE_LABELS)[];
  readonly sevLabels = NC_SEVERITY_LABELS;
  readonly srcLabels = NC_SOURCE_LABELS;
  readonly statusLabels = NC_STATUS_LABELS;
  readonly quality = computed(() => !!this.project().permissions?.quality);
  readonly canPlan = computed(() => !!(this.project().permissions?.manage || this.project().permissions?.quality));
  readonly planForm = this.fb.group({ objectives: [''], procedures: [''], activities: [''] });
  readonly ncForm = this.fb.group({ title: ['', [Validators.required, Validators.minLength(2)]], severity: ['MINOR'], source: ['INSPECTION'], description: ['', Validators.required] });
  readonly ncEdit = this.fb.group({ containment: [''], rootCause: [''], correctiveAction: [''], actionOwnerId: [''], actionDueDate: [''] });

  next(n: Nonconformity) { return NEXT[n.status]; }
  owner(n: Nonconformity) { return this.members().find((m) => m.userId === n.actionOwnerId)?.user?.name ?? '—'; }
  canEditNc(n: Nonconformity) { return this.canPlan() || n.actionOwnerId === this.auth.user()?.id; }

  async ngOnInit() {
    this.members.set(await this.api.get<Member[]>(`/projects/${this.project().id}/members`));
    await this.load();
  }
  async load() {
    void this.loadTalk();
    const id = this.project().id;
    const plan = await this.api.get<QualityPlan>(`/projects/${id}/quality-plan`);
    this.plan.set(plan);
    this.planForm.patchValue({
      objectives: plan.objectives, procedures: plan.procedures,
      activities: plan.activities.map((a) => `${a.kind} | ${a.name} | ${a.frequency ?? ''}`).join('\n'),
    });
    this.ncs.set(await this.api.get<Nonconformity[]>(`/projects/${id}/nonconformities`));
  }
  private async run(fn: () => Promise<unknown>, fallback: string) {
    this.error.set('');
    try { await fn(); } catch (e) { this.error.set(errorMessage(e, fallback)); }
    await this.load();
  }
  savePlan() {
    const v = this.planForm.getRawValue();
    const activities = v.activities.split('\n').map((l) => l.trim()).filter(Boolean).map((line) => {
      const [kind, name, frequency] = line.split('|').map((x) => x.trim());
      return { kind: kind === 'QC' ? 'QC' : 'QA', name, frequency: frequency || undefined };
    });
    return this.run(() => this.api.put(`/projects/${this.project().id}/quality-plan`, { objectives: v.objectives, procedures: v.procedures, activities }), '保存失败');
  }
  approve() { return this.run(() => this.api.post(`/projects/${this.project().id}/quality-plan/approve`), '批准失败'); }
  addNc() {
    return this.run(async () => {
      await this.api.post(`/projects/${this.project().id}/nonconformities`, this.ncForm.getRawValue());
      this.ncForm.reset({ title: '', severity: 'MINOR', source: 'INSPECTION', description: '' });
    }, '登记失败');
  }
  saveNc(n: Nonconformity) {
    const v = this.ncEdit.getRawValue();
    const body = Object.fromEntries(Object.entries(v).filter(([, x]) => x));
    return this.run(() => this.api.patch(`/projects/${this.project().id}/nonconformities/${n.id}`, body), '保存失败');
  }
  move(n: Nonconformity, to: string, needNote = false) {
    const note = to === 'CLOSED' || needNote ? askText(to === 'CLOSED' ? '有效性验证结论' : '退回原因') : undefined;
    if ((to === 'CLOSED' || needNote) && !note?.trim()) return Promise.resolve();
    return this.run(() => this.api.post(`/projects/${this.project().id}/nonconformities/${n.id}/transition`, { to, note }), '操作失败');
  }
}
