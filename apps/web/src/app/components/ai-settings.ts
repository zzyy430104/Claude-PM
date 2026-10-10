import { Component, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { Ai } from '../core/ai';
import { Api, errorMessage } from '../core/api';
import { askConfirm } from '../core/dialog';

interface Cfg { enabled: boolean; baseUrl: string; model: string; scenarios: Record<string, boolean>; perUserDaily: number; perTenantDaily: number; maxFileMb: number; maxInputChars: number }
interface Settings { config: Cfg; keyHint: string | null; labels: Record<string, string> }
interface Usage {
  stats: { scenario: string; label: string; calls: number; errors: number; adopted: number; tokens: number }[];
  rows: { id: string; at: string; user: string; label: string; model: string; status: string; error: string | null; adopted: boolean | null; tokens: number }[];
}

/** 企业设置 → AI 辅助：接口地址、模型、密钥（加密保存，只显示掩码）、场景开关、调用上限、使用记录 */
@Component({
  selector: 'app-ai-settings',
  imports: [MatButtonModule],
  styles: `
    .ok { color: var(--pm-green); margin-left: 8px; font-size: 13px; }
    .checks label { display: block; font-size: 14px; margin: 4px 0; }
    .num { text-align: right; white-space: nowrap; }
    .models { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
    .models button { border: 1px solid var(--pm-line); background: #fff; border-radius: 12px; padding: 2px 10px; font: inherit; font-size: 13px; cursor: pointer; }
  `,
  template: `
    <section class="pcard" style="margin-top: 24px">
      <header><h3>AI 辅助</h3><span class="sub">AI 只起草，人确认后才保存；不自动审批、关闭、发送</span></header>
      <div class="body">
        @if (error()) { <div class="error" role="alert">{{ error() }}</div> }
        @if (s(); as x) {
          <label style="font-size: 14px"><input type="checkbox" [checked]="x.config.enabled" (change)="set('enabled', $any($event.target).checked)" aria-label="启用 AI 辅助" /> 启用 AI 辅助</label>
          <div class="fgrid" style="margin-top: 10px">
            <label class="fld">接口地址（OpenAI 兼容）<input [value]="x.config.baseUrl" (change)="set('baseUrl', $any($event.target).value)" aria-label="接口地址" /></label>
            <label class="fld">模型<input [value]="x.config.model" (change)="set('model', $any($event.target).value)" aria-label="模型" /></label>
            <label class="fld">API 密钥（加密保存在服务器端）<input type="password" #k [placeholder]="x.keyHint ? '已设置 ' + x.keyHint + '，留空不修改' : '粘贴密钥'" aria-label="API 密钥" autocomplete="off" /></label>
          </div>
          <p class="muted" style="font-size: 12.5px; margin: 0">默认接 DeepSeek（https://api.deepseek.com）；换通义千问或内网自有模型时，只改接口地址、模型和密钥。</p>
          <div class="checks" style="margin-top: 10px">
            @for (k of keys(x); track k) { <label><input type="checkbox" [checked]="x.config.scenarios[k]" (change)="setScenario(k, $any($event.target).checked)" [attr.aria-label]="'场景 ' + x.labels[k]" /> {{ x.labels[k] }}</label> }
          </div>
          <div class="fgrid" style="margin-top: 10px">
            <label class="fld">每人每天调用上限<input type="number" min="1" [value]="x.config.perUserDaily" (change)="set('perUserDaily', +$any($event.target).value)" /></label>
            <label class="fld">全企业每天调用上限<input type="number" min="1" [value]="x.config.perTenantDaily" (change)="set('perTenantDaily', +$any($event.target).value)" /></label>
            <label class="fld">上传文件上限（MB）<input type="number" min="1" [value]="x.config.maxFileMb" (change)="set('maxFileMb', +$any($event.target).value)" /></label>
            <label class="fld">送给模型的文字上限（字）<input type="number" min="1000" [value]="x.config.maxInputChars" (change)="set('maxInputChars', +$any($event.target).value)" /></label>
          </div>
          <div style="margin-top: 12px; display: flex; gap: 8px; align-items: center; flex-wrap: wrap">
            <button mat-flat-button type="button" (click)="save(k.value); k.value = ''">保存 AI 设置</button>
            @if (x.keyHint) { <button mat-button type="button" (click)="removeKey()">删除密钥</button> }
            <button mat-stroked-button type="button" (click)="test()">测试连接</button>
            @if (saved()) { <span class="ok">已保存</span> }
          </div>
          @if (testResult(); as t) {
            @if (t.ok) {
              <div style="margin-top: 8px; font-size: 13.5px">连接成功，可用模型（点选设为当前模型）：
                <div class="models">@for (m of t.models ?? []; track m) { <button type="button" (click)="set('model', m)">{{ m }}</button> }</div></div>
            } @else { <div class="error" style="margin-top: 8px">连接失败：{{ t.status ?? '' }} {{ t.message }}</div> }
          }
        }
      </div>
    </section>
    <section class="pcard">
      <header><h3>AI 使用记录</h3><span class="sub">最近 30 天</span><span class="grow"></span><button mat-button type="button" (click)="loadUsage()">刷新</button></header>
      @if (u(); as x) {
        <div class="tblwrap"><table>
          <thead><tr><th>场景</th><th class="num">调用</th><th class="num">失败</th><th class="num">采纳</th><th class="num">用量（token）</th></tr></thead>
          <tbody>@for (r of x.stats; track r.scenario) { <tr><td>{{ r.label }}</td><td class="num">{{ r.calls }}</td><td class="num">{{ r.errors }}</td><td class="num">{{ r.adopted }}</td><td class="num">{{ r.tokens.toLocaleString() }}</td></tr> }</tbody>
        </table></div>
        <div class="tblwrap"><table>
          <thead><tr><th>时间</th><th>谁</th><th>场景</th><th>模型</th><th>结果</th><th>是否采纳</th></tr></thead>
          <tbody>
            @for (r of x.rows; track r.id) { <tr><td style="white-space: nowrap">{{ r.at.slice(0, 16).replace('T', ' ') }}</td><td>{{ r.user }}</td><td>{{ r.label }}</td><td>{{ r.model }}</td><td>{{ r.status === 'OK' ? '成功' : '失败：' + (r.error ?? '') }}</td><td>{{ r.adopted === true ? '已采纳' : r.adopted === false ? '未采纳' : '—' }}</td></tr> }
            @empty { <tr><td colspan="6" class="muted">还没有使用记录</td></tr> }
          </tbody>
        </table></div>
      }
    </section>
  `,
})
export class AiSettings {
  private readonly api = inject(Api);
  private readonly ai = inject(Ai);
  readonly s = signal<Settings | null>(null);
  readonly u = signal<Usage | null>(null);
  readonly error = signal('');
  readonly saved = signal(false);
  readonly testResult = signal<{ ok: boolean; models?: string[]; status?: number; message?: string } | null>(null);
  private pending: Partial<Cfg> = {};

  async ngOnInit() {
    try { this.s.set(await this.api.get<Settings>('/ai-settings')); } catch (e) { this.error.set(errorMessage(e, '加载失败')); }
    await this.loadUsage();
  }
  async loadUsage() { try { this.u.set(await this.api.get<Usage>('/ai/usage')); } catch { /* 忽略 */ } }
  keys(x: Settings) { return Object.keys(x.labels); }
  set<K extends keyof Cfg>(k: K, v: Cfg[K]) {
    this.saved.set(false);
    this.pending = { ...this.pending, [k]: v };
    this.s.update((x) => (x ? { ...x, config: { ...x.config, [k]: v } } : x));
  }
  setScenario(k: string, on: boolean) { this.set('scenarios', { ...this.s()!.config.scenarios, [k]: on }); }
  async save(apiKey: string) {
    this.error.set('');
    try {
      this.s.set(await this.api.put<Settings>('/ai-settings', { ...this.s()!.config, ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}) }));
      this.pending = {};
      this.saved.set(true);
      await this.ai.load(true);
    } catch (e) { this.error.set(errorMessage(e, '保存失败')); }
  }
  async removeKey() {
    if (!await askConfirm('删除 AI 密钥？删除后 AI 按钮全部隐藏。')) return;
    try { this.s.set(await this.api.put<Settings>('/ai-settings', { apiKey: null })); await this.ai.load(true); } catch (e) { this.error.set(errorMessage(e, '删除失败')); }
  }
  async test() {
    this.testResult.set(null);
    try { this.testResult.set(await this.api.post('/ai-settings/test', {})); } catch (e) { this.testResult.set({ ok: false, message: errorMessage(e, '测试失败') }); }
  }
}
