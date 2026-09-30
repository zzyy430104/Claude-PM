import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { Api, errorMessage } from '../core/api';
import { PhaseTemplate } from '../core/models';

@Component({
  selector: 'app-templates',
  imports: [ReactiveFormsModule, MatButtonModule, MatFormFieldModule, MatInputModule],
  template: `
    <div class="page">
      <h1>阶段模板</h1>
      <p>未选择模板的项目使用默认的轨道交通 7 个阶段。每行一个阶段，格式：<code>阶段名 | 关口清单项1；清单项2</code></p>
      <form [formGroup]="form" (ngSubmit)="create()">
        <mat-form-field style="width: 100%"><mat-label>模板名称</mat-label><input matInput formControlName="name" /></mat-form-field>
        <mat-form-field style="width: 100%"><mat-label>阶段（每行一个）</mat-label><textarea matInput rows="6" formControlName="phases" placeholder="设计 | 设计评审完成；输出已受控&#10;交付 | 客户验收"></textarea></mat-form-field>
        <button mat-flat-button type="submit" [disabled]="form.invalid">创建模板</button>
      </form>
      @if (error()) { <div class="error" role="alert">{{ error() }}</div> }
      @for (t of templates(); track t.id) {
        <h3>{{ t.name }}</h3>
        <ol>@for (p of t.phases; track p.name) { <li>{{ p.name }}（清单 {{ p.checklist.length }} 项）</li> }</ol>
        <button mat-button (click)="remove(t)">停用</button>
      }
    </div>
  `,
})
export class TemplatesPage {
  private readonly api = inject(Api);
  private readonly fb = inject(FormBuilder).nonNullable;
  readonly templates = signal<PhaseTemplate[]>([]);
  readonly error = signal('');
  readonly form = this.fb.group({ name: ['', [Validators.required, Validators.minLength(2)]], phases: ['', Validators.required] });

  constructor() { void this.load(); }
  async load() { this.templates.set(await this.api.get<PhaseTemplate[]>('/phase-templates')); }

  async create() {
    this.error.set('');
    const v = this.form.getRawValue();
    const phases = v.phases.split('\n').map((l) => l.trim()).filter(Boolean).map((line) => {
      const [name, list = ''] = line.split('|');
      return {
        name: name.trim(),
        checklist: list.split(/[；;]/).map((s) => s.trim()).filter(Boolean),
        mandatoryRoles: ['PROJECT_MANAGER'],
      };
    });
    try {
      await this.api.post('/phase-templates', { name: v.name, phases });
      this.form.reset({ name: '', phases: '' });
      await this.load();
    } catch (e) { this.error.set(errorMessage(e, '创建失败')); }
  }

  async remove(t: PhaseTemplate) {
    await this.api.delete(`/phase-templates/${t.id}`);
    await this.load();
  }
}
