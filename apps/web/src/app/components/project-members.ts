import { Component, inject, input, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatTableModule } from '@angular/material/table';
import { Api, errorMessage } from '../core/api';
import { Member, PROJECT_ROLES, PROJECT_ROLE_LABELS, Project, ProjectRole, UserRow } from '../core/models';

@Component({
  selector: 'app-project-members',
  imports: [ReactiveFormsModule, MatButtonModule, MatFormFieldModule, MatInputModule, MatSelectModule, MatSlideToggleModule, MatTableModule],
  template: `
    @if (project().permissions?.manage) {
      <form class="row" [formGroup]="form" (ngSubmit)="add()">
        <mat-form-field>
          <mat-label>用户</mat-label>
          <mat-select formControlName="userId">
            @for (u of candidates(); track u.id) { <mat-option [value]="u.id">{{ u.name }}（{{ u.email }}）</mat-option> }
          </mat-select>
        </mat-form-field>
        <mat-form-field>
          <mat-label>项目角色</mat-label>
          <mat-select formControlName="projectRole">
            @for (r of roles; track r) { <mat-option [value]="r">{{ label(r) }}</mat-option> }
          </mat-select>
        </mat-form-field>
        <mat-form-field><mat-label>任命书编号</mat-label><input matInput formControlName="appointment" /></mat-form-field>
        <mat-form-field><mat-label>能力要求 / 培训</mat-label><input matInput formControlName="competencies" /></mat-form-field>
        <mat-slide-toggle formControlName="isCcb">变更委员会成员</mat-slide-toggle>
        <button mat-flat-button type="submit" [disabled]="form.invalid">添加成员</button>
      </form>
    }
    @if (error()) { <div class="error" role="alert">{{ error() }}</div> }
    <table mat-table [dataSource]="members()">
      <ng-container matColumnDef="name"><th mat-header-cell *matHeaderCellDef>姓名</th><td mat-cell *matCellDef="let m">{{ m.user?.name }}</td></ng-container>
      <ng-container matColumnDef="role"><th mat-header-cell *matHeaderCellDef>项目角色</th><td mat-cell *matCellDef="let m">{{ label(m.projectRole) }}{{ m.isCcb ? ' · CCB' : '' }}</td></ng-container>
      <ng-container matColumnDef="appointment"><th mat-header-cell *matHeaderCellDef>任命书</th><td mat-cell *matCellDef="let m">{{ m.appointment ?? '—' }}</td></ng-container>
      <ng-container matColumnDef="competencies"><th mat-header-cell *matHeaderCellDef>能力要求</th><td mat-cell *matCellDef="let m">{{ m.competencies ?? '—' }}</td></ng-container>
      <ng-container matColumnDef="active">
        <th mat-header-cell *matHeaderCellDef>在项目中</th>
        <td mat-cell *matCellDef="let m"><mat-slide-toggle [checked]="m.active" [disabled]="!project().permissions?.manage" (change)="setActive(m, $event.checked)" aria-label="在项目中" /></td>
      </ng-container>
      <tr mat-header-row *matHeaderRowDef="cols"></tr>
      <tr mat-row *matRowDef="let row; columns: cols"></tr>
    </table>
  `,
})
export class ProjectMembers {
  private readonly api = inject(Api);
  private readonly fb = inject(FormBuilder).nonNullable;
  readonly project = input.required<Project>();
  readonly cols = ['name', 'role', 'appointment', 'competencies', 'active'];
  readonly roles = PROJECT_ROLES;
  readonly members = signal<Member[]>([]);
  readonly candidates = signal<UserRow[]>([]);
  readonly error = signal('');
  readonly form = this.fb.group({
    userId: ['', Validators.required],
    projectRole: ['MEMBER' as ProjectRole],
    appointment: [''],
    competencies: [''],
    isCcb: [false],
  });

  label(r: ProjectRole) { return PROJECT_ROLE_LABELS[r]; }

  async ngOnInit() {
    await this.load();
    if (this.project().permissions?.manage) {
      this.candidates.set(await this.api.get<UserRow[]>('/users/directory'));
    }
  }

  async load() {
    this.members.set(await this.api.get<Member[]>(`/projects/${this.project().id}/members`));
  }

  async add() {
    if (this.form.invalid) return;
    this.error.set('');
    const v = this.form.getRawValue();
    try {
      await this.api.post(`/projects/${this.project().id}/members`, {
        userId: v.userId, projectRole: v.projectRole, isCcb: v.isCcb,
        appointment: v.appointment || undefined, competencies: v.competencies || undefined,
      });
      this.form.reset({ userId: '', projectRole: 'MEMBER', appointment: '', competencies: '', isCcb: false });
      await this.load();
    } catch (e) {
      this.error.set(errorMessage(e, '添加失败'));
    }
  }

  async setActive(m: Member, active: boolean) {
    this.error.set('');
    try {
      await this.api.patch(`/projects/${this.project().id}/members/${m.userId}`, { active });
    } catch (e) {
      this.error.set(errorMessage(e, '更新失败'));
    }
    await this.load();
  }
}
