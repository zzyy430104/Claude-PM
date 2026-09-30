import { Component, computed, inject, input, signal } from '@angular/core';
import { FormBuilder, FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { Api, errorMessage } from '../core/api';
import { askText } from '../core/i18n';
import { AuthService } from '../core/auth.service';
import {
  ChangeRequest, CostSummary, Deliverable, Member, Performance, Phase, PlanVersion, Project, WbsTemplate, WP_STATUS_LABELS, WbsResponse, WorkPackage, WpStatus,
} from '../core/models';
import { approvedScopeChanges } from '../core/scope-change';
import { BaselineDates, GanttComponent } from './gantt';

const COLUMNS: WpStatus[] = ['NOT_STARTED', 'IN_PROGRESS', 'DONE', 'VERIFIED'];

@Component({
  selector: 'app-project-wbs',
  imports: [ReactiveFormsModule, MatButtonModule, MatButtonToggleModule, MatCheckboxModule, MatFormFieldModule, MatInputModule, MatSelectModule, GanttComponent],
  styles: `
    .crit-name { color: var(--pm-red); font-weight: 500; }
    .tags { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 4px; }
    .tag { font-size: 11.5px; padding: 1px 8px; border-radius: 999px; background: #e9edf3; color: var(--pm-muted); white-space: nowrap; }
    .tag.ext { background: #e3eefa; color: #2a5d8f; }
    .tag.late { background: var(--pm-red-bg); color: var(--pm-red); }
    .tag.lead { background: var(--pm-amber-bg); color: var(--pm-amber); }
    .board { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
    .col { border-radius: 8px; padding: 8px; min-height: 120px; }
    .card { padding: 8px; margin: 6px 0; font-size: 13px; }
    .summary { margin: 0 0 12px; }
    .warn { color: var(--pm-red); }
    .pct { width: 64px; height: 30px; border: 1px solid #c5cfdb; border-radius: 6px; padding: 0 8px; font: inherit; text-align: right; }
    .pct:focus { outline: 2px solid var(--pm-accent); outline-offset: -1px; }
    .actions { white-space: nowrap; text-align: right; }
    .actions button { min-width: 0; padding: 0 8px; }
    .danger { color: var(--pm-red) !important; }
    .scope-cr { background: #eef3f9; border: 1px solid #cfdbea; border-radius: var(--pm-radius); padding: 10px 16px 0; margin: 0 0 12px; }
    .scope-cr p { margin: 0 0 6px; font-size: 13px; }
    .form-title { font-weight: 600; width: 100%; margin: 0 0 4px; }
    .num { text-align: right !important; }
    .tools { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin: 0 0 12px; }
    .tools .sep { width: 1px; height: 24px; background: var(--pm-line); margin: 0 4px; }
    .tpl { height: 36px; border: 1px solid #c5cfdb; border-radius: 8px; padding: 0 8px; font: inherit; background: #fff; }
    .ok-box { background: var(--pm-green-bg); color: var(--pm-green); border-radius: 8px; padding: 8px 12px; margin: 0 0 12px; }
    .error ul { margin: 6px 0 0; padding-left: 18px; }
    .nw { white-space: nowrap; }
    .dates { white-space: nowrap; font-size: 12.5px; }
  `,
  template: `
    @if (data(); as d) {
      <p class="summary">
        总工期 {{ d.projectDurationDays }} 天，预计完成 {{ d.projectedEnd }}
        @if (d.exceedsPlannedEnd) { <span class="warn">（超出项目计划结束日 {{ project().endDate.slice(0, 10) }}）</span> }
      </p>
    }
    @if (error()) { <div class="error" role="alert">{{ error() }}</div> }

    @if (manage() && project().baselined) {
      <div class="scope-cr">
        <p>计划已批准：新增或删除工作包需要引用一项已批准的范围变更。</p>
        <mat-form-field style="min-width: 320px">
          <mat-label>依据的范围变更</mat-label>
          <mat-select [formControl]="crControl">
            <mat-option value="">（不引用）</mat-option>
            @for (c of scopeChanges(); track c.id) { <mat-option [value]="c.id">{{ c.code }} {{ c.title }}</mat-option> }
          </mat-select>
          @if (scopeChanges().length === 0) { <mat-hint>暂无已批准的范围变更，请先在「变更控制」里提交并获批</mat-hint> }
        </mat-form-field>
      </div>
    }

    <div class="tools">
      <button mat-stroked-button type="button" (click)="exportExcel()">导出 Excel</button>
      @if (manage()) {
        <button mat-stroked-button type="button" (click)="templateExcel()">下载导入模板</button>
        <button mat-stroked-button type="button" (click)="fileInput.click()">导入 Excel</button>
        <input #fileInput type="file" accept=".xlsx" hidden (change)="importExcel($any($event.target))" aria-label="选择 Excel 文件" />
        <span class="sep"></span>
        <select class="tpl" [value]="''" (change)="applyTemplate($any($event.target))" aria-label="从 WBS 模板添加">
          <option value="">从 WBS 模板添加…</option>
          @for (t of wbsTemplates(); track t.id) { <option [value]="t.id">{{ t.name }}（{{ t.items.length }} 项）</option> }
        </select>
        <button mat-button type="button" (click)="saveAsTemplate()">另存为 WBS 模板</button>
      }
    </div>
    @if (importResult(); as r) { <div class="ok-box" role="status">导入完成：新增 {{ r.created }} 个、更新 {{ r.updated }} 个工作包，新增 {{ r.dependencies }} 个依赖。</div> }
    @if (importErrors().length) {
      <div class="error" role="alert">
        导入失败，表格没有写入任何数据。请修改后重新导入：
        <ul>@for (e of importErrors(); track e) { <li>{{ e }}</li> }</ul>
      </div>
    }

    @if (manage()) {
      <form class="row" [formGroup]="wpForm" (ngSubmit)="saveWp()">
        <div class="form-title">{{ editing() ? '编辑工作包 ' + editing()!.code : '新增工作包' }}</div>
        <mat-form-field><mat-label>编号</mat-label><input matInput formControlName="code" placeholder="1.1" /></mat-form-field>
        <mat-form-field><mat-label>名称</mat-label><input matInput formControlName="name" /></mat-form-field>
        @if (!editing()) {
          <mat-form-field>
            <mat-label>上级</mat-label>
            <mat-select formControlName="parentId">
              <mat-option value="">（顶层）</mat-option>
              @for (w of items(); track w.id) { <mat-option [value]="w.id">{{ w.code }} {{ w.name }}</mat-option> }
            </mat-select>
          </mat-form-field>
        }
        <mat-checkbox formControlName="isMilestone">里程碑</mat-checkbox>
        @if (!wpForm.controls.isMilestone.value) {
          <mat-form-field><mat-label>工期（工作日）</mat-label><input matInput type="number" formControlName="durationDays" /></mat-form-field>
        }
        <mat-form-field>
          <mat-label>负责人</mat-label>
          <mat-select formControlName="ownerId">
            <mat-option value="">未分配</mat-option>
            @for (m of members(); track m.userId) { <mat-option [value]="m.userId">{{ m.user?.name }}</mat-option> }
          </mat-select>
        </mat-form-field>
        <mat-form-field>
          <mat-label>所属阶段</mat-label>
          <mat-select formControlName="phaseId">
            <mat-option value="">未指定</mat-option>
            @for (ph of phases(); track ph.id) { <mat-option [value]="ph.id">{{ ph.order }}. {{ ph.name }}</mat-option> }
          </mat-select>
        </mat-form-field>
        <mat-form-field>
          <mat-label>产出的交付物</mat-label>
          <mat-select formControlName="deliverableId">
            <mat-option value="">无</mat-option>
            @for (dl of deliverables(); track dl.id) { <mat-option [value]="dl.id">{{ dl.name }}</mat-option> }
          </mat-select>
        </mat-form-field>
        <mat-form-field>
          <mat-label>成本科目</mat-label>
          <mat-select formControlName="costAccountId">
            <mat-option value="">未指定</mat-option>
            @for (a of accounts(); track a.id) { <mat-option [value]="a.id">{{ a.code }} {{ a.name }}</mat-option> }
          </mat-select>
        </mat-form-field>
        <mat-form-field><mat-label>预算</mat-label><input matInput type="number" formControlName="budget" /></mat-form-field>
        <mat-form-field><mat-label>资源估算（人天）</mat-label><input matInput type="number" formControlName="resourceDays" /></mat-form-field>
        <mat-form-field><mat-label>外部供方（如由供方完成）</mat-label><input matInput formControlName="externalProvider" /></mat-form-field>
        <mat-checkbox formControlName="longLead">长周期物料</mat-checkbox>
        <button mat-flat-button type="submit" [disabled]="wpForm.invalid">{{ editing() ? '保存修改' : '添加工作包' }}</button>
        @if (editing()) { <button mat-button type="button" (click)="cancelEdit()">取消</button> }
      </form>
      <form class="row" [formGroup]="depForm" (ngSubmit)="addDep()">
        <mat-form-field>
          <mat-label>前置</mat-label>
          <mat-select formControlName="predecessorId">
            @for (w of leaves(); track w.id) { <mat-option [value]="w.id">{{ w.code }} {{ w.name }}</mat-option> }
          </mat-select>
        </mat-form-field>
        <mat-form-field>
          <mat-label>后续（完成后才能开始）</mat-label>
          <mat-select formControlName="successorId">
            @for (w of leaves(); track w.id) { <mat-option [value]="w.id">{{ w.code }} {{ w.name }}</mat-option> }
          </mat-select>
        </mat-form-field>
        <button mat-stroked-button type="submit" [disabled]="depForm.invalid">添加依赖</button>
      </form>
    }

    <mat-button-toggle-group [value]="view()" (change)="view.set($event.value)" aria-label="视图">
      <mat-button-toggle value="table">列表</mat-button-toggle>
      <mat-button-toggle value="gantt">甘特图</mat-button-toggle>
      <mat-button-toggle value="board">看板</mat-button-toggle>
    </mat-button-toggle-group>

    @switch (view()) {
      @case ('table') {
        <table class="wbs">
          <thead><tr><th>编号</th><th>名称</th><th>负责人</th><th>工期</th><th>计划</th><th class="num">预算</th><th>状态</th><th>进度</th><th></th></tr></thead>
          <tbody>
            @for (w of items(); track w.id) {
              <tr>
                <td [style.padding-left.px]="14 + depth(w) * 16">{{ w.code }}</td>
                <td>
                  <span [class.crit-name]="w.critical">@if (w.isMilestone) { ◆ }{{ w.name }}{{ w.critical ? ' ★' : '' }}</span>
                  <div class="tags">
                    @if (phaseName(w)) { <span class="tag">{{ phaseName(w) }}</span> }
                    @if (deliverableName(w)) { <span class="tag">交付物：{{ deliverableName(w) }}</span> }
                    @if (w.externalProvider) { <span class="tag ext">外部供方：{{ w.externalProvider }}</span> }
                    @if (w.longLead) { <span class="tag lead">长周期</span> }
                    @if (w.resourceDays) { <span class="tag">{{ +w.resourceDays }} 人天</span> }
                    @if (slip(w); as s) { <span class="tag late">比批准计划{{ s > 0 ? '晚' : '早' }} {{ s > 0 ? s : -s }} 个工作日</span> }
                  </div>
                </td>
                <td class="nw">{{ ownerName(w) }}</td>
                <td class="nw">{{ w.isMilestone ? '里程碑' : w.isLeaf ? w.durationDays + ' 天' : '' }}</td>
                <td class="dates">{{ w.scheduledStart }}<br />{{ w.scheduledEnd }}</td>
                <td class="num nw">{{ w.budget ? (+w.budget).toLocaleString() : '' }}</td>
                <td class="nw">{{ status(w.status) }}</td>
                <td class="nw">
                  @if (w.isLeaf && canProgress(w) && !w.isMilestone) {
                    <input class="pct" type="number" min="0" max="100" [value]="w.percentComplete" (change)="setPercent(w, $any($event.target).valueAsNumber)" aria-label="进度百分比" /> %
                  } @else { {{ w.isLeaf ? w.percentComplete + '%' : '' }} }
                </td>
                <td class="actions">
                  @if (canVerify(w)) { <button mat-button (click)="verify(w)">核验</button> }
                  @if (manage() && w.status !== 'VERIFIED') { <button mat-button (click)="edit(w)">编辑</button> }
                  @if (manage()) { <button mat-button class="danger" (click)="remove(w)">删除</button> }
                </td>
              </tr>
            }
          </tbody>
        </table>
        <p class="muted">★ 表示在关键路径上，◆ 表示里程碑。工期按企业工作日历计算（工作日）。</p>
      }
      @case ('gantt') {
        @if (data(); as d) { <app-gantt [items]="items()" [dependencies]="d.dependencies" [totalDays]="d.calendarDays ?? d.projectDurationDays" [baseline]="baseline()" /> }
      }
      @case ('board') {
        <div class="board">
          @for (c of columns; track c) {
            <div class="col">
              <strong>{{ status(c) }}</strong>
              @for (w of byStatus(c); track w.id) {
                <div class="card">
                  {{ w.code }} {{ w.name }}<br />{{ ownerName(w) }} · {{ w.percentComplete }}%
                  @if (canProgress(w) && c === 'NOT_STARTED') { <br /><button mat-button (click)="move(w, 'IN_PROGRESS')">开始</button> }
                  @if (canProgress(w) && c === 'IN_PROGRESS') { <br /><button mat-button (click)="move(w, 'DONE')">完成</button> }
                  @if (canVerify(w)) { <br /><button mat-button (click)="verify(w)">核验</button> }
                </div>
              }
            </div>
          }
        </div>
      }
    }
  `,
})
export class ProjectWbs {
  private readonly api = inject(Api);
  private readonly auth = inject(AuthService);
  private readonly fb = inject(FormBuilder).nonNullable;

  readonly project = input.required<Project>();
  readonly data = signal<WbsResponse | null>(null);
  readonly members = signal<Member[]>([]);
  readonly phases = signal<Phase[]>([]);
  readonly deliverables = signal<Deliverable[]>([]);
  readonly accounts = signal<CostSummary['accounts']>([]);
  readonly scopeChanges = signal<ChangeRequest[]>([]);
  readonly editing = signal<WorkPackage | null>(null);
  readonly baseline = signal<BaselineDates | null>(null);
  readonly slips = signal<Record<string, number>>({});
  readonly wbsTemplates = signal<WbsTemplate[]>([]);
  readonly importResult = signal<{ created: number; updated: number; dependencies: number } | null>(null);
  readonly importErrors = signal<string[]>([]);
  slip(w: WorkPackage) { return this.slips()[w.id] ?? 0; }
  readonly error = signal('');
  readonly view = signal<'table' | 'gantt' | 'board'>('table');
  readonly columns = COLUMNS;
  readonly crControl = new FormControl('', { nonNullable: true });

  readonly items = computed(() =>
    [...(this.data()?.items ?? [])].sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true })),
  );
  readonly leaves = computed(() => this.items().filter((w) => w.isLeaf));
  readonly manage = computed(() => !!this.project().permissions?.manage);
  readonly quality = computed(() => !!this.project().permissions?.quality);

  private readonly empty = {
    code: '', name: '', parentId: '', durationDays: 1, ownerId: '', phaseId: '', deliverableId: '', costAccountId: '',
    budget: null as number | null, resourceDays: null as number | null, externalProvider: '', longLead: false, isMilestone: false,
  };
  readonly wpForm = this.fb.group({
    ...this.empty,
    code: [this.empty.code, Validators.required],
    name: [this.empty.name, Validators.required],
    durationDays: [this.empty.durationDays, [Validators.required, Validators.min(1)]],
  });
  readonly depForm = this.fb.group({ predecessorId: ['', Validators.required], successorId: ['', Validators.required] });

  status(s: WpStatus) { return WP_STATUS_LABELS[s]; }
  byStatus(s: WpStatus) { return this.leaves().filter((w) => w.status === s); }
  depth(w: WorkPackage) { return w.code.split('.').length - 1; }
  ownerName(w: WorkPackage) { return this.members().find((m) => m.userId === w.ownerId)?.user?.name ?? '—'; }
  phaseName(w: WorkPackage) { return this.phases().find((p) => p.id === w.phaseId)?.name ?? ''; }
  deliverableName(w: WorkPackage) { return this.deliverables().find((d) => d.id === w.deliverableId)?.name ?? ''; }
  canProgress(w: WorkPackage) {
    return w.status !== 'VERIFIED' && (this.manage() || w.ownerId === this.auth.user()?.id);
  }
  canVerify(w: WorkPackage) {
    return w.isLeaf && w.status === 'DONE' && (this.manage() || this.quality()) && w.ownerId !== this.auth.user()?.id;
  }

  async ngOnInit() {
    const id = this.project().id;
    const [members, phases, deliverables] = await Promise.all([
      this.api.get<Member[]>(`/projects/${id}/members`),
      this.api.get<Phase[]>(`/projects/${id}/phases`),
      this.api.get<Deliverable[]>(`/projects/${id}/deliverables`),
    ]);
    this.members.set(members);
    this.phases.set(phases);
    this.deliverables.set(deliverables);
    if (this.manage()) {
      this.accounts.set((await this.api.get<CostSummary>(`/projects/${id}/cost`)).accounts);
      if (this.project().baselined) this.scopeChanges.set(await approvedScopeChanges(this.api, id));
      this.wbsTemplates.set(await this.api.get<WbsTemplate[]>('/wbs-templates'));
    }
    await this.load();
  }

  async load() {
    if (this.project().baselined) {
      const [versions, perf] = await Promise.all([
        this.api.get<PlanVersion[]>(`/projects/${this.project().id}/plan-versions`),
        this.api.get<Performance>(`/projects/${this.project().id}/performance`),
      ]);
      const latest = versions[0];
      this.baseline.set(latest ? Object.fromEntries(latest.snapshot.workPackages.map((w) => [w.id, { start: w.start, end: w.end }])) : null);
      this.slips.set(Object.fromEntries(perf.schedule.slips.map((s) => [s.id, s.slipDays])));
    }
    this.data.set(await this.api.get<WbsResponse>(`/projects/${this.project().id}/wbs`));
  }

  private async run(fn: () => Promise<unknown>, fallback: string) {
    this.error.set('');
    try {
      await fn();
    } catch (e) {
      this.error.set(errorMessage(e, fallback));
    }
    await this.load();
  }

  edit(w: WorkPackage) {
    this.editing.set(w);
    this.wpForm.reset({
      code: w.code, name: w.name, parentId: w.parentId ?? '', durationDays: w.durationDays, ownerId: w.ownerId ?? '',
      phaseId: w.phaseId ?? '', deliverableId: w.deliverableId ?? '', costAccountId: w.costAccountId ?? '',
      budget: w.budget === null ? null : +w.budget, resourceDays: w.resourceDays === null ? null : +w.resourceDays,
      externalProvider: w.externalProvider ?? '', longLead: w.longLead, isMilestone: !!w.isMilestone,
    });
    this.wpForm.controls.code.disable();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  cancelEdit() {
    this.editing.set(null);
    this.wpForm.controls.code.enable();
    this.wpForm.reset(this.empty);
  }

  saveWp() {
    const v = this.wpForm.getRawValue();
    const editing = this.editing();
    return this.run(async () => {
      if (editing) {
        await this.api.patch(`/projects/${this.project().id}/wbs/${editing.id}`, {
          name: v.name, durationDays: v.durationDays, ownerId: v.ownerId || undefined,
          phaseId: v.phaseId || null, deliverableId: v.deliverableId || null, costAccountId: v.costAccountId || null,
          budget: v.budget ?? undefined, resourceDays: v.resourceDays ?? null, externalProvider: v.externalProvider, longLead: v.longLead,
          isMilestone: v.isMilestone,
        });
      } else {
        await this.api.post(`/projects/${this.project().id}/wbs`, {
          code: v.code, name: v.name, parentId: v.parentId || undefined, ownerId: v.ownerId || undefined,
          phaseId: v.phaseId || undefined, deliverableId: v.deliverableId || undefined, costAccountId: v.costAccountId || undefined,
          budget: v.budget ?? undefined, resourceDays: v.resourceDays ?? undefined,
          externalProvider: v.externalProvider || undefined, longLead: v.longLead,
          isMilestone: v.isMilestone, durationDays: v.isMilestone ? 0 : v.durationDays,
          changeRequestId: this.crControl.value || undefined,
        });
      }
      this.cancelEdit();
    }, editing ? '保存失败' : '添加失败');
  }

  exportExcel() {
    return this.run(() => this.api.download(`/projects/${this.project().id}/wbs/export`, `wbs-${this.project().code}.xlsx`), '导出失败');
  }
  templateExcel() {
    return this.run(() => this.api.download(`/projects/${this.project().id}/wbs/export?template=1`, 'wbs-import-template.xlsx'), '下载失败');
  }
  async importExcel(input: HTMLInputElement) {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    this.importResult.set(null);
    this.importErrors.set([]);
    const form = new FormData();
    form.append('file', file);
    if (this.crControl.value) form.append('changeRequestId', this.crControl.value);
    await this.run(async () => {
      try {
        this.importResult.set(await this.api.upload<{ created: number; updated: number; dependencies: number }>(`/projects/${this.project().id}/wbs/import`, form));
      } catch (e) {
        const errs = (e as { error?: { errors?: string[] } })?.error?.errors;
        if (errs?.length) { this.importErrors.set(errs); return; }
        throw e;
      }
    }, '导入失败');
  }
  async applyTemplate(select: HTMLSelectElement) {
    const templateId = select.value;
    select.value = '';
    if (!templateId) return;
    await this.run(() => this.api.post(`/projects/${this.project().id}/wbs/apply-template`, { templateId, changeRequestId: this.crControl.value || undefined }), '添加失败');
  }
  async saveAsTemplate() {
    const name = askText('WBS 模板名称');
    if (!name?.trim()) return;
    await this.run(async () => {
      await this.api.post(`/projects/${this.project().id}/wbs/save-as-template`, { name: name.trim() });
      this.wbsTemplates.set(await this.api.get<WbsTemplate[]>('/wbs-templates'));
    }, '保存模板失败');
  }

  addDep() {
    return this.run(async () => {
      await this.api.post(`/projects/${this.project().id}/dependencies`, this.depForm.getRawValue());
      this.depForm.reset({ predecessorId: '', successorId: '' });
    }, '添加依赖失败');
  }

  setPercent(w: WorkPackage, percentComplete: number) {
    if (Number.isNaN(percentComplete)) return Promise.resolve();
    return this.run(() => this.api.patch(`/projects/${this.project().id}/wbs/${w.id}`, { percentComplete }), '更新失败');
  }
  move(w: WorkPackage, status: WpStatus) {
    return this.run(() => this.api.patch(`/projects/${this.project().id}/wbs/${w.id}`, {
      status, ...(status === 'DONE' ? { percentComplete: 100 } : {}),
    }), '更新失败');
  }
  verify(w: WorkPackage) {
    return this.run(() => this.api.post(`/projects/${this.project().id}/wbs/${w.id}/verify`), '核验失败');
  }
  remove(w: WorkPackage) {
    if (!confirm(`确定删除工作包 ${w.code} ${w.name}？`)) return Promise.resolve();
    const cr = this.crControl.value;
    return this.run(
      () => this.api.delete(`/projects/${this.project().id}/wbs/${w.id}${cr ? `?changeRequestId=${cr}` : ''}`),
      '删除失败',
    );
  }
}
