import { Component, ElementRef, computed, inject, input, signal, viewChild } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { DatePipe } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { Api, errorMessage } from '../core/api';
import { DocRow, DocVersion, Project } from '../core/models';

@Component({
  selector: 'app-project-documents',
  imports: [ReactiveFormsModule, DatePipe, MatButtonModule, MatFormFieldModule, MatInputModule, MatSelectModule],
  styles: `table { width: 100%; border-collapse: collapse; font-size: 14px; } th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--mat-sys-outline-variant); } h3 { margin: 16px 0 4px; } .meta { font-size: 12px; color: var(--mat-sys-on-surface-variant); }`,
  template: `
    @if (canUpload()) {
      <form class="row" [formGroup]="form" (ngSubmit)="upload()">
        <mat-form-field><mat-label>目录</mat-label>
          <mat-select formControlName="folder">@for (f of folders(); track f) { <mat-option [value]="f">{{ f }}</mat-option> }</mat-select>
        </mat-form-field>
        <mat-form-field><mat-label>文档名称（同名则生成新版本）</mat-label><input matInput formControlName="name" /></mat-form-field>
        <mat-form-field><mat-label>版本说明</mat-label><input matInput formControlName="comment" /></mat-form-field>
        <input #fileInput type="file" (change)="pick($event)" aria-label="选择文件" />
        <button mat-flat-button type="submit" [disabled]="form.invalid || !file()">上传</button>
      </form>
    }
    @if (error()) { <div class="error" role="alert">{{ error() }}</div> }
    @for (f of grouped(); track f.folder) {
      <h3>{{ f.folder }}</h3>
      <table>
        <tbody>
          @for (d of f.docs; track d.id) {
            <tr>
              <td>{{ d.name }}</td><td>v{{ d.currentVersion }}</td><td>{{ d.latest?.fileName }}</td>
              <td>{{ d.latest?.uploadedAt | date: 'yyyy-MM-dd HH:mm' }}</td>
              <td><button mat-button (click)="download(d)">下载</button><button mat-button (click)="toggle(d)">{{ versions()[d.id] ? '收起' : '历史版本' }}</button></td>
            </tr>
            @if (versions()[d.id]; as vs) {
              @for (v of vs; track v.id) {
                <tr class="meta"><td></td><td>v{{ v.version }}</td><td>{{ v.fileName }}（{{ v.size }} 字节）</td><td>SHA-256 {{ v.sha256.slice(0, 12) }}… {{ v.comment }}</td><td><button mat-button (click)="downloadVersion(d, v)">下载此版本</button></td></tr>
              }
            }
          }
        </tbody>
      </table>
    }
    @if (docs().length === 0) { <p>暂无文档。文档按标准目录归档，每次上传生成新版本，历史版本不可修改或删除。</p> }
  `,
})
export class ProjectDocuments {
  private readonly api = inject(Api);
  private readonly fb = inject(FormBuilder).nonNullable;
  readonly project = input.required<Project>();
  readonly docs = signal<DocRow[]>([]);
  readonly folders = signal<string[]>([]);
  readonly versions = signal<Record<string, DocVersion[]>>({});
  readonly file = signal<File | null>(null);
  private readonly fileInput = viewChild<ElementRef<HTMLInputElement>>('fileInput');
  readonly error = signal('');
  readonly canUpload = computed(() => this.project().status !== 'CLOSED' && this.project().status !== 'CANCELLED');
  readonly form = this.fb.group({ folder: ['02-项目计划', Validators.required], name: [''], comment: [''] });
  readonly grouped = computed(() => {
    const m = new Map<string, DocRow[]>();
    for (const d of this.docs()) m.set(d.folder, [...(m.get(d.folder) ?? []), d]);
    return [...m.entries()].map(([folder, docs]) => ({ folder, docs }));
  });

  async ngOnInit() {
    this.folders.set(await this.api.get<string[]>(`/projects/${this.project().id}/documents/folders`));
    await this.load();
  }
  async load() { this.docs.set(await this.api.get<DocRow[]>(`/projects/${this.project().id}/documents`)); }
  pick(e: Event) { this.file.set((e.target as HTMLInputElement).files?.[0] ?? null); }

  async upload() {
    const f = this.file();
    if (!f) return;
    this.error.set('');
    const v = this.form.getRawValue();
    const fd = new FormData();
    fd.append('folder', v.folder);
    if (v.name) fd.append('name', v.name);
    if (v.comment) fd.append('comment', v.comment);
    fd.append('file', f);
    try {
      await this.api.upload(`/projects/${this.project().id}/documents`, fd);
      this.file.set(null);
      // 清空文件框，否则再次选择同一个文件不会触发 change
      const el = this.fileInput()?.nativeElement;
      if (el) el.value = '';
      this.form.patchValue({ name: '', comment: '' });
      await this.load();
    } catch (e) { this.error.set(errorMessage(e, '上传失败')); }
  }
  download(d: DocRow) { return this.api.download(`/projects/${this.project().id}/documents/${d.id}/download`, d.latest?.fileName ?? d.name); }
  downloadVersion(d: DocRow, v: DocVersion) { return this.api.download(`/projects/${this.project().id}/documents/${d.id}/download?version=${v.version}`, v.fileName); }
  async toggle(d: DocRow) {
    const cur = this.versions();
    if (cur[d.id]) { const { [d.id]: _x, ...rest } = cur; this.versions.set(rest); return; }
    this.versions.set({ ...cur, [d.id]: await this.api.get<DocVersion[]>(`/projects/${this.project().id}/documents/${d.id}/versions`) });
  }
}
