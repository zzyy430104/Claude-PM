import { Component, input, model } from '@angular/core';
import { ProjectType, Requirements } from '../core/models';

/**
 * 项目要求的录入：时间、交付物（C 类为库存计划行）、质量、成本、初步风险。
 * 立项申请和项目要求变更共用；每次修改都给出一份新对象（model 双向绑定）。
 */
@Component({
  selector: 'app-requirements-editor',
  styles: `
    h3 { font-size: 14px !important; margin: 16px 0 8px !important; color: var(--pm-text); }
    h3:first-child { margin-top: 0 !important; }
    .flags { display: flex; flex-wrap: wrap; gap: 6px 4px; margin: 4px 0 10px; font-size: 14px; color: var(--pm-text); }
  `,
  template: `
    @let r = value();
    <h3>时间</h3>
    @if (type() !== 'C') {
      <div class="fgrid">
        <label class="fld">全部交付日期 <span class="req">*</span>
          <input type="date" [value]="r.deliveryDate ?? ''" [disabled]="disabled()" (change)="set((x) => x.deliveryDate = str($event) || undefined)" aria-label="全部交付日期" /></label>
      </div>
    } @else {
      <p class="muted" style="margin: 0 0 6px">C 类按库存计划入库，最后一行的日期即全部入库日期。</p>
      <div class="listed">
        @for (s of r.stockLines; track $index; let i = $index) {
          <div class="line">
            <label class="fld">产品 <input [value]="s.product" [disabled]="disabled()" (change)="set((x) => x.stockLines[i].product = str($event))" /></label>
            <label class="fld" style="max-width: 120px">数量 <input type="number" min="1" [value]="s.quantity" [disabled]="disabled()" (change)="set((x) => x.stockLines[i].quantity = num($event))" /></label>
            <label class="fld" style="max-width: 170px">要求入库日期 <input type="date" [value]="s.date" [disabled]="disabled()" (change)="set((x) => x.stockLines[i].date = str($event))" /></label>
            @if (!disabled()) { <button type="button" class="x" (click)="set((x) => x.stockLines.splice(i, 1))" aria-label="删除此行">×</button> }
          </div>
        }
        @if (!disabled()) { <button type="button" class="addlink" (click)="set((x) => x.stockLines.push({ product: '', quantity: 1, date: '' }))">+ 添加库存计划行</button> }
      </div>
    }
    <div class="listed">
      @for (m of r.milestones; track $index; let i = $index) {
        <div class="line">
          <label class="fld">关键节点 <input [value]="m.name" [disabled]="disabled()" placeholder="如：首批交付、图纸确认" (change)="set((x) => x.milestones[i].name = str($event))" /></label>
          <label class="fld" style="max-width: 170px">日期 <input type="date" [value]="m.date" [disabled]="disabled()" (change)="set((x) => x.milestones[i].date = str($event))" /></label>
          @if (!disabled()) { <button type="button" class="x" (click)="set((x) => x.milestones.splice(i, 1))" aria-label="删除此节点">×</button> }
        </div>
      }
      @if (!disabled()) { <button type="button" class="addlink" (click)="set((x) => x.milestones.push({ name: '', date: '' }))">+ 添加关键节点</button> }
    </div>
    <div class="flags">
      <label><input type="checkbox" [checked]="r.longLead" [disabled]="disabled()" (change)="set((x) => x.longLead = chk($event))" /> 有长周期物料，需要提前订货</label>
    </div>

    @if (type() !== 'C') {
      <h3>交付物</h3>
      <div class="listed">
        @for (d of r.deliverables; track $index; let i = $index) {
          <div class="line">
            <label class="fld">名称 <input [value]="d.name" [disabled]="disabled()" (change)="set((x) => x.deliverables[i].name = str($event))" /></label>
            <label class="fld" style="max-width: 140px">数量 <input [value]="d.quantity" [disabled]="disabled()" placeholder="1200 套" (change)="set((x) => x.deliverables[i].quantity = str($event))" /></label>
            <label class="fld" style="max-width: 120px">类别
              <select [value]="d.kind" [disabled]="disabled()" (change)="set((x) => x.deliverables[i].kind = $any(str($event)))">
                <option value="PRODUCT" [selected]="d.kind === 'PRODUCT'">产品</option><option value="DOCUMENT" [selected]="d.kind === 'DOCUMENT'">文件</option>
              </select></label>
            @if (!disabled()) { <button type="button" class="x" (click)="set((x) => x.deliverables.splice(i, 1))" aria-label="删除此交付物">×</button> }
          </div>
        }
        @if (!disabled()) { <button type="button" class="addlink" (click)="set((x) => x.deliverables.push({ name: '', quantity: '', kind: 'PRODUCT' }))">+ 添加交付物</button> }
      </div>
    }

    <h3>质量</h3>
    <div class="fgrid">
      <label class="fld">适用标准（用顿号或逗号分隔）
        <input [value]="r.quality.standards.join('、')" [disabled]="disabled()" placeholder="ISO/TS 22163、EN 15085-2 CL1" (change)="set((x) => x.quality.standards = list($event))" /></label>
      <label class="fld">验收方式 <input [value]="r.quality.acceptance" [disabled]="disabled()" placeholder="出厂检验 / 客户验收" (change)="set((x) => x.quality.acceptance = str($event))" /></label>
    </div>
    <div class="fgrid">
      <label class="fld">特殊要求 <textarea rows="2" [value]="r.quality.special" [disabled]="disabled()" (change)="set((x) => x.quality.special = str($event))"></textarea></label>
    </div>
    <div class="flags">
      <label><input type="checkbox" [checked]="type() === 'A' || r.quality.fai" [disabled]="disabled() || type() === 'A'" (change)="set((x) => x.quality.fai = chk($event))" /> 做 FAI 首件鉴定{{ type() === 'A' ? '（A 类必做）' : '' }}</label>
      @if (type() === 'A' || r.quality.fai) {
        <label><input type="checkbox" [checked]="r.quality.customerWitness" [disabled]="disabled()" (change)="set((x) => x.quality.customerWitness = chk($event))" /> 客户见证 FAI / 批准首件</label>
      }
      @if (type() !== 'C') {
        <label><input type="checkbox" [checked]="r.quality.drawingApproval" [disabled]="disabled()" (change)="set((x) => x.quality.drawingApproval = chk($event))" /> 图纸须经客户审批</label>
      }
      <label><input type="checkbox" [checked]="r.quality.rams" [disabled]="disabled()" (change)="set((x) => x.quality.rams = chk($event))" /> 合同要求 RAMS 分析</label>
    </div>
    @if (type() !== 'A' && !r.quality.fai) {
      <div class="fgrid">
        <label class="fld">不做 FAI 的理由 <span class="req">*</span>
          <input [value]="r.quality.faiReason" [disabled]="disabled()" placeholder="如：工艺、图纸、供应商均未变更" (change)="set((x) => x.quality.faiReason = str($event))" /></label>
      </div>
    }

    <h3>成本</h3>
    <div class="fgrid">
      <label class="fld">成本上限（元） <span class="req">*</span>
        <input type="number" min="0" [value]="r.cost.cap || ''" [disabled]="disabled()" (change)="set((x) => x.cost.cap = num($event))" aria-label="成本上限" /></label>
      <label class="fld">目标成本（元）
        <input type="number" min="0" [value]="r.cost.target ?? ''" [disabled]="disabled()" (change)="set((x) => x.cost.target = num($event) || undefined)" /></label>
    </div>

    <h3>初步风险与机会</h3>
    <div class="listed">
      @for (k of r.risks; track $index; let i = $index) {
        <div class="line">
          <label class="fld" style="max-width: 110px">类别
            <select [value]="k.kind" [disabled]="disabled()" (change)="set((x) => x.risks[i].kind = $any(str($event)))"><option value="RISK" [selected]="k.kind === 'RISK'">风险</option><option value="OPPORTUNITY" [selected]="k.kind === 'OPPORTUNITY'">机会</option></select></label>
          <label class="fld">内容 <input [value]="k.text" [disabled]="disabled()" (change)="set((x) => x.risks[i].text = str($event))" /></label>
          @if (!disabled()) { <button type="button" class="x" (click)="set((x) => x.risks.splice(i, 1))" aria-label="删除此风险">×</button> }
        </div>
      }
      @if (!disabled()) { <button type="button" class="addlink" (click)="set((x) => x.risks.push({ kind: 'RISK', text: '' }))">+ 添加风险或机会</button> }
    </div>
  `,
})
export class RequirementsEditor {
  readonly value = model.required<Requirements>();
  readonly type = input.required<ProjectType>();
  readonly disabled = input(false);

  set(fn: (r: Requirements) => void) {
    const next = structuredClone(this.value());
    fn(next);
    this.value.set(next);
  }
  str(e: Event) { return ((e.target as HTMLInputElement).value ?? '').trim(); }
  num(e: Event) { const n = Number((e.target as HTMLInputElement).value); return Number.isFinite(n) ? n : 0; }
  chk(e: Event) { return (e.target as HTMLInputElement).checked; }
  list(e: Event) { return this.str(e).split(/[、,，;；]/).map((s) => s.trim()).filter(Boolean); }
}

/** 提交前清理：去掉空行和多余字段 */
export function cleanRequirements(r: Requirements, type: ProjectType): Requirements {
  // 只取项目要求本身的字段（版本数据里还带着 type 等，不能原样提交）
  return {
    longLead: !!r.longLead,
    deliveryDate: type === 'C' ? undefined : r.deliveryDate || undefined,
    milestones: r.milestones.filter((m) => m.name && m.date),
    deliverables: type === 'C' ? [] : r.deliverables.filter((d) => d.name),
    stockLines: type === 'C' ? r.stockLines.filter((s) => s.product && s.date && s.quantity > 0) : [],
    risks: r.risks.filter((k) => k.text),
    quality: {
      standards: r.quality.standards, special: r.quality.special, acceptance: r.quality.acceptance, fai: type === 'A' ? true : r.quality.fai,
      faiReason: r.quality.faiReason, customerWitness: r.quality.customerWitness, drawingApproval: r.quality.drawingApproval, rams: r.quality.rams,
    },
    cost: { cap: r.cost.cap || 0, ...(r.cost.target ? { target: r.cost.target } : {}) },
  };
}
