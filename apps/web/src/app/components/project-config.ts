import { Component, computed, inject, input, signal } from '@angular/core';
import { askText } from '../core/i18n';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { Api, errorMessage } from '../core/api';
import { BaselineRow, ConfigItemRow, ConfigStatus, Project } from '../core/models';

@Component({
  selector: 'app-project-config',
  imports: [ReactiveFormsModule, MatButtonModule, MatFormFieldModule, MatInputModule, MatSelectModule],
  styles: `table { width: 100%; border-collapse: collapse; font-size: 14px; } th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--mat-sys-outline-variant); } .warn { color: var(--mat-sys-error); }`,
  template: `
    @if (error()) { <div class="error" role="alert">{{ error() }}</div> }
    @if (canEdit()) {
      <form class="row" [formGroup]="form" (ngSubmit)="add()">
        <mat-form-field><mat-label>编号</mat-label><input matInput formControlName="code" /></mat-form-field>
        <mat-form-field><mat-label>名称</mat-label><input matInput formControlName="name" /></mat-form-field>
        <mat-form-field><mat-label>类别</mat-label><mat-select formControlName="kind"><mat-option value="HARDWARE">硬件</mat-option><mat-option value="SOFTWARE">软件</mat-option><mat-option value="DOCUMENT">文件</mat-option><mat-option value="TOOL">工具</mat-option></mat-select></mat-form-field>
        <mat-form-field><mat-label>上级</mat-label><mat-select formControlName="parentId"><mat-option value="">（顶层）</mat-option>@for (i of items(); track i.id) { <mat-option [value]="i.id">{{ i.code }} {{ i.name }}</mat-option> }</mat-select></mat-form-field>
        <mat-form-field><mat-label>序列号</mat-label><input matInput formControlName="serialNumber" /></mat-form-field>
        <mat-form-field><mat-label>批次号</mat-label><input matInput formControlName="batchNumber" /></mat-form-field>
        <label><input type="checkbox" formControlName="safetyRelated" /> 安全相关</label>
        <label><input type="checkbox" formControlName="lowestLevel" /> 最低可更换单元</label>
        <button mat-flat-button type="submit" [disabled]="form.invalid">添加配置项</button>
      </form>
    }
    <table>
      <thead><tr><th>编号</th><th>名称</th><th>类别</th><th>版本</th><th>序列号 / 批次</th><th>属性</th><th></th></tr></thead>
      <tbody>
        @for (i of items(); track i.id) {
          <tr>
            <td [style.padding-left.px]="8 + depth(i) * 16">{{ i.code }}</td><td>{{ i.name }}</td><td>{{ i.kind }}</td><td>{{ i.revision }}</td>
            <td>{{ i.serialNumber ?? '—' }} / {{ i.batchNumber ?? '—' }}</td>
            <td>{{ i.safetyRelated ? '安全相关 ' : '' }}{{ i.lowestLevel ? 'LLRU' : '' }}</td>
            <td>@if (canEdit()) { <button mat-button (click)="bump(i)">升版</button> }</td>
          </tr>
        }
      </tbody>
    </table>

    <h2>基线与配置状态</h2>
    @if (canBaseline()) {
      <form class="row" [formGroup]="blForm" (ngSubmit)="baseline()">
        <mat-form-field><mat-label>类型</mat-label><mat-select formControlName="type"><mat-option value="AS_DESIGNED">设计态</mat-option><mat-option value="AS_BUILT">制造态</mat-option><mat-option value="AS_MAINTAINED">维护态</mat-option></mat-select></mat-form-field>
        <mat-form-field><mat-label>基线名称</mat-label><input matInput formControlName="name" /></mat-form-field>
        <button mat-flat-button type="submit" [disabled]="blForm.invalid">建立基线</button>
      </form>
    }
    @if (status(); as s) {
      <p>最近基线：{{ s.baseline?.name ?? '尚未建立' }}；安全相关配置项 {{ s.safetyRelatedItems }} 个；
        新增 {{ s.added.length }}、删除 {{ s.removed.length }}、版本变化 {{ s.changed.length }}
        @for (c of s.changed; track c.code) { <span class="warn"> {{ c.code }}: {{ c.from }}→{{ c.to }}</span> }
      </p>
    }
    @for (b of baselines(); track b.id) { <div>{{ b.name }}（{{ b.type }}，{{ b.itemCount }} 项，{{ b.createdAt.slice(0, 10) }}）</div> }
  `,
})
export class ProjectConfig {
  private readonly api = inject(Api);
  private readonly fb = inject(FormBuilder).nonNullable;
  readonly project = input.required<Project>();
  readonly items = signal<ConfigItemRow[]>([]);
  readonly baselines = signal<BaselineRow[]>([]);
  readonly status = signal<ConfigStatus | null>(null);
  readonly error = signal('');
  readonly canEdit = computed(() => !!(this.project().permissions?.manage || this.project().permissions?.quality));
  readonly canBaseline = computed(() => !!this.project().permissions?.manage);
  readonly form = this.fb.group({ code: ['', Validators.required], name: ['', Validators.required], kind: ['HARDWARE'], parentId: [''], serialNumber: [''], batchNumber: [''], safetyRelated: [false], lowestLevel: [false] });
  readonly blForm = this.fb.group({ type: ['AS_DESIGNED'], name: ['', [Validators.required, Validators.minLength(2)]] });

  depth(i: ConfigItemRow) { let d = 0; let p = i.parentId; const by = new Map(this.items().map((x) => [x.id, x])); while (p && d < 20) { d++; p = by.get(p)?.parentId ?? null; } return d; }

  async ngOnInit() { await this.load(); }
  async load() {
    const id = this.project().id;
    this.items.set(await this.api.get<ConfigItemRow[]>(`/projects/${id}/config/items`));
    this.baselines.set(await this.api.get<BaselineRow[]>(`/projects/${id}/config/baselines`));
    this.status.set(await this.api.get<ConfigStatus>(`/projects/${id}/config/status`));
  }
  private async run(fn: () => Promise<unknown>, fallback: string) {
    this.error.set('');
    try { await fn(); } catch (e) { this.error.set(errorMessage(e, fallback)); }
    await this.load();
  }
  add() {
    const v = this.form.getRawValue();
    return this.run(async () => {
      await this.api.post(`/projects/${this.project().id}/config/items`, { ...v, parentId: v.parentId || undefined, serialNumber: v.serialNumber || undefined, batchNumber: v.batchNumber || undefined });
      this.form.reset({ code: '', name: '', kind: 'HARDWARE', parentId: '', serialNumber: '', batchNumber: '', safetyRelated: false, lowestLevel: false });
    }, '添加失败');
  }
  baseline() {
    return this.run(async () => {
      await this.api.post(`/projects/${this.project().id}/config/baselines`, this.blForm.getRawValue());
      this.blForm.patchValue({ name: '' });
    }, '建立基线失败');
  }
  async bump(i: ConfigItemRow) {
    const revision = await askText(`新版本号（当前 ${i.revision}）。建立基线后需填写已批准的变更申请编号（变更申请的 ID）`);
    if (!revision?.trim()) return Promise.resolve();
    const changeRequestId = await askText('变更申请 ID（基线前可留空）') || undefined;
    return this.run(() => this.api.patch(`/projects/${this.project().id}/config/items/${i.id}`, { revision, changeRequestId }), '升版失败');
  }
}
