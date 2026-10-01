import { Component, inject, input, output, signal } from '@angular/core';
import { Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { Ai } from '../core/ai';
import { Api, errorMessage } from '../core/api';
import { Member, Project, RiskSettings } from '../core/models';

type QType = 'NONCONFORMITY' | 'ISSUE' | 'ACTION' | 'RISK' | 'OPPORTUNITY' | 'CHANGE';
interface Draft {
  type: QType; title: string; description: string; severity: string; source: string; owner: string; dueDate: string;
  probability: number | null; impact: number | null; changeType: string; reason: string;
}
const TYPES: [QType, string][] = [['NONCONFORMITY', '不符合项'], ['ISSUE', '问题'], ['ACTION', '行动项'], ['RISK', '风险'], ['OPPORTUNITY', '机会'], ['CHANGE', '变更申请']];
const GO: Record<QType, string> = { NONCONFORMITY: 'g=qual&s=quality', ISSUE: 'g=ctrl&s=issues', ACTION: 'g=ctrl&s=issues', RISK: 'g=ctrl&s=risks', OPPORTUNITY: 'g=ctrl&s=risks', CHANGE: 'g=ctrl&s=changes' };

/** 一句话登记：AI 判断类型并起草不符合项 / 问题 / 行动项 / 风险 / 变更，确认后保存 */
@Component({
  selector: 'app-ai-quick',
  imports: [MatButtonModule],
  styles: `
    .ai { border: 1px dashed var(--pm-primary); border-radius: var(--pm-radius); padding: 12px 16px; margin: 0 0 16px; background: var(--pm-card); }
    .ai h3 { margin: 0 0 6px; font-size: 15px; }
    .row { display: flex; gap: 8px; align-items: center; } .row input { flex: 1; font: inherit; font-size: 14px; border: 1px solid var(--pm-line); border-radius: 8px; padding: 7px 10px; }
    textarea { min-height: 60px; }
    .tools { display: flex; gap: 8px; justify-content: flex-end; margin-top: 10px; }
  `,
  template: `
    <div class="ai" data-ai="quick">
      <h3><span class="pill blue">AI</span> 一句话登记</h3>
      @if (error()) { <div class="error" role="alert">{{ error() }}</div> }
      <div class="row">
        <input [value]="text()" (input)="text.set($any($event.target).value)" (keydown.enter)="run()" placeholder="例如：二车间焊缝外观检验发现 3 件咬边，需返工" aria-label="一句话描述" />
        <button mat-stroked-button type="button" [disabled]="!text().trim() || busy()" (click)="run()">{{ busy() ? 'AI 正在整理…' : 'AI 起草' }}</button>
        <button mat-button type="button" (click)="closed.emit()">关闭</button>
      </div>
      @if (d(); as x) {
        <div class="fgrid" style="margin-top: 12px">
          <label class="fld">类型<select (change)="set('type', $any($event.target).value)" aria-label="登记类型">@for (t of types; track t[0]) { <option [value]="t[0]" [selected]="t[0] === x.type">{{ t[1] }}</option> }</select></label>
          <label class="fld" style="grid-column: span 2">标题<input [value]="x.title" (change)="set('title', $any($event.target).value)" aria-label="登记标题" /></label>
        </div>
        <label class="fld" style="display: block">描述<textarea [value]="x.description" (change)="set('description', $any($event.target).value)" aria-label="登记描述"></textarea></label>
        <div class="fgrid" style="margin-top: 8px">
          @switch (x.type) {
            @case ('NONCONFORMITY') {
              <label class="fld">严重程度<select (change)="set('severity', $any($event.target).value)" aria-label="严重程度">@for (s of sevs; track s[0]) { <option [value]="s[0]" [selected]="s[0] === x.severity">{{ s[1] }}</option> }</select></label>
              <label class="fld">来源<select (change)="set('source', $any($event.target).value)" aria-label="来源">@for (s of srcs; track s[0]) { <option [value]="s[0]" [selected]="s[0] === x.source">{{ s[1] }}</option> }</select></label>
            }
            @case ('CHANGE') {
              <label class="fld">变更类型<select (change)="set('changeType', $any($event.target).value)" aria-label="变更类型">@for (s of chgs; track s[0]) { <option [value]="s[0]" [selected]="s[0] === x.changeType">{{ s[1] }}</option> }</select></label>
              <label class="fld" style="grid-column: span 2">原因<input [value]="x.reason" (change)="set('reason', $any($event.target).value)" aria-label="变更原因" /></label>
            }
          }
          @if (x.type === 'RISK' || x.type === 'OPPORTUNITY') {
            <label class="fld">可能性（1–{{ scale() }}）<input type="number" min="1" [max]="scale()" [value]="x.probability ?? ''" (change)="set('probability', +$any($event.target).value)" aria-label="可能性" /></label>
            <label class="fld">影响（1–{{ scale() }}）<input type="number" min="1" [max]="scale()" [value]="x.impact ?? ''" (change)="set('impact', +$any($event.target).value)" aria-label="影响" /></label>
          }
          @if (x.type === 'ISSUE' || x.type === 'ACTION') {
            <label class="fld">责任人<select (change)="set('owner', $any($event.target).value)" aria-label="责任人"><option value="">—</option>@for (m of team(); track m.userId) { <option [value]="m.user?.name" [selected]="m.user?.name === x.owner">{{ m.user?.name }}</option> }</select></label>
            <label class="fld">期限<input type="date" [value]="x.dueDate" (change)="set('dueDate', $any($event.target).value)" aria-label="期限" /></label>
          }
        </div>
        <div class="tools"><button mat-button type="button" (click)="discard()">放弃</button><button mat-flat-button type="button" (click)="save()">确认登记</button></div>
      }
    </div>
  `,
})
export class AiQuick {
  private readonly api = inject(Api);
  private readonly ai = inject(Ai);
  private readonly router = inject(Router);
  readonly project = input.required<Project>();
  readonly closed = output<void>();
  readonly text = signal('');
  readonly d = signal<Draft | null>(null);
  readonly team = signal<Member[]>([]);
  readonly scale = signal(3);
  readonly busy = signal(false);
  readonly error = signal('');
  readonly types = TYPES;
  readonly sevs = [['MINOR', '轻微'], ['MAJOR', '重大'], ['CRITICAL', '严重']];
  readonly srcs = [['INSPECTION', '检验'], ['AUDIT', '审核'], ['CUSTOMER', '客户'], ['SUPPLIER', '供应商'], ['OTHER', '其他']];
  readonly chgs = [['SCOPE', '范围'], ['SCHEDULE', '进度'], ['BUDGET', '预算'], ['DELIVERY_DATE', '客户交期'], ['TECHNICAL', '技术'], ['OTHER', '其他']];
  private usageId = '';

  async ngOnInit() {
    try {
      const [ms, rs] = await Promise.all([this.api.get<Member[]>(`/projects/${this.project().id}/members`), this.api.get<RiskSettings>('/risk-settings')]);
      const seen = new Set<string>();
      this.team.set(ms.filter((m) => !seen.has(m.userId) && !!seen.add(m.userId)));
      this.scale.set(rs.scale);
    } catch { /* 忽略 */ }
  }
  set<K extends keyof Draft>(k: K, v: Draft[K]) { this.d.update((x) => (x ? { ...x, [k]: v } : x)); }
  async run() {
    if (!this.text().trim()) return;
    this.busy.set(true); this.error.set('');
    try {
      const r = await this.ai.draft<Draft>('QUICK', { text: this.text(), members: this.team().map((m) => m.user?.name), today: new Date().toISOString().slice(0, 10), scale: this.scale() }, this.project().id);
      this.usageId = r.usageId;
      const mid = Math.ceil(this.scale() / 2);
      this.d.set({ ...r.draft, changeType: r.draft.changeType || 'OTHER', probability: r.draft.probability ?? mid, impact: r.draft.impact ?? mid });
    } catch (e) { this.error.set(errorMessage(e, 'AI 起草失败')); } finally { this.busy.set(false); }
  }
  async save() {
    const x = this.d()!;
    if (x.title.trim().length < 2) { this.error.set('请填写标题'); return; }
    const pid = this.project().id;
    const clamp = (n: number | null) => Math.min(Math.max(Math.round(n ?? 1), 1), this.scale());
    this.error.set('');
    try {
      let created: { id: string };
      let entity: string;
      switch (x.type) {
        case 'NONCONFORMITY':
          created = await this.api.post(`/projects/${pid}/nonconformities`, { title: x.title, description: x.description || x.title, severity: x.severity, source: x.source }); entity = 'NONCONFORMITY'; break;
        case 'ISSUE': case 'ACTION':
          created = await this.api.post(`/projects/${pid}/issues`, { kind: x.type, title: x.title, description: x.description || undefined, ownerId: this.team().find((m) => m.user?.name === x.owner)?.userId, dueDate: x.dueDate || undefined }); entity = 'ISSUE'; break;
        case 'RISK': case 'OPPORTUNITY':
          created = await this.api.post(`/projects/${pid}/risks`, { kind: x.type, title: x.title, description: x.description || undefined, probability: clamp(x.probability), impact: clamp(x.impact) }); entity = 'RISK'; break;
        default:
          created = await this.api.post(`/projects/${pid}/changes`, { type: x.changeType || 'OTHER', title: x.title, description: x.description || x.title, reason: x.reason || x.description || x.title }); entity = 'CHANGE';
      }
      await this.ai.adopt(this.usageId, true, entity, created.id);
      this.d.set(null); this.text.set('');
      await this.router.navigateByUrl(`/projects/${pid}?${GO[x.type]}`);
      this.closed.emit();
    } catch (e) { this.error.set(errorMessage(e, '登记失败')); }
  }
  async discard() {
    if (this.usageId) await this.ai.adopt(this.usageId, false);
    this.d.set(null);
  }
}
