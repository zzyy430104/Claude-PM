import { Component, inject, input, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatTableModule } from '@angular/material/table';
import { Discussion } from './discussion';
import { Api, errorMessage } from '../core/api';
import { DELIVERABLE_KIND_LABELS, DELIVERABLE_STATUS_LABELS, Deliverable, Phase, Project } from '../core/models';

@Component({
  selector: 'app-project-deliverables',
  imports: [Discussion, ReactiveFormsModule, MatButtonModule, MatFormFieldModule, MatInputModule, MatSelectModule, MatTableModule],
  template: `
    @if (canWrite()) {
      <form class="row" [formGroup]="form" (ngSubmit)="add()">
        <mat-form-field><mat-label>名称</mat-label><input matInput formControlName="name" /></mat-form-field>
        <mat-form-field>
          <mat-label>类型</mat-label>
          <mat-select formControlName="kind">
            @for (k of kinds; track k) { <mat-option [value]="k">{{ kindLabels[k] }}</mat-option> }
          </mat-select>
        </mat-form-field>
        <mat-form-field>
          <mat-label>所属阶段</mat-label>
          <mat-select formControlName="phaseId">
            <mat-option value="">不指定</mat-option>
            @for (p of phases(); track p.id) { <mat-option [value]="p.id">{{ p.name }}</mat-option> }
          </mat-select>
        </mat-form-field>
        <mat-form-field><mat-label>供方 / 责任方</mat-label><input matInput formControlName="supplier" /></mat-form-field>
        <mat-form-field><mat-label>到期日</mat-label><input matInput type="date" formControlName="dueDate" /></mat-form-field>
        <button mat-flat-button type="submit" [disabled]="form.invalid">添加交付物</button>
      </form>
    }
    @if (error()) { <div class="error" role="alert">{{ error() }}</div> }
    <table mat-table [dataSource]="rows()">
      <ng-container matColumnDef="name"><th mat-header-cell *matHeaderCellDef>名称</th><td mat-cell *matCellDef="let d">{{ d.name }}</td></ng-container>
      <ng-container matColumnDef="kind"><th mat-header-cell *matHeaderCellDef>类型</th><td mat-cell *matCellDef="let d">{{ kindLabel(d) }}</td></ng-container>
      <ng-container matColumnDef="phase"><th mat-header-cell *matHeaderCellDef>阶段</th><td mat-cell *matCellDef="let d">{{ phaseName(d) }}</td></ng-container>
      <ng-container matColumnDef="supplier"><th mat-header-cell *matHeaderCellDef>责任方</th><td mat-cell *matCellDef="let d">{{ d.supplier ?? '—' }}</td></ng-container>
      <ng-container matColumnDef="due"><th mat-header-cell *matHeaderCellDef>到期日</th><td mat-cell *matCellDef="let d">{{ d.dueDate?.slice(0, 10) ?? '—' }}</td></ng-container>
      <ng-container matColumnDef="status">
        <th mat-header-cell *matHeaderCellDef>状态</th>
        <td mat-cell *matCellDef="let d">
          @if (canWrite()) {
            <mat-select [value]="d.status" (selectionChange)="setStatus(d, $event.value)" aria-label="状态">
              @for (s of statuses; track s) { <mat-option [value]="s">{{ statusLabels[s] }}</mat-option> }
            </mat-select>
          } @else { {{ statusLabel(d) }} }
        </td>
      </ng-container>
      <ng-container matColumnDef="talk"><th mat-header-cell *matHeaderCellDef></th><td mat-cell *matCellDef="let d"><button mat-button (click)="toggleTalk(d.id)">{{ talkLabel(d.id) }}</button></td></ng-container>
      <tr mat-header-row *matHeaderRowDef="cols"></tr>
      <tr mat-row *matRowDef="let row; columns: cols"></tr>
    </table>
    @if (talk(); as tid) {
      <section class="pcard" style="margin-top: 12px"><header><h3>讨论：{{ deliverableName(tid) }}</h3></header><div class="body"><app-discussion [projectId]="project().id" entityType="DELIVERABLE" [entityId]="tid" [canPost]="project().status !== 'CLOSED'" /></div></section>
    }
  `,
})
export class ProjectDeliverables {
  private readonly api = inject(Api);
  private readonly fb = inject(FormBuilder).nonNullable;
  readonly project = input.required<Project>();
  /** 展开讨论的对象，以及各对象的讨论条数 */
  readonly talk = signal<string | null>(null);
  readonly talkCounts = signal<Record<string, number>>({});
  talkLabel(id: string) { const n = this.talkCounts()[id]; return n ? `讨论 (${n})` : '讨论'; }
  toggleTalk(id: string) { this.talk.set(this.talk() === id ? null : id); void this.loadTalk(); }
  async loadTalk() { try { this.talkCounts.set(await this.api.get<Record<string, number>>(`/projects/${this.project().id}/comment-counts?type=DELIVERABLE`)); } catch { /* 忽略 */ } }
  readonly cols = ['name', 'kind', 'phase', 'supplier', 'due', 'status', 'talk'];
  deliverableName(id: string) { return this.rows().find((d) => d.id === id)?.name ?? ''; }
  readonly kinds = Object.keys(DELIVERABLE_KIND_LABELS) as Deliverable['kind'][];
  readonly statuses = Object.keys(DELIVERABLE_STATUS_LABELS) as Deliverable['status'][];
  readonly kindLabels = DELIVERABLE_KIND_LABELS;
  readonly statusLabels = DELIVERABLE_STATUS_LABELS;
  readonly rows = signal<Deliverable[]>([]);
  readonly phases = signal<Phase[]>([]);
  readonly error = signal('');
  readonly form = this.fb.group({
    name: ['', Validators.required],
    kind: ['INTERNAL' as Deliverable['kind']],
    phaseId: [''],
    supplier: [''],
    dueDate: [''],
  });

  canWrite() { return !!this.project().permissions?.edit?.DELIVERABLES; }
  kindLabel(d: Deliverable) { return DELIVERABLE_KIND_LABELS[d.kind]; }
  statusLabel(d: Deliverable) { return DELIVERABLE_STATUS_LABELS[d.status]; }
  phaseName(d: Deliverable) { return this.phases().find((p) => p.id === d.phaseId)?.name ?? '—'; }

  async ngOnInit() {
    this.phases.set(await this.api.get<Phase[]>(`/projects/${this.project().id}/phases`));
    await this.load();
  }
  async load() {
    void this.loadTalk(); this.rows.set(await this.api.get<Deliverable[]>(`/projects/${this.project().id}/deliverables`)); }

  async add() {
    this.error.set('');
    const v = this.form.getRawValue();
    try {
      await this.api.post(`/projects/${this.project().id}/deliverables`, {
        name: v.name, kind: v.kind, phaseId: v.phaseId || undefined,
        supplier: v.supplier || undefined, dueDate: v.dueDate || undefined,
      });
      this.form.reset({ name: '', kind: 'INTERNAL', phaseId: '', supplier: '', dueDate: '' });
      await this.load();
    } catch (e) { this.error.set(errorMessage(e, '添加失败')); }
  }

  async setStatus(d: Deliverable, status: Deliverable['status']) {
    this.error.set('');
    try { await this.api.patch(`/projects/${this.project().id}/deliverables/${d.id}`, { status }); }
    catch (e) { this.error.set(errorMessage(e, '更新失败')); }
    await this.load();
  }
}
