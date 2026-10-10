import { Component, computed, inject, input, output, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { Api, errorMessage } from '../core/api';
import { askText } from '../core/i18n';
import { HandoverView } from '../core/models';

interface Person { id: string; name: string }
const STATUS = { DRAFT: ['未发起', ''], PENDING: ['交接中 · 待接收人确认', 'amber'], CONFIRMED: ['已交接', 'green'] } as const;

/** 售后交接：项目经理填写并发起，接收人在系统里确认；外部接收人由项目经理登记签字交接单 */
@Component({
  selector: 'app-project-handover',
  imports: [MatButtonModule],
  styles: `
    .chips { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 6px; }
    .chip { display: inline-flex; gap: 6px; align-items: center; background: var(--pm-bg-2); border-radius: 8px; padding: 5px 10px; font-size: 13.5px; }
    textarea { min-height: 70px; }
    .foot { display: flex; gap: 10px; justify-content: flex-end; align-items: center; flex-wrap: wrap; margin-top: 12px; }
    .foot .sp { flex: 1; font-size: 12.5px; color: var(--pm-muted); }
  `,
  template: `
    <section class="pcard">
      <header><h3>售后交接</h3>@if (v(); as x) { <span [class]="'pill ' + status()[1]" data-status>{{ status()[0] }}</span>@if (x.required) { <span class="sub">经立项的项目关闭前须完成交接</span> } }</header>
      <div class="body">
        @if (error()) { <div class="error" role="alert">{{ error() }}</div> }
        @if (v(); as x) {
          @let h = x.handover;
          @let ro = !x.can.edit;
          <div class="fgrid">
            <label class="fld">交接日期<input type="date" [value]="h.date ?? ''" [disabled]="ro" (change)="save({ date: $any($event.target).value || null })" aria-label="交接日期" /></label>
            <label class="fld">移交人<input [value]="h.from ?? '项目经理'" disabled /></label>
            <label class="fld">接收人（系统用户，需在系统里确认）
              <select [disabled]="ro" (change)="save({ receiverId: $any($event.target).value || null })" aria-label="接收人">
                <option value="">外部人员（登记姓名，签字交接单）</option>
                @for (p of people(); track p.id) { <option [value]="p.id" [selected]="p.id === h.receiverId">{{ p.name }}</option> }
              </select></label>
            @if (!h.receiverId) { <label class="fld">外部接收人<input [value]="h.externalName" [disabled]="ro" (change)="save({ externalName: $any($event.target).value })" aria-label="外部接收人" placeholder="单位、姓名" /></label> }
            <label class="fld">质保期自<input type="date" [value]="h.warrantyFrom ?? ''" [disabled]="ro" (change)="save({ warrantyFrom: $any($event.target).value || null })" aria-label="质保期自" /></label>
            <label class="fld">至<input type="date" [value]="h.warrantyTo ?? ''" [disabled]="ro" (change)="save({ warrantyTo: $any($event.target).value || null })" aria-label="质保期至" /></label>
          </div>
          <div class="fld" style="display: block">移交文档
            <div class="chips">@for (d of docs(); track d) { <label class="chip"><input type="checkbox" [checked]="h.documents.includes(d)" [disabled]="ro" (change)="toggleDoc(d, $any($event.target).checked)" [attr.aria-label]="'移交 ' + d" /> {{ d }}</label> }
              @if (!ro) { <button mat-button type="button" (click)="addDoc()">+ 其他文档</button> }</div>
          </div>
          <label class="fld" style="display: block; margin-top: 12px">遗留问题<textarea [value]="h.openIssues" [disabled]="ro" (change)="save({ openIssues: $any($event.target).value })" aria-label="遗留问题"></textarea></label>
          @if (h.status === 'CONFIRMED') { <p class="muted">{{ h.receiver ?? h.externalName }} 已于 {{ h.confirmedAt?.slice(0, 10) }} 确认接收。{{ h.confirmNote }}</p> }
          <div class="foot">
            <span class="sp">@if (h.status === 'PENDING') { 已于 {{ h.submittedAt?.slice(0, 10) }} 发起，等待{{ h.receiver ? ' ' + h.receiver + ' ' : '登记外部接收人签字' }}确认 }</span>
            @if (x.can.withdraw) { <button mat-stroked-button type="button" (click)="withdraw()">撤回修改</button> }
            @if (x.can.submit) { <button mat-flat-button type="button" (click)="submit()">发起交接</button> }
            @if (x.can.confirm) { <button mat-flat-button type="button" (click)="confirm(!h.receiverId)">{{ h.receiverId ? '确认接收' : '登记签字交接单并确认' }}</button> }
          </div>
        }
      </div>
    </section>
  `,
})
export class ProjectHandover {
  private readonly api = inject(Api);
  readonly projectId = input.required<string>();
  readonly changed = output<void>();
  readonly v = signal<HandoverView | null>(null);
  readonly people = signal<Person[]>([]);
  readonly error = signal('');
  readonly status = computed(() => STATUS[this.v()?.handover.status ?? 'DRAFT']);
  readonly docs = computed(() => { const x = this.v(); return x ? [...new Set([...x.defaultDocuments, ...x.handover.documents])] : []; });
  private base = () => `/projects/${this.projectId()}/handover`;

  async ngOnInit() {
    try { this.people.set(await this.api.get<Person[]>('/users/directory')); } catch { /* 无权限时只显示 */ }
    await this.load();
  }
  async load() {
    try { this.v.set(await this.api.get<HandoverView>(this.base())); } catch (e) { this.error.set(errorMessage(e, '加载失败')); }
  }
  private async run(fn: () => Promise<unknown>, fallback: string) {
    this.error.set('');
    try { await fn(); this.changed.emit(); } catch (e) { this.error.set(errorMessage(e, fallback)); }
    await this.load();
  }
  save(p: Record<string, unknown>) { return this.run(() => this.api.put(this.base(), p), '保存失败'); }
  toggleDoc(d: string, on: boolean) {
    const cur = this.v()!.handover.documents;
    return this.save({ documents: on ? [...cur, d] : cur.filter((x) => x !== d) });
  }
  async addDoc() {
    const d = await askText('文档名称');
    if (!d?.trim()) return;
    return this.save({ documents: [...this.v()!.handover.documents, d.trim()] });
  }
  submit() { return this.run(() => this.api.post(`${this.base()}/submit`, {}), '发起失败'); }
  withdraw() { return this.run(() => this.api.post(`${this.base()}/withdraw`, {}), '撤回失败'); }
  async confirm(external: boolean) {
    const note = await askText(external ? '签字交接单编号或存放位置' : '确认说明（可不填）');
    if (note === null) return;
    return this.run(() => this.api.post(`${this.base()}/confirm`, { note: note || undefined }), '确认失败');
  }
}
