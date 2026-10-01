import { Component, inject, input, output, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { Ai } from '../core/ai';
import { errorMessage } from '../core/api';
import { ProjectType, Requirements } from '../core/models';

type Src<T> = { value: T; source: string };
export interface ContractDraft {
  customer: Src<string | null>; contractNo: Src<string | null>; contractAmount: Src<number | null>; deliveryDate: Src<string>;
  milestones: { name: string; date: string; source: string }[];
  deliverables: { name: string; quantity: string; kind: 'PRODUCT' | 'DOCUMENT'; source: string }[];
  stockLines: { product: string; quantity: string; date: string; source: string }[];
  quality: { standards: Src<string[]>; acceptance: Src<string | null>; special: Src<string | null>; fai: Src<boolean | null>; customerWitness: Src<boolean | null>; drawingApproval: Src<boolean | null>; rams: Src<boolean | null> };
  cost: { cap: Src<number | null> };
  risks: { text: string; kind: 'RISK' | 'OPPORTUNITY'; source: string }[];
}
export interface ContractFields { customer?: string; contractNo?: string; contractAmount?: string }
interface Row { group: string; label: string; value: string; source: string; on: boolean; apply: (f: ContractFields, r: Requirements) => void }

/** 立项申请：上传合同、技术协议或库存计划，AI 列出交期、数量、质量和金额条款并注明出处；逐条确认后写入表单 */
@Component({
  selector: 'app-ai-contract',
  imports: [MatButtonModule],
  styles: `
    .ai { border: 1px dashed var(--pm-primary); border-radius: var(--pm-radius); padding: 12px 16px; margin: 0 0 16px; background: var(--pm-card); }
    .ai h3 { margin: 0 0 4px; font-size: 15px; } .ai h3 .pill { margin-right: 6px; }
    td.src { color: var(--pm-muted); font-size: 12.5px; white-space: nowrap; } td.g { color: var(--pm-muted); font-size: 12.5px; white-space: nowrap; }
    .tools { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-top: 10px; } .tools .sp { flex: 1; }
  `,
  template: `
    <div class="ai" data-ai="contract">
      <h3><span class="pill blue">AI</span>从合同起草项目要求</h3>
      <p class="muted" style="margin: 0 0 8px; font-size: 13px">上传合同、技术协议或库存计划（PDF、Word、Excel），AI 列出交期、数量、质量和金额条款并注明出处。每条由你勾选确认后才写入表单。</p>
      @if (error()) { <div class="error" role="alert">{{ error() }}</div> }
      <div class="tools">
        <input type="file" #f multiple accept=".pdf,.docx,.xlsx,.txt" aria-label="合同文件" (change)="files.set($any($event.target).files ? [].slice.call($any($event.target).files) : [])" />
        <button mat-stroked-button type="button" [disabled]="!files().length || busy()" (click)="run()">{{ busy() ? 'AI 正在读取…' : '读取并起草' }}</button>
      </div>
      @if (rows().length) {
        <div class="tblwrap" style="margin-top: 10px"><table>
          <thead><tr><th></th><th>类别</th><th>条目</th><th>AI 起草的内容</th><th>出处</th></tr></thead>
          <tbody>
            @for (r of rows(); track $index; let i = $index) {
              <tr [attr.data-row]="r.label"><td><input type="checkbox" [checked]="r.on" (change)="toggle(i, $any($event.target).checked)" [attr.aria-label]="'采用 ' + r.label" /></td>
                <td class="g">{{ r.group }}</td><td>{{ r.label }}</td><td>{{ r.value }}</td><td class="src">{{ r.source || '—' }}</td></tr>
            }
          </tbody>
        </table></div>
        <div class="tools"><span class="muted" style="font-size: 12.5px">请对照原文核对；没有出处的条目要特别留意。</span><span class="sp"></span>
          <button mat-button type="button" (click)="discard()">放弃</button>
          <button mat-flat-button type="button" (click)="applySelected()">采用选中的 {{ selected() }} 项</button></div>
      }
    </div>
  `,
})
export class AiContract {
  private readonly ai = inject(Ai);
  readonly type = input<ProjectType>('B');
  readonly applied = output<{ fields: ContractFields; apply: (r: Requirements) => Requirements; usageId: string }>();
  readonly files = signal<File[]>([]);
  readonly rows = signal<Row[]>([]);
  readonly busy = signal(false);
  readonly error = signal('');
  private usageId = '';

  selected() { return this.rows().filter((r) => r.on).length; }
  toggle(i: number, on: boolean) { this.rows.update((rs) => rs.map((r, j) => (j === i ? { ...r, on } : r))); }

  async run() {
    this.busy.set(true); this.error.set(''); this.rows.set([]);
    try {
      const d = await this.ai.draftFiles<ContractDraft>('CONTRACT', this.files(), { projectType: this.type() });
      this.usageId = d.usageId;
      this.rows.set(this.toRows(d.draft));
      if (!this.rows().length) this.error.set('AI 没有从文件里找到项目要求相关的条款');
    } catch (e) { this.error.set(errorMessage(e, 'AI 起草失败')); } finally { this.busy.set(false); }
  }

  private toRows(d: ContractDraft): Row[] {
    const rows: Row[] = [];
    const add = (group: string, label: string, value: string, source: string, apply: Row['apply']) => { if (value) rows.push({ group, label, value, source, on: true, apply }); };
    const yes = (b: boolean | null) => (b === null ? '' : b ? '是' : '否');
    if (this.type() !== 'C') {
      add('合同', '客户', d.customer.value ?? '', d.customer.source, (f) => { f.customer = d.customer.value ?? ''; });
      add('合同', '合同号', d.contractNo.value ?? '', d.contractNo.source, (f) => { f.contractNo = d.contractNo.value ?? ''; });
      add('合同', '合同金额（元）', d.contractAmount.value ? d.contractAmount.value.toLocaleString() : '', d.contractAmount.source, (f) => { f.contractAmount = String(d.contractAmount.value); });
      add('时间', '全部交付日期', d.deliveryDate.value, d.deliveryDate.source, (_f, r) => { r.deliveryDate = d.deliveryDate.value; });
    }
    for (const m of d.milestones) add('时间', '关键节点', `${m.name} · ${m.date}`, m.source, (_f, r) => { r.milestones = [...r.milestones.filter((x) => x.name !== m.name), { name: m.name, date: m.date }]; });
    for (const x of d.deliverables) add('交付物', x.kind === 'DOCUMENT' ? '文件' : '产品', `${x.name}${x.quantity ? ' · ' + x.quantity : ''}`, x.source, (_f, r) => { r.deliverables = [...r.deliverables.filter((y) => y.name !== x.name), { name: x.name, quantity: x.quantity, kind: x.kind }]; });
    for (const s of d.stockLines) add('库存计划', '库存计划行', `${s.product} · ${s.quantity} · ${s.date}`, s.source, (_f, r) => { r.stockLines = [...r.stockLines, { product: s.product, quantity: Number(String(s.quantity).replace(/[^\d.]/g, '')) || 0, date: s.date }]; });
    const q = d.quality;
    add('质量', '适用标准', q.standards.value.join('、'), q.standards.source, (_f, r) => { r.quality = { ...r.quality, standards: [...new Set([...r.quality.standards, ...q.standards.value])] }; });
    add('质量', '验收方式', q.acceptance.value ?? '', q.acceptance.source, (_f, r) => { r.quality = { ...r.quality, acceptance: q.acceptance.value ?? '' }; });
    add('质量', '做 FAI', yes(q.fai.value), q.fai.source, (_f, r) => { r.quality = { ...r.quality, fai: !!q.fai.value }; });
    add('质量', '客户见证 FAI', yes(q.customerWitness.value), q.customerWitness.source, (_f, r) => { r.quality = { ...r.quality, customerWitness: !!q.customerWitness.value }; });
    add('质量', '图纸须客户审批', yes(q.drawingApproval.value), q.drawingApproval.source, (_f, r) => { r.quality = { ...r.quality, drawingApproval: !!q.drawingApproval.value }; });
    add('质量', 'RAMS 分析', yes(q.rams.value), q.rams.source, (_f, r) => { r.quality = { ...r.quality, rams: !!q.rams.value }; });
    add('质量', '特殊要求', q.special.value ?? '', q.special.source, (_f, r) => { r.quality = { ...r.quality, special: q.special.value ?? '' }; });
    add('成本', '成本上限（元）', d.cost.cap.value ? d.cost.cap.value.toLocaleString() : '', d.cost.cap.source, (_f, r) => { r.cost = { ...r.cost, cap: d.cost.cap.value ?? 0 }; });
    for (const k of d.risks) add('风险', k.kind === 'RISK' ? '初步风险' : '初步机会', k.text, k.source, (_f, r) => { r.risks = [...r.risks.filter((y) => y.text !== k.text), { text: k.text, kind: k.kind }]; });
    return rows;
  }

  applySelected() {
    const chosen = this.rows().filter((r) => r.on);
    const fields: ContractFields = {};
    const apply = (req: Requirements) => {
      const r: Requirements = structuredClone(req);
      for (const c of chosen) c.apply(fields, r);
      return r;
    };
    // 先跑一遍拿到基本信息字段
    apply({ milestones: [], deliverables: [], stockLines: [], risks: [], longLead: false, quality: { standards: [], special: '', acceptance: '', fai: false, faiReason: '', customerWitness: false, drawingApproval: false, rams: false }, cost: { cap: 0 } });
    this.applied.emit({ fields, apply, usageId: this.usageId });
    this.rows.set([]);
  }
  async discard() {
    if (this.usageId) await this.ai.adopt(this.usageId, false);
    this.rows.set([]);
  }
}
