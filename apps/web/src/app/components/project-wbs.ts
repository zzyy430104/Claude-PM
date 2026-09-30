import { Component, computed, inject, input, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { Api, errorMessage } from '../core/api';
import { AuthService } from '../core/auth.service';
import { Member, Project, WP_STATUS_LABELS, WbsResponse, WorkPackage, WpStatus } from '../core/models';
import { GanttComponent } from './gantt';

const COLUMNS: WpStatus[] = ['NOT_STARTED', 'IN_PROGRESS', 'DONE', 'VERIFIED'];

@Component({
  selector: 'app-project-wbs',
  imports: [ReactiveFormsModule, MatButtonModule, MatButtonToggleModule, MatFormFieldModule, MatInputModule, MatSelectModule, GanttComponent],
  styles: `
    table.wbs { width: 100%; border-collapse: collapse; font-size: 14px; }
    .wbs th, .wbs td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--mat-sys-outline-variant); }
    .crit { color: var(--mat-sys-error); font-weight: 500; }
    .board { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
    .col { background: var(--mat-sys-surface-container); border-radius: 8px; padding: 8px; min-height: 120px; }
    .card { background: var(--mat-sys-surface); border-radius: 6px; padding: 8px; margin: 6px 0; font-size: 13px; }
    .summary { margin: 12px 0; }
    .warn { color: var(--mat-sys-error); }
    input.pct { width: 56px; }
  `,
  template: `
    @if (data(); as d) {
      <p class="summary">
        总工期 {{ d.projectDurationDays }} 天，预计完成 {{ d.projectedEnd }}
        @if (d.exceedsPlannedEnd) { <span class="warn">（超出项目计划结束日 {{ project().endDate.slice(0, 10) }}）</span> }
      </p>
    }
    @if (error()) { <div class="error" role="alert">{{ error() }}</div> }

    @if (manage()) {
      <form class="row" [formGroup]="wpForm" (ngSubmit)="addWp()">
        <mat-form-field><mat-label>编号</mat-label><input matInput formControlName="code" placeholder="1.1" /></mat-form-field>
        <mat-form-field><mat-label>名称</mat-label><input matInput formControlName="name" /></mat-form-field>
        <mat-form-field>
          <mat-label>上级</mat-label>
          <mat-select formControlName="parentId">
            <mat-option value="">（顶层）</mat-option>
            @for (w of items(); track w.id) { <mat-option [value]="w.id">{{ w.code }} {{ w.name }}</mat-option> }
          </mat-select>
        </mat-form-field>
        <mat-form-field><mat-label>工期（天）</mat-label><input matInput type="number" formControlName="durationDays" /></mat-form-field>
        <mat-form-field>
          <mat-label>负责人</mat-label>
          <mat-select formControlName="ownerId">
            <mat-option value="">未分配</mat-option>
            @for (m of members(); track m.userId) { <mat-option [value]="m.userId">{{ m.user?.name }}</mat-option> }
          </mat-select>
        </mat-form-field>
        <button mat-flat-button type="submit" [disabled]="wpForm.invalid">添加工作包</button>
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
          <thead><tr><th>编号</th><th>名称</th><th>负责人</th><th>工期</th><th>计划</th><th>状态</th><th>进度</th><th></th></tr></thead>
          <tbody>
            @for (w of items(); track w.id) {
              <tr [class.crit]="w.critical">
                <td [style.padding-left.px]="8 + depth(w) * 16">{{ w.code }}</td>
                <td>{{ w.name }}{{ w.critical ? ' ★' : '' }}</td>
                <td>{{ ownerName(w) }}</td>
                <td>{{ w.isLeaf ? w.durationDays + ' 天' : '' }}</td>
                <td>{{ w.scheduledStart }} → {{ w.scheduledEnd }}</td>
                <td>{{ status(w.status) }}</td>
                <td>
                  @if (w.isLeaf && canProgress(w)) {
                    <input class="pct" type="number" min="0" max="100" [value]="w.percentComplete" (change)="setPercent(w, $any($event.target).valueAsNumber)" aria-label="进度百分比" />%
                  } @else { {{ w.isLeaf ? w.percentComplete + '%' : '' }} }
                </td>
                <td>
                  @if (canVerify(w)) { <button mat-button (click)="verify(w)">核验</button> }
                  @if (manage() && !project().baselined) { <button mat-button (click)="remove(w)">删除</button> }
                </td>
              </tr>
            }
          </tbody>
        </table>
        <p>★ 表示在关键路径上。</p>
      }
      @case ('gantt') {
        @if (data(); as d) { <app-gantt [items]="items()" [dependencies]="d.dependencies" [totalDays]="d.projectDurationDays" /> }
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
  readonly error = signal('');
  readonly view = signal<'table' | 'gantt' | 'board'>('table');
  readonly columns = COLUMNS;

  readonly items = computed(() =>
    [...(this.data()?.items ?? [])].sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true })),
  );
  readonly leaves = computed(() => this.items().filter((w) => w.isLeaf));
  readonly manage = computed(() => !!this.project().permissions?.manage);
  readonly quality = computed(() => !!this.project().permissions?.quality);

  readonly wpForm = this.fb.group({
    code: ['', Validators.required],
    name: ['', Validators.required],
    parentId: [''],
    durationDays: [1, [Validators.required, Validators.min(1)]],
    ownerId: [''],
  });
  readonly depForm = this.fb.group({ predecessorId: ['', Validators.required], successorId: ['', Validators.required] });

  status(s: WpStatus) { return WP_STATUS_LABELS[s]; }
  byStatus(s: WpStatus) { return this.leaves().filter((w) => w.status === s); }
  depth(w: WorkPackage) { return w.code.split('.').length - 1; }
  ownerName(w: WorkPackage) { return this.members().find((m) => m.userId === w.ownerId)?.user?.name ?? '—'; }
  canProgress(w: WorkPackage) {
    return w.status !== 'VERIFIED' && (this.manage() || w.ownerId === this.auth.user()?.id);
  }
  canVerify(w: WorkPackage) {
    return w.isLeaf && w.status === 'DONE' && (this.manage() || this.quality()) && w.ownerId !== this.auth.user()?.id;
  }

  async ngOnInit() {
    this.members.set(await this.api.get<Member[]>(`/projects/${this.project().id}/members`));
    await this.load();
  }

  async load() {
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

  addWp() {
    const v = this.wpForm.getRawValue();
    return this.run(async () => {
      await this.api.post(`/projects/${this.project().id}/wbs`, {
        code: v.code, name: v.name, durationDays: v.durationDays,
        parentId: v.parentId || undefined, ownerId: v.ownerId || undefined,
      });
      this.wpForm.reset({ code: '', name: '', parentId: '', durationDays: 1, ownerId: '' });
    }, '添加失败');
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
    return this.run(() => this.api.delete(`/projects/${this.project().id}/wbs/${w.id}`), '删除失败');
  }
}
