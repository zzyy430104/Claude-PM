import { Component, computed, inject, input, signal } from '@angular/core';
import { askText } from '../core/i18n';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { DatePipe } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { Discussion } from './discussion';
import { AiMark } from './ai-mark';
import { Ai } from '../core/ai';
import { Api, errorMessage } from '../core/api';
import { AuthService } from '../core/auth.service';
import { CHANGE_STATUS_LABELS, CHANGE_TYPE_LABELS, ChangeRequest, ChangeType, Project } from '../core/models';

interface HistoryRow { id: string; action: string; createdAt: string; actorId: string | null }

@Component({
  selector: 'app-project-changes',
  imports: [Discussion, AiMark, ReactiveFormsModule, DatePipe, MatButtonModule, MatFormFieldModule, MatInputModule, MatSelectModule],
  styles: `.cr { border: 1px solid var(--mat-sys-outline-variant); border-radius: 8px; padding: 12px 16px; margin: 12px 0; } h3 { margin: 0 0 4px; } .meta { color: var(--mat-sys-on-surface-variant); font-size: 13px; } .hist { font-size: 12px; color: var(--mat-sys-on-surface-variant); }`,
  template: `
    @if (!formOpen()) {
      <button mat-flat-button type="button" (click)="formOpen.set(true)" style="margin: 0 0 12px">+ 提交变更申请</button>
    } @else {
    <h2>{{ editingId() ? '编辑草稿 ' + editingCode() : '提交变更申请' }}</h2>
    <form [formGroup]="form" (ngSubmit)="save()">
      <div class="row">
        <mat-form-field><mat-label>类型</mat-label>
          <mat-select formControlName="type">@for (t of types; track t) { <mat-option [value]="t">{{ typeLabels[t] }}</mat-option> }</mat-select>
        </mat-form-field>
        <mat-form-field style="min-width: 260px"><mat-label>标题</mat-label><input matInput formControlName="title" /></mat-form-field>
        @if (form.controls.type.value === 'BUDGET') { <mat-form-field><mat-label>新预算</mat-label><input matInput type="number" formControlName="budget" /></mat-form-field> }
        @if (form.controls.type.value === 'DELIVERY_DATE') { <mat-form-field><mat-label>新客户交期</mat-label><input matInput type="date" formControlName="customerDeliveryDate" /></mat-form-field> }
        @if (form.controls.type.value === 'SCHEDULE') { <mat-form-field><mat-label>新结束日期</mat-label><input matInput type="date" formControlName="endDate" /></mat-form-field> }
      </div>
      <mat-form-field style="width: 100%"><mat-label>变更内容</mat-label><textarea matInput formControlName="description"></textarea></mat-form-field>
      <mat-form-field style="width: 100%"><mat-label>变更原因</mat-label><textarea matInput formControlName="reason"></textarea></mat-form-field>
      <mat-form-field style="width: 100%"><mat-label>影响分析（含风险与机会）</mat-label><textarea matInput formControlName="impactAnalysis"></textarea></mat-form-field>
      @if (ai.on('ANALYSIS')) { <button mat-button type="button" [disabled]="aiBusy() || !form.controls.description.value" (click)="aiImpact()" style="margin: -8px 0 8px"><span class="pill blue">AI</span> {{ aiBusy() ? '正在起草…' : '起草影响分析' }}</button> }
      <mat-form-field style="width: 100%"><mat-label>原因分析（由故障引起时必填）</mat-label><textarea matInput formControlName="causeAnalysis"></textarea></mat-form-field>
      <label><input type="checkbox" formControlName="triggeredByFailure" /> 由故障 / 不合格引起</label>
      @if (form.controls.type.value === 'TECHNICAL') {
        <div class="row">
          <mat-form-field><mat-label>对已交付部件的影响</mat-label><input matInput formControlName="deliveredParts" /></mat-form-field>
          <mat-form-field><mat-label>对客户规格与配置的影响</mat-label><input matInput formControlName="customerSpec" /></mat-form-field>
          <mat-form-field><mat-label>需更新的文件</mat-label><input matInput formControlName="documents" /></mat-form-field>
          <mat-form-field><mat-label>技术要求再评估</mat-label><input matInput formControlName="requirements" /></mat-form-field>
          <mat-form-field><mat-label>再验证活动</mat-label><input matInput formControlName="revalidation" /></mat-form-field>
        </div>
      }
      <button mat-flat-button type="submit" [disabled]="form.invalid">{{ editingId() ? '保存草稿' : '保存为草稿' }}</button>
      @if (editingId()) { <button mat-button type="button" (click)="cancelEdit()">取消编辑</button> }
      @else if (phone) { <button mat-button type="button" (click)="formOpen.set(false)">收起</button> }
    </form>
    }
    @if (error()) { <div class="error" role="alert">{{ error() }}</div> }

    <h2>变更申请</h2>
    @for (c of rows(); track c.id) {
      <div class="cr">
        <h3>{{ c.code }} · {{ c.title }}（{{ typeLabels[c.type] }}）— {{ statusLabels[c.status] }} <app-ai-mark entity="CHANGE" [id]="c.id" /></h3>
        <div class="meta">{{ c.description }}｜原因：{{ c.reason }}</div>
        @if (c.impactAnalysis) { <div class="meta">影响分析：{{ c.impactAnalysis }}</div> }
        @if (c.proposed) { <div class="meta">拟变更：{{ proposed(c) }}</div> }
        @if (c.type === 'DELIVERY_DATE') {
          <div class="meta">已通知客户：{{ c.customerNotifiedAt ? (c.customerNotifiedAt | date: 'yyyy-MM-dd') : '否' }}；客户同意：{{ c.customerAgreedAt ? (c.customerAgreedAt | date: 'yyyy-MM-dd') : '否' }}</div>
        }
        @if (c.decisionNote) { <div class="meta">审批意见：{{ c.decisionNote }}</div> }
        @if (c.effectivenessNote) { <div class="meta">有效性验证：{{ c.effectivenessNote }}</div> }
        <div>
          @if (c.status === 'DRAFT' && (c.requestedById === me()?.id || manage())) { <button mat-button (click)="edit(c)">编辑</button><button mat-button (click)="act(c, 'submit')">提交审批</button> }
          @if (c.status === 'SUBMITTED' || c.status === 'APPROVED') {
            @if (manage() && c.type === 'DELIVERY_DATE') {
              <button mat-button (click)="act(c, 'customer-contact', {})">记录已通知客户</button>
              <button mat-button (click)="act(c, 'customer-contact', { agreed: true })">记录客户已同意</button>
            }
          }
          @if (c.status === 'SUBMITTED' && canApprove(c)) {
            <button mat-button (click)="act(c, 'approve', {})">批准</button>
            <button mat-button (click)="reject(c)">驳回</button>
          }
          @if (c.status === 'APPROVED' && manage()) { <button mat-button (click)="act(c, 'implement')">实施</button> }
          @if (c.status === 'IMPLEMENTED' && (manage() || quality()) && c.implementedById !== me()?.id) { <button mat-button (click)="verify(c)">验证有效性</button> }
          @if (c.status === 'VERIFIED' && manage()) { <button mat-button (click)="act(c, 'close')">关闭</button> }
          <button mat-button (click)="toggleHistory(c)">{{ history()[c.id] ? '收起记录' : '变更记录' }}</button>
          <button mat-button (click)="toggleTalk(c.id)">{{ talkLabel(c.id) }}</button>
        </div>
        @if (talk() === c.id) { <app-discussion [projectId]="project().id" entityType="CHANGE" [entityId]="c.id" [canPost]="project().status !== 'CLOSED'" /> }
        @if (history()[c.id]; as h) {
          @for (x of h; track x.id) { <div class="hist">{{ x.createdAt | date: 'yyyy-MM-dd HH:mm' }} · {{ x.action }}</div> }
        }
      </div>
    }
    @if (rows().length === 0) { <p>暂无变更申请。</p> }
  `,
})
export class ProjectChanges {
  private readonly api = inject(Api);
  private readonly auth = inject(AuthService);
  private readonly fb = inject(FormBuilder).nonNullable;
  readonly project = input.required<Project>();
  /** 展开讨论的对象，以及各对象的讨论条数 */
  readonly talk = signal<string | null>(null);
  readonly talkCounts = signal<Record<string, number>>({});
  talkLabel(id: string) { const n = this.talkCounts()[id]; return n ? `讨论 (${n})` : '讨论'; }
  toggleTalk(id: string) { this.talk.set(this.talk() === id ? null : id); void this.loadTalk(); }
  async loadTalk() { try { this.talkCounts.set(await this.api.get<Record<string, number>>(`/projects/${this.project().id}/comment-counts?type=CHANGE`)); } catch { /* 忽略 */ } }
  readonly types = Object.keys(CHANGE_TYPE_LABELS) as ChangeType[];
  readonly typeLabels = CHANGE_TYPE_LABELS;
  readonly statusLabels = CHANGE_STATUS_LABELS;
  readonly rows = signal<ChangeRequest[]>([]);
  readonly history = signal<Record<string, HistoryRow[]>>({});
  readonly error = signal('');
  readonly me = this.auth.user;
  readonly manage = computed(() => !!this.project().permissions?.manage);
  readonly quality = computed(() => !!this.project().permissions?.quality);
  /** 手机上默认收起申请表，先看到待审批的变更；电脑上直接展开 */
  readonly phone = window.matchMedia('(max-width: 760px)').matches;
  readonly formOpen = signal(!this.phone);
  readonly editingId = signal<string | null>(null);
  readonly editingCode = signal('');
  readonly form = this.fb.group({
    type: ['SCOPE' as ChangeType], title: ['', [Validators.required, Validators.minLength(2)]],
    description: ['', Validators.required], reason: ['', Validators.required],
    impactAnalysis: [''], causeAnalysis: [''], triggeredByFailure: [false],
    budget: [null as number | null], customerDeliveryDate: [''], endDate: [''],
    deliveredParts: [''], customerSpec: [''], documents: [''], requirements: [''], revalidation: [''],
  });

  canApprove(c: ChangeRequest) {
    const p = this.project().permissions;
    return !!(p?.ccb || p?.topManagement) && c.requestedById !== this.me()?.id;
  }
  proposed(c: ChangeRequest) {
    const p = c.proposed ?? {};
    return [p.budget !== undefined && `预算 ${p.budget}`, p.customerDeliveryDate && `客户交期 ${p.customerDeliveryDate}`, p.startDate && `开始 ${p.startDate}`, p.endDate && `结束 ${p.endDate}`].filter(Boolean).join('，');
  }

  async ngOnInit() { await this.load(); }
  async load() {
    void this.loadTalk(); this.rows.set(await this.api.get<ChangeRequest[]>(`/projects/${this.project().id}/changes`)); }

  private async run(fn: () => Promise<unknown>, fallback: string) {
    this.error.set('');
    try { await fn(); } catch (e) { this.error.set(errorMessage(e, fallback)); }
    await this.load();
  }

  private readonly blank = { type: 'SCOPE' as ChangeType, title: '', description: '', reason: '', impactAnalysis: '', causeAnalysis: '', triggeredByFailure: false, budget: null as number | null, customerDeliveryDate: '', endDate: '', deliveredParts: '', customerSpec: '', documents: '', requirements: '', revalidation: '' };

  /** 草稿提交前可以修改；类型不能改（改类型请另建申请） */
  edit(c: ChangeRequest) {
    const t = c.technicalImpact ?? {};
    this.editingId.set(c.id);
    this.editingCode.set(c.code);
    this.formOpen.set(true);
    this.form.reset({
      type: c.type, title: c.title, description: c.description, reason: c.reason,
      impactAnalysis: c.impactAnalysis ?? '', causeAnalysis: c.causeAnalysis ?? '', triggeredByFailure: c.triggeredByFailure,
      budget: c.proposed?.budget ?? null, customerDeliveryDate: c.proposed?.customerDeliveryDate ?? '', endDate: c.proposed?.endDate ?? '',
      deliveredParts: t.deliveredParts ?? '', customerSpec: t.customerSpec ?? '', documents: t.documents ?? '', requirements: t.requirements ?? '', revalidation: t.revalidation ?? '',
    });
    this.form.controls.type.disable();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  readonly ai = inject(Ai);
  readonly aiBusy = signal(false);
  private pendingAi: string | null = null;
  /** AI 根据变更内容和原因起草影响分析，填入表单待确认 */
  async aiImpact() {
    const v = this.form.getRawValue();
    this.aiBusy.set(true); this.error.set('');
    try {
      const d = await this.ai.draft<{ impactAnalysis: string }>('ANALYSIS', { kind: 'CHANGE', record: { 类型: this.typeLabels[v.type], 标题: v.title, 内容: v.description, 原因: v.reason, 新预算: v.budget, 新客户交期: v.customerDeliveryDate, 新结束日期: v.endDate } }, this.project().id);
      this.form.patchValue({ impactAnalysis: d.draft.impactAnalysis });
      this.pendingAi = d.usageId;
    } catch (e) { this.error.set(errorMessage(e, 'AI 起草失败')); } finally { this.aiBusy.set(false); }
  }

  cancelEdit() {
    if (this.phone) this.formOpen.set(false);
    this.editingId.set(null);
    this.form.controls.type.enable();
    this.form.reset(this.blank);
  }

  save() {
    const v = this.form.getRawValue();
    const proposed = {
      ...(v.type === 'BUDGET' && v.budget !== null ? { budget: v.budget } : {}),
      ...(v.type === 'DELIVERY_DATE' && v.customerDeliveryDate ? { customerDeliveryDate: v.customerDeliveryDate } : {}),
      ...(v.type === 'SCHEDULE' && v.endDate ? { endDate: v.endDate } : {}),
    };
    const technicalImpact = v.type === 'TECHNICAL'
      ? { deliveredParts: v.deliveredParts, customerSpec: v.customerSpec, documents: v.documents, requirements: v.requirements, revalidation: v.revalidation }
      : undefined;
    const body = {
      title: v.title, description: v.description, reason: v.reason,
      impactAnalysis: v.impactAnalysis || undefined, causeAnalysis: v.causeAnalysis || undefined,
      triggeredByFailure: v.triggeredByFailure, proposed: Object.keys(proposed).length ? proposed : undefined, technicalImpact,
    };
    const id = this.editingId();
    return this.run(async () => {
      const saved = id ? await this.api.patch<{ id: string }>(`/projects/${this.project().id}/changes/${id}`, body) : await this.api.post<{ id: string }>(`/projects/${this.project().id}/changes`, { ...body, type: v.type });
      if (this.pendingAi) { await this.ai.adopt(this.pendingAi, true, 'CHANGE', saved?.id ?? id ?? undefined); this.pendingAi = null; }
      this.cancelEdit();
    }, '保存失败');
  }

  act(c: ChangeRequest, action: string, body: unknown = {}) {
    return this.run(() => this.api.post(`/projects/${this.project().id}/changes/${c.id}/${action}`, body), '操作失败');
  }
  async reject(c: ChangeRequest) {
    const note = await askText('驳回原因');
    return note?.trim() ? this.act(c, 'reject', { note }) : Promise.resolve();
  }
  async verify(c: ChangeRequest) {
    const note = await askText('有效性验证结论');
    return note?.trim() ? this.act(c, 'verify', { note }) : Promise.resolve();
  }
  async toggleHistory(c: ChangeRequest) {
    const cur = this.history();
    if (cur[c.id]) { const { [c.id]: _drop, ...rest } = cur; this.history.set(rest); return; }
    this.history.set({ ...cur, [c.id]: await this.api.get<HistoryRow[]>(`/projects/${this.project().id}/changes/${c.id}/history`) });
  }
}
