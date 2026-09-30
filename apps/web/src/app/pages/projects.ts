import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatTableModule } from '@angular/material/table';
import { Api, errorMessage } from '../core/api';
import { AuthService } from '../core/auth.service';
import { PROJECT_STATUS_LABELS, PhaseTemplate, Project, RISK_LABELS, RiskLevel, UserRow } from '../core/models';

@Component({
  selector: 'app-projects',
  imports: [ReactiveFormsModule, RouterLink, MatButtonModule, MatFormFieldModule, MatInputModule, MatSelectModule, MatTableModule],
  template: `
    <div class="page">
      <h1>项目</h1>
      @if (canCreate()) {
        <form class="row" [formGroup]="form" (ngSubmit)="create()">
          <mat-form-field><mat-label>项目编号</mat-label><input matInput formControlName="code" /></mat-form-field>
          <mat-form-field><mat-label>项目名称</mat-label><input matInput formControlName="name" /></mat-form-field>
          <mat-form-field>
            <mat-label>风险等级</mat-label>
            <mat-select formControlName="riskLevel">
              @for (r of risks; track r) { <mat-option [value]="r">{{ riskLabel(r) }}</mat-option> }
            </mat-select>
          </mat-form-field>
          <mat-form-field><mat-label>开始日期</mat-label><input matInput type="date" formControlName="startDate" /></mat-form-field>
          <mat-form-field><mat-label>结束日期</mat-label><input matInput type="date" formControlName="endDate" /></mat-form-field>
          <mat-form-field><mat-label>预算</mat-label><input matInput type="number" formControlName="budget" /></mat-form-field>
          <mat-form-field>
            <mat-label>阶段模板</mat-label>
            <mat-select formControlName="templateId">
              <mat-option value="">默认（轨道交通 7 阶段）</mat-option>
              @for (t of templates(); track t.id) { <mat-option [value]="t.id">{{ t.name }}</mat-option> }
            </mat-select>
          </mat-form-field>
          @if (isAdmin()) {
            <mat-form-field>
              <mat-label>项目经理</mat-label>
              <mat-select formControlName="managerId">
                <mat-option value="">暂不指定</mat-option>
                @for (u of managers(); track u.id) { <mat-option [value]="u.id">{{ u.name }}</mat-option> }
              </mat-select>
            </mat-form-field>
          }
          <button mat-flat-button type="submit" [disabled]="form.invalid">创建项目</button>
        </form>
      }
      @if (error()) { <div class="error" role="alert">{{ error() }}</div> }
      <table mat-table [dataSource]="projects()">
        <ng-container matColumnDef="code"><th mat-header-cell *matHeaderCellDef>编号</th><td mat-cell *matCellDef="let p"><a [routerLink]="['/projects', p.id]">{{ p.code }}</a></td></ng-container>
        <ng-container matColumnDef="name"><th mat-header-cell *matHeaderCellDef>名称</th><td mat-cell *matCellDef="let p">{{ p.name }}</td></ng-container>
        <ng-container matColumnDef="status"><th mat-header-cell *matHeaderCellDef>状态</th><td mat-cell *matCellDef="let p">{{ statusLabel(p) }}{{ p.baselined ? '（计划已批准）' : '' }}</td></ng-container>
        <ng-container matColumnDef="risk"><th mat-header-cell *matHeaderCellDef>风险等级</th><td mat-cell *matCellDef="let p">{{ riskLabel(p.riskLevel) }}</td></ng-container>
        <ng-container matColumnDef="dates"><th mat-header-cell *matHeaderCellDef>周期</th><td mat-cell *matCellDef="let p">{{ p.startDate.slice(0, 10) }} → {{ p.endDate.slice(0, 10) }}</td></ng-container>
        <tr mat-header-row *matHeaderRowDef="cols"></tr>
        <tr mat-row *matRowDef="let row; columns: cols"></tr>
      </table>
      @if (projects().length === 0) { <p>暂无可见的项目。</p> }
    </div>
  `,
})
export class ProjectsPage {
  private readonly api = inject(Api);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly fb = inject(FormBuilder).nonNullable;

  readonly cols = ['code', 'name', 'status', 'risk', 'dates'];
  readonly risks: RiskLevel[] = ['LOW', 'MEDIUM', 'HIGH'];
  readonly projects = signal<Project[]>([]);
  readonly templates = signal<PhaseTemplate[]>([]);
  readonly managers = signal<UserRow[]>([]);
  readonly error = signal('');
  readonly form = this.fb.group({
    code: ['', Validators.required],
    name: ['', [Validators.required, Validators.minLength(2)]],
    riskLevel: ['MEDIUM' as RiskLevel],
    startDate: ['', Validators.required],
    endDate: ['', Validators.required],
    budget: [null as number | null],
    templateId: [''],
    managerId: [''],
  });

  constructor() {
    void this.load();
  }

  canCreate() { return this.auth.hasRole('TENANT_ADMIN', 'PROJECT_MANAGER'); }
  isAdmin() { return this.auth.hasRole('TENANT_ADMIN'); }
  riskLabel(r: RiskLevel) { return RISK_LABELS[r]; }
  statusLabel(p: Project) { return PROJECT_STATUS_LABELS[p.status]; }

  async load() {
    this.projects.set(await this.api.get<Project[]>('/projects'));
    if (this.canCreate()) this.templates.set(await this.api.get<PhaseTemplate[]>('/phase-templates'));
    if (this.isAdmin()) {
      const users = await this.api.get<UserRow[]>('/users');
      this.managers.set(users.filter((u) => u.role === 'PROJECT_MANAGER' && u.active));
    }
  }

  async create() {
    if (this.form.invalid) return;
    this.error.set('');
    const v = this.form.getRawValue();
    try {
      const p = await this.api.post<Project>('/projects', {
        code: v.code, name: v.name, riskLevel: v.riskLevel, startDate: v.startDate, endDate: v.endDate,
        budget: v.budget ?? undefined, templateId: v.templateId || undefined, managerId: v.managerId || undefined,
      });
      await this.router.navigate(['/projects', p.id]);
    } catch (e) {
      this.error.set(errorMessage(e, '创建失败'));
    }
  }
}
