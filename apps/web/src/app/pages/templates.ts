import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { Api, errorMessage } from '../core/api';
import { OptionalLibrary } from '../components/optional-library';
import { PlanTypeTemplates } from '../components/plan-type-templates';
import { PhaseTemplate, PROJECT_ROLES, PROJECT_ROLE_LABELS, ProjectRole, WbsTemplate } from '../core/models';

@Component({
  selector: 'app-templates',
  imports: [ReactiveFormsModule, MatButtonModule, MatFormFieldModule, MatInputModule, PlanTypeTemplates, OptionalLibrary],
  template: `
    <div class="page">
      <div class="crumb">知识库</div>
      <h1>模板</h1>
      <nav class="stabs" role="tablist" aria-label="模板分类">
        <button type="button" role="tab" [attr.aria-selected]="view() === 'type'" (click)="view.set('type')">项目类型模板</button>
        <button type="button" role="tab" [attr.aria-selected]="view() === 'library'" (click)="view.set('library')">可选工作包库</button>
        <button type="button" role="tab" [attr.aria-selected]="view() === 'saved'" (click)="view.set('saved')">阶段与 WBS 模板</button>
      </nav>
      @if (view() === 'type') { <app-plan-type-templates /> }
      @if (view() === 'library') { <app-optional-library /> }
      @if (view() === 'saved') {
      <p>不经立项直接建立的小项目可以选用这里的阶段模板；未选择时使用默认的 6 个阶段。每行一个阶段，格式：<code>阶段名 | 关口清单项1；清单项2 | 必选：项目经理、项目质量经理 | 可选：职能经理</code>。后两段可省略，省略时必选参与者为项目经理。</p>
      <form [formGroup]="form" (ngSubmit)="create()">
        <mat-form-field style="width: 100%"><mat-label>模板名称</mat-label><input matInput formControlName="name" /></mat-form-field>
        <mat-form-field style="width: 100%"><mat-label>阶段（每行一个）</mat-label><textarea matInput rows="6" formControlName="phases" placeholder="设计 | 设计评审完成；输出已受控&#10;交付 | 客户验收"></textarea></mat-form-field>
        <button mat-flat-button type="submit" [disabled]="form.invalid">创建模板</button>
      </form>
      @if (error()) { <div class="error" role="alert">{{ error() }}</div> }
      @for (t of templates(); track t.id) {
        <h3>{{ t.name }}</h3>
        <ol>@for (p of t.phases; track p.name) {
          <li>{{ p.name }}（清单 {{ p.checklist.length }} 项；必选：{{ roleText(p.mandatoryRoles) }}@if (p.optionalRoles?.length) {；可选：{{ roleText(p.optionalRoles!) }}}）</li>
        }</ol>
        <button mat-button (click)="remove(t)">停用</button>
      }

      <h1 style="margin-top: 40px">标准 WBS 模板</h1>
      <p>在项目的「WBS 与进度」里点“另存为 WBS 模板”即可创建；新项目可以从模板一键带出工作包结构。</p>
      @for (w of wbsTemplates(); track w.id) {
        <div class="panel" style="margin-bottom: 10px">
          <strong>{{ w.name }}</strong>（{{ w.items.length }} 个工作包）
          <div class="muted">{{ preview(w) }}</div>
          <button mat-button (click)="removeWbs(w)">停用</button>
        </div>
      }
      @if (wbsTemplates().length === 0) { <p class="muted">还没有 WBS 模板。</p> }
      }
    </div>
  `,
})
export class TemplatesPage {
  private readonly api = inject(Api);
  private readonly fb = inject(FormBuilder).nonNullable;
  readonly templates = signal<PhaseTemplate[]>([]);
  readonly view = signal<'type' | 'library' | 'saved'>('type');
  readonly error = signal('');
  readonly form = this.fb.group({ name: ['', [Validators.required, Validators.minLength(2)]], phases: ['', Validators.required] });

  constructor() { void this.load(); }
  async load() {
    this.templates.set(await this.api.get<PhaseTemplate[]>('/phase-templates'));
    this.wbsTemplates.set(await this.api.get<WbsTemplate[]>('/wbs-templates'));
  }

  async create() {
    this.error.set('');
    const v = this.form.getRawValue();
    const phases = v.phases.split('\n').map((l) => l.trim()).filter(Boolean).map((line) => {
      const [name, list = '', ...rest] = line.split('|');
      const pick = (prefix: string) => {
        const seg = rest.map((x) => x.trim()).find((x) => x.startsWith(prefix));
        return seg ? this.parseRoles(seg.slice(prefix.length)) : null;
      };
      return {
        name: name.trim(),
        checklist: list.split(/[；;]/).map((s) => s.trim()).filter(Boolean),
        mandatoryRoles: pick('必选：') ?? pick('必选:') ?? ['PROJECT_MANAGER'],
        optionalRoles: pick('可选：') ?? pick('可选:') ?? [],
      };
    });
    try {
      await this.api.post('/phase-templates', { name: v.name, phases });
      this.form.reset({ name: '', phases: '' });
      await this.load();
    } catch (e) { this.error.set(errorMessage(e, '创建失败')); }
  }

  readonly wbsTemplates = signal<WbsTemplate[]>([]);
  roleText(rs: ProjectRole[]) { return rs.map((r) => PROJECT_ROLE_LABELS[r]).join('、') || '无'; }
  parseRoles(text: string): ProjectRole[] {
    const names = text.split(/[、,，\s]+/).map((x) => x.trim()).filter(Boolean);
    return PROJECT_ROLES.filter((r) => names.includes(PROJECT_ROLE_LABELS[r]));
  }
  preview(w: WbsTemplate) { return w.items.slice(0, 6).map((i) => `${i.code} ${i.name}`).join('，') + (w.items.length > 6 ? '……' : ''); }
  async removeWbs(w: WbsTemplate) {
    await this.api.delete(`/wbs-templates/${w.id}`);
    await this.load();
  }

  async remove(t: PhaseTemplate) {
    await this.api.delete(`/phase-templates/${t.id}`);
    await this.load();
  }
}
