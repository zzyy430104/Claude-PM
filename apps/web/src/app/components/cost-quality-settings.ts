import { Component, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { Api, errorMessage } from '../core/api';
import { Brand } from '../core/brand';
import { FunctionalRole } from '../core/models';

/** 企业设置里的两块：职能角色标准费率（工作包人工成本）、检验 / 验证项类别 */
@Component({
  selector: 'app-cost-quality-settings',
  imports: [MatButtonModule],
  styles: `
    section { max-width: 760px; }
    .rates { display: grid; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); gap: 10px 16px; }
    .rates input { width: 110px; }
    .chips { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
    .chip { display: inline-flex; gap: 4px; align-items: center; border: 1px solid var(--pm-line); border-radius: 999px; padding: 3px 6px 3px 12px; background: #fff; font-size: 14px; }
    .chip button { border: 0; background: none; cursor: pointer; color: var(--pm-muted); }
    .ok { color: var(--pm-green); margin-left: 8px; font-size: 13px; }
  `,
  template: `
    <section>
      <h2>职能角色费率</h2>
      <p class="muted">工作包人工成本 = 人天 × 该工作包职能角色的标准费率（元 / 人天）。工作包里可以手工改费率，但要写原因。改这里只影响以后重新计算的预算。</p>
      <div class="rates">
        @for (r of roles(); track r.id) {
          <label class="fld">{{ r.name }}<span><input type="number" min="0" [value]="+(r.rate ?? 0)" (change)="setRate(r, $any($event.target).value)" [attr.aria-label]="r.name + '费率'" /> 元/人天</span></label>
        }
      </div>
      @if (savedRate()) { <span class="ok">已保存</span> }
    </section>
    <section>
      <h2>检验 / 验证项类别</h2>
      <p class="muted">工作包上的检验 / 验证项按类别区分，不限于产品检验。</p>
      <div class="chips">
        @for (c of cats(); track c) { <span class="chip">{{ c }}<button type="button" (click)="removeCat(c)" [attr.aria-label]="'删除类别 ' + c">✕</button></span> }
        <input #nc class="fld-input" placeholder="新类别，如：包装" aria-label="新类别" style="width: 140px; border: 1px solid var(--pm-line); border-radius: 8px; padding: 5px 8px" />
        <button mat-stroked-button type="button" (click)="addCat(nc.value); nc.value = ''">添加类别</button>
      </div>
      @if (savedCat()) { <span class="ok">已保存</span> }
    </section>
    @if (error()) { <div class="error" role="alert">{{ error() }}</div> }
  `,
})
export class CostQualitySettings {
  private readonly api = inject(Api);
  private readonly brand = inject(Brand);
  readonly roles = signal<FunctionalRole[]>([]);
  readonly cats = signal<string[]>([]);
  readonly error = signal('');
  readonly savedRate = signal(false);
  readonly savedCat = signal(false);

  async ngOnInit() {
    try {
      this.roles.set((await this.api.get<FunctionalRole[]>('/functional-roles')).filter((r) => r.active));
      this.cats.set((await this.api.get<{ inspectionCategories: string[] }>('/tenant-settings')).inspectionCategories);
    } catch (e) { this.error.set(errorMessage(e, '加载失败')); }
  }
  async setRate(r: FunctionalRole, v: string) {
    this.error.set(''); this.savedRate.set(false);
    try { await this.api.patch(`/functional-roles/${r.id}`, { rate: Math.max(0, +v || 0) }); this.savedRate.set(true); } catch (e) { this.error.set(errorMessage(e, '保存失败')); }
  }
  private async saveCats(list: string[]) {
    this.error.set(''); this.savedCat.set(false);
    try {
      const s = await this.api.patch<{ inspectionCategories: string[] }>('/tenant-settings', { inspectionCategories: list });
      this.cats.set(s.inspectionCategories); this.brand.inspectionCategories.set(s.inspectionCategories); this.savedCat.set(true);
    } catch (e) { this.error.set(errorMessage(e, '保存失败')); }
  }
  addCat(v: string) { v = v.trim(); if (v && !this.cats().includes(v)) void this.saveCats([...this.cats(), v]); }
  removeCat(c: string) {
    if (this.cats().length <= 1) { this.error.set('至少保留一个类别'); return; }
    void this.saveCats(this.cats().filter((x) => x !== c));
  }
}
