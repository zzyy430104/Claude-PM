import { Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { Api, errorMessage } from '../core/api';
import { Discussion } from './discussion';
import { AiMark } from './ai-mark';
import { Ai } from '../core/ai';
import { AuthService } from '../core/auth.service';
import { askText } from '../core/i18n';
import { CdkDrag, CdkDragHandle } from '@angular/cdk/drag-drop';
import { portalToBody } from '../core/portal';
import {
  ACCEPT_NEED_LABELS, IMPORTANCE_LABELS, Importance, Objective, RISK_LEVEL_LABELS, RISK_STATUS_LABELS, RISK_WHO_LABELS,
  RiskLevelKey, RiskReviewRow, RiskRow, RiskSettings,
} from '../core/models';

export interface RiskPerson { id: string; name: string }
export type RiskStep = 'id' | 'ev' | 'plan' | 'warn' | 'close' | 'talk';
const IMP: Importance[] = ['LOW', 'MEDIUM', 'HIGH'];
const ACCEPT = '接受';
/** 与后端一致：5 级 10/30/50/70/90%；3 级按 1、3、5 级取 */
const PROB_PCT: Record<number, number[]> = { 3: [10, 50, 90], 5: [10, 30, 50, 70, 90] };
const LEVEL_NAMES: Record<number, string[]> = { 3: ['低', '中', '高'], 5: ['很低', '低', '中', '高', '很高'] };

interface Draft {
  kind: 'RISK' | 'OPPORTUNITY'; level: RiskLevelKey; title: string; cause: string; effect: string;
  objectiveId: string; workPackageId: string; ownerId: string; projectIds: string[];
  probability: number; impact: number; exposureAmount: number; responseCost: number; costBenefitAnalysis: string;
  strategy: string; acceptReason: string; contingencyPlan: string; trigger: string; reviewCycleDays: number;
  maturityLevel: string; functionalReviewers: string; budgetRecovery: number;
}

/** 风险 / 机会详情：识别 → 评价 → 应对 → 预警 → 复评与关闭（企业级、项目级、工作包级共用） */
@Component({
  selector: 'app-risk-drawer',
  imports: [CdkDrag, CdkDragHandle, MatButtonModule, Discussion, AiMark],
  styles: `
    .shade { position: fixed; inset: 0; background: rgba(20, 26, 24, .38); z-index: 1000; display: flex; justify-content: flex-end; }
    .win { background: var(--pm-card); width: min(680px, 100%); height: 100%; display: flex; flex-direction: column; box-shadow: -8px 0 24px rgba(0,0,0,.15); }
    .win > header { display: flex; justify-content: space-between; gap: 12px; padding: 16px 20px 6px; cursor: move; user-select: none; }
    .win > header h2 { margin: 2px 0 0 !important; font-size: 18px; }
    .x { border: 0; background: none; font-size: 20px; cursor: pointer; color: var(--pm-muted); }
    nav { display: flex; gap: 2px; border-bottom: 1px solid var(--pm-line); padding: 0 20px; overflow-x: auto; }
    nav button { border: 0; background: none; padding: 9px 12px; font: inherit; color: var(--pm-muted); border-bottom: 2px solid transparent; cursor: pointer; white-space: nowrap; }
    nav button[aria-selected=true] { color: var(--pm-text); font-weight: 700; border-bottom-color: var(--pm-primary); }
    nav button:disabled { opacity: .4; cursor: default; }
    .body { flex: 1; overflow: auto; padding: 16px 20px; }
    h4 { margin: 16px 0 8px; font-size: 14px; }
    dl.kv { display: grid; grid-template-columns: 110px 1fr; gap: 8px 12px; margin: 12px 0; font-size: 14px; } dl.kv dt { color: var(--pm-muted); } dl.kv dd { margin: 0; }
    .chips { display: flex; flex-wrap: wrap; gap: 6px; }
    .chip { border: 1px solid var(--pm-line); background: #fff; border-radius: 16px; padding: 5px 12px; font: inherit; font-size: 13.5px; cursor: pointer; }
    .chip.on { background: var(--pm-primary); color: #fff; border-color: var(--pm-primary); }
    .mxw { display: inline-flex; flex-direction: column; gap: 4px; }
    .mxg { display: grid; gap: 4px; align-items: center; }
    .mxl { font-size: 12px; color: var(--pm-muted); text-align: right; padding-right: 4px; } .mxl.c { text-align: center; padding: 0; }
    .mx { width: 46px; height: 34px; border-radius: 6px; border: 2px solid transparent; cursor: pointer; font-size: 14px; color: #fff; }
    .mx.m0 { background: #8fbf9f; } .mx.m1 { background: #e3b55b; } .mx.m2 { background: #d0684f; }
    .mx.on { border-color: var(--pm-text); box-shadow: 0 0 0 2px #fff inset; }
    .mx:disabled { cursor: default; }
    .cap { font-size: 12px; color: var(--pm-muted); }
    .num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
    input.sm, select.sm { font: inherit; font-size: 14px; border: 1px solid var(--pm-line); border-radius: 8px; padding: 5px 8px; background: #fff; }
    .tools { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-top: 10px; } .tools .sp { flex: 1; }
    .banner { border-radius: 10px; padding: 10px 12px; font-size: 13.5px; margin: 0 0 12px; }
    .banner.ok { background: var(--pm-green-bg); color: var(--pm-green); } .banner.red { background: var(--pm-red-bg); color: #6d2a1d; } .banner.amber { background: var(--pm-amber-bg); color: #6b4a10; }
    ul.auto { list-style: none; padding: 0; margin: 0; font-size: 14px; } ul.auto li::before { content: '✓ '; color: var(--pm-green); }
    textarea { min-height: 64px; }
    .win > footer { display: flex; align-items: center; gap: 12px; padding: 10px 20px; border-top: 1px solid var(--pm-line); }
    .win > footer .rule { flex: 1; font-size: 12.5px; color: var(--pm-muted); }
  `,
  template: `
    <div class="shade" (click)="$event.target === $event.currentTarget && closed.emit()">
      <div class="win" cdkDrag cdkDragBoundary=".shade" role="dialog" [attr.aria-label]="risk()?.title ?? '新增风险'">
        <header cdkDragHandle title="按住拖动">
          <div>
            <div class="muted" style="font-size: 12px">{{ d().kind === 'RISK' ? '风险' : '机会' }} · {{ levelLabel(d().level) }}@if (risk(); as r) { · {{ statusLabel(r) }} }</div>
            <h2>{{ risk()?.title || '新增' + (d().kind === 'RISK' ? '风险' : '机会') }}</h2>
            @if (risk(); as r) { <app-ai-mark entity="RISK" [id]="r.id" /> }
          </div>
          <button class="x" type="button" (click)="closed.emit()" aria-label="关闭">✕</button>
        </header>
        <nav role="tablist">
          @for (t of steps; track t[0]) { <button type="button" role="tab" [attr.aria-selected]="step() === t[0]" [disabled]="(!risk() && (t[0] === 'warn' || t[0] === 'close' || t[0] === 'talk')) || (t[0] === 'talk' && (!projectId() || risk()?.level === 'ENTERPRISE'))" (click)="step.set(t[0])">{{ t[1] }}</button> }
        </nav>
        <div class="body">
          @if (error()) { <div class="error" role="alert">{{ error() }}</div> }
          @if (risk()?.status === 'CLOSED') { <div class="banner ok">已关闭：{{ risk()!.closureNote }}</div> }
          @if (risk()?.status === 'OCCURRED') { <div class="banner red">风险已发生，已转为问题@for (i of risk()!.issues; track i.id) { “{{ i.title }}” }，在「问题与行动」跟踪。</div> }
          @switch (step()) {
            @case ('id') {
              <div class="fgrid">
                <label class="fld" style="grid-column: 1 / -1">描述 <span class="req">*</span><input [value]="d().title" (input)="set('title', $any($event.target).value)" aria-label="风险描述" [disabled]="locked()" /></label>
                <label class="fld">类型<select (change)="set('kind', $any($event.target).value)" [disabled]="!!risk()" aria-label="类型">
                  <option value="RISK" [selected]="d().kind === 'RISK'">风险</option><option value="OPPORTUNITY" [selected]="d().kind === 'OPPORTUNITY'">机会</option></select></label>
                <label class="fld">层级
                  @if (projectId() && !risk()) {
                    <select (change)="set('level', $any($event.target).value)" aria-label="层级">
                      <option value="PROJECT" [selected]="d().level === 'PROJECT'">项目级</option><option value="WORK_PACKAGE" [selected]="d().level === 'WORK_PACKAGE'">工作包级</option></select>
                  } @else { <input [value]="levelLabel(d().level)" disabled /> }
                </label>
                <label class="fld">原因<input [value]="d().cause" (input)="set('cause', $any($event.target).value)" [disabled]="locked()" /></label>
                <label class="fld">后果<input [value]="d().effect" (input)="set('effect', $any($event.target).value)" [disabled]="locked()" /></label>
                @if (d().level !== 'ENTERPRISE') {
                  <label class="fld">影响的项目目标<select (change)="set('objectiveId', $any($event.target).value)" [disabled]="locked()" aria-label="影响的项目目标">
                    <option value="">（不指定）</option>@for (o of objectives(); track o.id) { <option [value]="o.id" [selected]="o.id === d().objectiveId">{{ o.dimension }} · {{ o.name }}</option> }</select></label>
                  <label class="fld">关联工作包<select (change)="set('workPackageId', $any($event.target).value)" [disabled]="locked()" aria-label="关联工作包">
                    <option value="">（不指定）</option>@for (w of wps(); track w.id) { <option [value]="w.id" [selected]="w.id === d().workPackageId">{{ w.code }} {{ w.name }}</option> }</select></label>
                }
                <label class="fld">责任人<select (change)="set('ownerId', $any($event.target).value)" [disabled]="locked()" aria-label="责任人">
                  <option value="">（我）</option>@for (p of people(); track p.id) { <option [value]="p.id" [selected]="p.id === d().ownerId">{{ p.name }}</option> }</select></label>
              </div>
              @if (d().level === 'ENTERPRISE' && projects().length) {
                <div class="fld" style="display: block">受影响的项目
                  <div class="chips" style="margin-top: 6px">@for (p of projects(); track p.id) { <button type="button" class="chip" [class.on]="d().projectIds.includes(p.id)" (click)="toggleProject(p.id)" [disabled]="locked()">{{ p.code }} {{ p.name }}</button> }</div>
                </div>
              } @else if (risk()?.projects?.length) {
                <p class="muted">挂到的项目：@for (p of risk()!.projects; track p.id) { {{ p.code }} {{ p.name }}　}</p>
              }
              <div class="tools">
                @if (risk() && projectId() && risk()!.level !== 'ENTERPRISE' && open()) {
                  <button mat-stroked-button type="button" (click)="escalate()">升级为{{ risk()!.level === 'WORK_PACKAGE' ? '项目级' : '企业级' }}</button>
                }
                <span class="muted" style="font-size: 12.5px">所有层级的风险在企业内公开可见</span>
              </div>
            }
            @case ('ev') {
              <p class="muted" style="margin: 0 0 10px">点格子选可能性和影响。影响按下方各维度的判断标准（企业设置里定义）。</p>
              <div class="mxw">
                <div class="cap">纵向：可能性　横向：影响</div>
                <div class="mxg" [style.grid-template-columns]="'auto repeat(' + scale() + ', 46px)'">
                  @for (p of rowsDesc(); track p) {
                    <span class="mxl">{{ lv(p) }}</span>
                    @for (i of cols(); track i) { <button type="button" class="mx" [class]="'mx m' + cell(p, i)" [class.on]="p === d().probability && i === d().impact" (click)="pick(p, i)" [disabled]="locked()" [attr.aria-label]="'可能性 ' + lv(p) + ' 影响 ' + lv(i)">{{ p === d().probability && i === d().impact ? '●' : '' }}</button> }
                  }
                  <span></span>@for (i of cols(); track i) { <span class="mxl c">{{ lv(i) }}</span> }
                </div>
              </div>
              <dl class="kv">
                <dt>重要度</dt><dd><span class="pill" [class]="'pill ' + impColor(imp())">{{ impLabel(imp()) }}</span>（可能性 {{ d().probability }} × 影响 {{ d().impact }}）</dd>
                @for (c of criteria(); track c[0]) { <dt>{{ c[0] }}</dt><dd style="font-size: 13px">@for (t of c[1]; track $index) { {{ impLabel(impAt($index)) }}：{{ t }}@if (!$last) { · } }</dd> }
              </dl>
              <div class="fgrid">
                <label class="fld">{{ d().kind === 'RISK' ? '潜在损失' : '潜在收益' }}（元）<input type="number" min="0" [value]="d().exposureAmount" (input)="set('exposureAmount', +$any($event.target).value)" [disabled]="locked()" aria-label="潜在金额" /></label>
                @if (d().kind === 'OPPORTUNITY') { <label class="fld">可弥补预算损失的金额（元）<input type="number" min="0" [value]="d().budgetRecovery" (input)="set('budgetRecovery', +$any($event.target).value)" [disabled]="locked()" aria-label="可弥补预算" /></label> }
                <label class="fld">产品成熟度（与客户商定）<input [value]="d().maturityLevel" (input)="set('maturityLevel', $any($event.target).value)" placeholder="如 TRL 7、已批量应用" [disabled]="locked()" aria-label="产品成熟度" /></label>
                <label class="fld">参与评审的职能经理<input [value]="d().functionalReviewers" (input)="set('functionalReviewers', $any($event.target).value)" [disabled]="locked()" aria-label="参与评审的职能经理" /></label>
              </div>
            }
            @case ('plan') {
              @if (ai.on('ANALYSIS') && !locked()) {
                <div class="tools" style="margin: 0 0 10px"><button mat-stroked-button type="button" [disabled]="aiBusy() || d().title.trim().length < 2" (click)="aiRisk()"><span class="pill blue">AI</span> {{ aiBusy() ? '正在起草…' : '起草原因、后果、措施和成本收益分析' }}</button></div>
                @if (aiMeasures().length) {
                  <div class="banner amber" data-ai="measures">AI 建议的措施（确认后添加）：
                    @for (x of aiMeasures(); track $index) { <div>· {{ x }} @if (risk() && open()) { <button mat-button type="button" (click)="addMeasure(x, '', '', 0); dropMeasure($index)">添加</button> } </div> }
                  </div>
                }
              }
              <div class="fld" style="display: block">应对策略
                <div class="chips" style="margin-top: 6px">@for (s of strategies(); track s) { <button type="button" class="chip" [class.on]="s === d().strategy" (click)="set('strategy', d().strategy === s ? '' : s)" [disabled]="locked()">{{ s }}</button> }</div>
              </div>
              <div class="fgrid" style="margin-top: 12px">
                <label class="fld">应对成本（元）<input type="number" min="0" [value]="d().responseCost" (input)="set('responseCost', +$any($event.target).value)" [disabled]="locked()" aria-label="应对成本" /></label>
                <label class="fld" style="grid-column: 1 / -1">成本收益分析@if (d().strategy) { <span class="req">*</span> }<textarea [value]="d().costBenefitAnalysis" (input)="set('costBenefitAnalysis', $any($event.target).value)" [disabled]="locked()" aria-label="成本收益分析"></textarea></label>
              </div>
              <p class="muted" style="font-size: 13px">期望价值 {{ expected().toLocaleString() }} 元（潜在金额 × 可能性）；@if (d().responseCost) { {{ expected() >= d().responseCost ? '应对划算' : '应对成本高于期望价值' }} } @else { 填写应对成本后比较 }</p>
              @if (d().strategy === accept) {
                <div class="fgrid">
                  <label class="fld" style="grid-column: 1 / -1">接受的理由 <span class="req">*</span><textarea [value]="d().acceptReason" (input)="set('acceptReason', $any($event.target).value)" [disabled]="locked()" aria-label="接受的理由"></textarea></label>
                  <label class="fld" style="grid-column: 1 / -1">应急预案@if (rule().accept !== 'REASON') { <span class="req">*</span> }<textarea [value]="d().contingencyPlan" (input)="set('contingencyPlan', $any($event.target).value)" [disabled]="locked()" aria-label="应急预案"></textarea></label>
                </div>
                <p style="font-size: 13px">
                  按规则：{{ acceptNeed() }}。
                  @if (rule().accept === 'REASON_PLAN_APPROVAL') {
                    @if (risk()?.acceptApprovedAt) { <span class="pill green">管理层已确认</span> }
                    @else if (risk()?.strategy === accept && isMgmt()) { <button mat-stroked-button type="button" (click)="approveAccept()">确认接受</button> }
                    @else { <span class="pill amber">保存后等待管理层确认</span> }
                  }
                </p>
              }
              <h4>措施 <small class="muted">@if (d().level === 'ENTERPRISE') { 企业级风险的措施在这里跟踪 } @else { 每条措施就是一个行动项，在「问题与行动」统一跟踪 }</small></h4>
              <div class="tblwrap"><table>
                <thead><tr><th>措施</th><th>责任人</th><th>期限</th>@if (d().level === 'ENTERPRISE') { <th class="num">费用</th> }<th>状态</th></tr></thead>
                <tbody>
                  @for (m of risk()?.measures ?? []; track m.id) {
                    <tr>
                      <td>{{ m.title }}</td><td>{{ name(m.ownerId) }}</td><td>{{ m.dueDate ?? '—' }}</td>
                      @if (d().level === 'ENTERPRISE') { <td class="num">{{ m.cost ? m.cost.toLocaleString() : '—' }}</td> }
                      <td>@if (m.done) { <span class="pill green">完成</span> } @else if (m.dueDate && m.dueDate < today) { <span class="pill red">逾期</span> } @else { <span class="pill blue">进行中</span> }
                        @if (!m.done && !m.issue && open()) { <button mat-button type="button" (click)="measureDone(m.id)">完成</button> }</td>
                    </tr>
                  } @empty { <tr><td [attr.colspan]="d().level === 'ENTERPRISE' ? 5 : 4" class="muted">还没有措施</td></tr> }
                </tbody>
              </table></div>
              @if (risk() && open()) {
                <div class="tools">
                  <input class="sm" #mt placeholder="措施内容" aria-label="措施内容" style="flex: 1; min-width: 180px" />
                  <select class="sm" #mo aria-label="措施责任人"><option value="">责任人</option>@for (p of people(); track p.id) { <option [value]="p.id">{{ p.name }}</option> }</select>
                  <input class="sm" #md type="date" aria-label="措施期限" />
                  <input class="sm" #mc type="number" min="0" placeholder="费用" aria-label="措施费用" style="width: 90px" [hidden]="d().level !== 'ENTERPRISE'" />
                  <button mat-stroked-button type="button" (click)="addMeasure(mt.value, mo.value, md.value, d().level === 'ENTERPRISE' ? +mc.value : 0); mt.value = ''">+ 添加措施</button>
                </div>
              } @else if (!risk()) { <p class="muted">保存后可以添加措施。</p> }
            }
            @case ('warn') {
              <div class="fgrid">
                <label class="fld" style="grid-column: 1 / -1">预警条件<input [value]="d().trigger" (input)="set('trigger', $any($event.target).value)" placeholder="例如：供应商周产能低于 200 件" [disabled]="locked()" aria-label="预警条件" /></label>
                <label class="fld">复查周期（天）<input type="number" min="1" max="365" [value]="d().reviewCycleDays" (input)="set('reviewCycleDays', +$any($event.target).value)" [disabled]="locked()" aria-label="复查周期" /></label>
                <label class="fld">下次复查<input [value]="risk()?.nextReviewAt?.slice(0, 10) ?? '—'" disabled /></label>
              </div>
              @if (risk()?.triggeredAt) { <div class="banner red">预警条件已于 {{ risk()!.triggeredAt!.slice(0, 10) }} 触发；复查时可以解除。</div> }
              @else if (open() && d().trigger) { <button mat-stroked-button type="button" (click)="trigger()">预警条件已触发，通知相关人</button> }
              <h4>系统自动预警</h4>
              <ul class="auto"><li>高风险没有应对措施</li><li>措施逾期</li><li>复查到期</li><li>措施全部完成，等待复评</li><li>“接受”等待管理层确认</li></ul>
              <p class="muted" style="font-size: 13px">通知：{{ notifyText() }}（按企业设置的规则）。</p>
              @if (open()) {
                <h4>复查</h4>
                <div class="tools">
                  可能性 <select class="sm" #rp aria-label="复查可能性">@for (n of cols(); track n) { <option [value]="n" [selected]="n === risk()!.probability">{{ n }} {{ lv(n) }}</option> }</select>
                  影响 <select class="sm" #ri aria-label="复查影响">@for (n of cols(); track n) { <option [value]="n" [selected]="n === risk()!.impact">{{ n }} {{ lv(n) }}</option> }</select>
                  <input class="sm" #rn placeholder="复查意见" aria-label="复查意见" style="flex: 1; min-width: 160px" />
                  <label style="font-size: 13px" [hidden]="!risk()!.triggeredAt"><input type="checkbox" #rc /> 预警已解除</label>
                  <button mat-stroked-button type="button" (click)="review(+rp.value, +ri.value, rn.value, rc.checked)">记录复查</button>
                </div>
              }
              <h4>复查记录</h4>
              <div class="tblwrap"><table><tbody>
                @for (v of reviews(); track v.id) { <tr><td style="white-space: nowrap">{{ v.createdAt.slice(0, 10) }}</td><td>{{ name(v.reviewedById) }}</td><td>{{ v.probability }}×{{ v.impact }}</td><td>{{ v.note }}</td></tr> }
                @empty { <tr><td class="muted">还没有复查记录</td></tr> }
              </tbody></table></div>
            }
            @case ('talk') { @if (risk() && projectId()) { <app-discussion [projectId]="projectId()!" entityType="RISK" [entityId]="risk()!.id" /> } }
            @case ('close') {
              @if (risk(); as r) {
                <p class="muted" style="margin: 0 0 10px">措施完成后重新评价剩余的可能性和影响。关闭前提：措施全部完成；选“接受”且规则要求时已经管理层确认。</p>
                <dl class="kv">
                  <dt>措施</dt><dd>{{ r.closedActions }} / {{ r.measures.length }} 完成 @if (r.openActions) { <span class="pill amber">未全部完成</span> } @else { <span class="pill green">可以复评</span> }</dd>
                  <dt>当前</dt><dd><span [class]="'pill ' + impColor(r.importance)">{{ impLabel(r.importance) }}</span></dd>
                  <dt>剩余</dt><dd><span [class]="'pill ' + impColor(resImp())">{{ impLabel(resImp()) }}</span></dd>
                  <dt>关闭确认</dt><dd>{{ who(rule().close) }}</dd>
                </dl>
                <div class="mxw">
                  <div class="cap">剩余风险：纵向可能性　横向影响</div>
                  <div class="mxg" [style.grid-template-columns]="'auto repeat(' + scale() + ', 46px)'">
                    @for (p of rowsDesc(); track p) {
                      <span class="mxl">{{ lv(p) }}</span>
                      @for (i of cols(); track i) { <button type="button" class="mx" [class]="'mx m' + cell(p, i)" [class.on]="p === res()[0] && i === res()[1]" (click)="res.set([p, i])" [disabled]="!open()" [attr.aria-label]="'剩余 可能性 ' + lv(p) + ' 影响 ' + lv(i)">{{ p === res()[0] && i === res()[1] ? '●' : '' }}</button> }
                    }
                    <span></span>@for (i of cols(); track i) { <span class="mxl c">{{ lv(i) }}</span> }
                  </div>
                </div>
                @if (open()) {
                  <label class="fld" style="margin-top: 12px">关闭说明 <span class="req">*</span><textarea #cn aria-label="关闭说明"></textarea></label>
                  <div class="tools">
                    <button mat-flat-button type="button" [disabled]="r.openActions > 0" (click)="close(cn.value)">复评并关闭</button>
                    @if (r.kind === 'RISK' && r.level !== 'ENTERPRISE' && projectId()) { <button mat-stroked-button type="button" (click)="occurred()">风险已发生，转为问题</button> }
                  </div>
                }
              }
            }
          }
        </div>
        <footer>
          <span class="rule">{{ ruleText() }}</span>
          @if (!locked()) { <button mat-flat-button type="button" (click)="save()">{{ risk() ? '保存' : '登记' }}</button> }
        </footer>
      </div>
    </div>
  `,
})
export class RiskDrawer {
  private readonly api = inject(Api);
  private readonly auth = inject(AuthService);
  /** 为空表示企业风险页 */
  readonly projectId = input<string | null>(null);
  readonly risk = input<RiskRow | null>(null);
  readonly settings = input.required<RiskSettings>();
  readonly people = input<RiskPerson[]>([]);
  readonly objectives = input<Objective[]>([]);
  readonly wps = input<{ id: string; code: string; name: string }[]>([]);
  readonly projects = input<{ id: string; code: string; name: string }[]>([]);
  readonly startStep = input<RiskStep>('id');
  readonly closed = output<void>();
  /** 保存或操作后，父组件重新加载；新登记时带回 id */
  readonly changed = output<string>();

  readonly steps: [RiskStep, string][] = [['id', '1 识别'], ['ev', '2 评价'], ['plan', '3 应对'], ['warn', '4 预警'], ['close', '5 复评与关闭'], ['talk', '讨论']];
  readonly accept = ACCEPT;
  readonly today = new Date().toISOString().slice(0, 10);
  readonly step = signal<RiskStep>('id');
  readonly error = signal('');
  readonly reviews = signal<RiskReviewRow[]>([]);
  readonly d = signal<Draft>(this.blank(false));
  readonly res = signal<[number, number]>([1, 1]);
  private dirty = false;
  private lastId: string | null | undefined;

  readonly scale = computed(() => this.settings().scale);
  readonly cols = computed(() => Array.from({ length: this.scale() }, (_, i) => i + 1));
  readonly rowsDesc = computed(() => [...this.cols()].reverse());
  readonly imp = computed(() => this.impOf(this.d().probability, this.d().impact));
  readonly expected = computed(() => Math.round((this.d().exposureAmount * PROB_PCT[this.scale()][this.d().probability - 1]) / 100));
  readonly resImp = computed(() => this.impOf(this.res()[0], this.res()[1]));
  readonly rule = computed(() => this.settings().rules[`${this.d().level}:${this.imp()}`]);
  readonly strategies = computed(() => this.settings().strategies[this.d().kind]);
  readonly criteria = computed(() => Object.entries(this.settings().criteria));
  readonly open = computed(() => { const s = this.risk()?.status; return !!s && s !== 'CLOSED' && s !== 'OCCURRED'; });
  readonly locked = computed(() => !!this.risk() && !this.open());
  readonly isMgmt = computed(() => this.auth.hasRole('TOP_MANAGEMENT', 'TENANT_ADMIN'));
  readonly acceptNeed = computed(() => ACCEPT_NEED_LABELS[this.rule().accept]);
  readonly notifyText = computed(() => this.rule().notify.map((w) => RISK_WHO_LABELS[w]).join('、'));
  readonly ruleText = computed(() => {
    const r = this.rule();
    return `${RISK_LEVEL_LABELS[this.d().level]} · ${IMPORTANCE_LABELS[this.imp()]}：应对由${this.who(r.approve)}审批，关闭由${this.who(r.close)}确认；复查周期 ${r.reviewDays} 天`;
  });

  constructor() {
    portalToBody();
    void inject(Ai).load(); // 企业风险页也会打开本抽屉
    effect(() => {
      const r = this.risk();
      const id = r?.id ?? null;
      if (id !== this.lastId) { this.step.set(this.startStep()); this.error.set(''); }
      this.lastId = id;
      this.d.set(r ? this.fromRow(r) : this.blank());
      this.res.set([r?.residualProbability ?? 1, r?.residualImpact ?? 1]);
      this.dirty = false;
      if (r) void this.loadReviews(r);
    });
  }

  /** 字段初始化时输入还没绑定，不能读输入 */
  private blank(fromInputs = true): Draft {
    const level: RiskLevelKey = fromInputs && !this.projectId() ? 'ENTERPRISE' : 'PROJECT';
    const mid = fromInputs ? Math.ceil(this.settings().scale / 2) : 2;
    return {
      kind: 'RISK', level, title: '', cause: '', effect: '', objectiveId: '', workPackageId: '', ownerId: '', projectIds: [],
      probability: mid, impact: mid, exposureAmount: 0, responseCost: 0, costBenefitAnalysis: '', strategy: '', acceptReason: '', contingencyPlan: '', trigger: '', reviewCycleDays: 30,
      maturityLevel: '', functionalReviewers: '', budgetRecovery: 0,
    };
  }
  private fromRow(r: RiskRow): Draft {
    return {
      kind: r.kind, level: r.level, title: r.title, cause: r.cause, effect: r.effect, objectiveId: r.objectiveId ?? '', workPackageId: r.workPackageId ?? '',
      ownerId: r.ownerId ?? '', projectIds: r.projects.map((p) => p.id), probability: r.probability, impact: r.impact,
      exposureAmount: Number(r.exposureAmount), responseCost: Number(r.responseCost), costBenefitAnalysis: r.costBenefitAnalysis, strategy: r.strategy ?? '',
      acceptReason: r.acceptReason ?? '', contingencyPlan: r.contingencyPlan ?? '', trigger: r.trigger, reviewCycleDays: r.reviewCycleDays ?? r.rule.reviewDays,
      maturityLevel: r.maturityLevel ?? '', functionalReviewers: r.functionalReviewers ?? '', budgetRecovery: Number(r.budgetRecovery ?? 0),
    };
  }

  set<K extends keyof Draft>(k: K, v: Draft[K]) {
    this.dirty = true;
    this.d.update((x) => {
      const n = { ...x, [k]: v };
      if (k === 'workPackageId' && !this.risk()) n.level = v ? 'WORK_PACKAGE' : 'PROJECT';
      if (k === 'level' && v === 'PROJECT') n.workPackageId = '';
      if (k === 'kind') n.strategy = '';
      return n;
    });
  }
  pick(p: number, i: number) { this.set('probability', p); this.set('impact', i); }
  toggleProject(id: string) { const ids = this.d().projectIds; this.set('projectIds', ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]); }

  lv(n: number) { return LEVEL_NAMES[this.scale()][n - 1]; }
  cell(p: number, i: number) { return this.settings().matrix[p - 1]?.[i - 1] ?? 0; }
  impOf(p: number, i: number): Importance { return IMP[this.cell(p, i)]; }
  impAt(i: number): Importance { return IMP[Math.min(i, 2)]; }
  impLabel(i: Importance) { return IMPORTANCE_LABELS[i]; }
  impColor(i: Importance) { return i === 'HIGH' ? 'red' : i === 'MEDIUM' ? 'amber' : 'green'; }
  levelLabel(l: RiskLevelKey) { return RISK_LEVEL_LABELS[l]; }
  statusLabel(r: RiskRow) { return RISK_STATUS_LABELS[r.status]; }
  who(w: 'OWNER' | 'PM' | 'MANAGEMENT') { return w === 'OWNER' && this.d().level === 'WORK_PACKAGE' ? '工作包负责人' : RISK_WHO_LABELS[w]; }
  name(id: string | null) { return id ? this.people().find((p) => p.id === id)?.name ?? '—' : '—'; }

  readonly ai = inject(Ai);
  readonly aiBusy = signal(false);
  readonly aiMeasures = signal<string[]>([]);
  private pendingAi: string | null = null;
  /** AI 根据描述起草原因、后果、成本收益分析，并建议措施（措施逐条确认后添加） */
  async aiRisk() {
    const x = this.d();
    this.aiBusy.set(true); this.error.set('');
    try {
      const r = await this.ai.draft<{ cause: string; effect: string; measures: string[]; costBenefitAnalysis: string }>('ANALYSIS', {
        kind: 'RISK', record: { 类型: x.kind === 'RISK' ? '风险' : '机会', 描述: x.title, 原因: x.cause, 后果: x.effect, 可能性: x.probability, 影响: x.impact, 策略: x.strategy, 潜在金额: x.exposureAmount },
      }, this.projectId() ?? undefined);
      if (r.draft.cause && !x.cause) this.set('cause', r.draft.cause);
      if (r.draft.effect && !x.effect) this.set('effect', r.draft.effect);
      if (r.draft.costBenefitAnalysis) this.set('costBenefitAnalysis', r.draft.costBenefitAnalysis);
      this.aiMeasures.set(r.draft.measures);
      this.pendingAi = r.usageId;
    } catch (e) { this.error.set(errorMessage(e, 'AI 起草失败')); } finally { this.aiBusy.set(false); }
  }
  dropMeasure(i: number) { this.aiMeasures.update((m) => m.filter((_, j) => j !== i)); }
  private async adoptAi(id: string) {
    if (!this.pendingAi) return;
    await this.ai.adopt(this.pendingAi, true, 'RISK', id);
    this.pendingAi = null;
  }

  private base(r: RiskRow) { return r.level === 'ENTERPRISE' ? `/enterprise-risks/${r.id}` : `/projects/${this.projectId()}/risks/${r.id}`; }
  private async loadReviews(r: RiskRow) {
    try { this.reviews.set(await this.api.get<RiskReviewRow[]>(`${this.base(r)}/reviews`)); } catch { this.reviews.set([]); }
  }

  private body(): Record<string, unknown> {
    const x = this.d();
    const out: Record<string, unknown> = {
      title: x.title.trim(), cause: x.cause, effect: x.effect, probability: x.probability, impact: x.impact,
      exposureAmount: x.exposureAmount || 0, responseCost: x.responseCost || 0, costBenefitAnalysis: x.costBenefitAnalysis,
      strategy: x.strategy || (this.risk() ? null : undefined), trigger: x.trigger, reviewCycleDays: x.reviewCycleDays || undefined,
      ownerId: x.ownerId || undefined, maturityLevel: x.maturityLevel || undefined, functionalReviewers: x.functionalReviewers || undefined,
      budgetRecovery: x.kind === 'OPPORTUNITY' && x.budgetRecovery ? x.budgetRecovery : undefined,
    };
    if (x.strategy === ACCEPT) { out['acceptReason'] = x.acceptReason; out['contingencyPlan'] = x.contingencyPlan; }
    if (x.level === 'ENTERPRISE') out['projectIds'] = x.projectIds;
    else { out['objectiveId'] = x.objectiveId || (this.risk() ? null : undefined); out['workPackageId'] = x.workPackageId || (this.risk() ? null : undefined); }
    return out;
  }

  /** 保存；返回是否成功 */
  async save(close = true): Promise<boolean> {
    const x = this.d();
    if (x.title.trim().length < 2) { this.error.set('请填写描述（至少 2 个字）'); this.step.set('id'); return false; }
    if (x.level === 'WORK_PACKAGE' && !x.workPackageId) { this.error.set('工作包级风险请选择关联工作包'); this.step.set('id'); return false; }
    this.error.set('');
    try {
      const r = this.risk();
      if (r) { await this.api.patch(this.base(r), this.body()); await this.adoptAi(r.id); }
      else {
        const created = this.projectId()
          ? await this.api.post<{ id: string }>(`/projects/${this.projectId()}/risks`, { ...this.body(), kind: x.kind, level: x.level })
          : await this.api.post<{ id: string }>('/enterprise-risks', { ...this.body(), kind: x.kind });
        await this.adoptAi(created.id);
        this.dirty = false;
        this.changed.emit(created.id);
        if (close) this.closed.emit();
        return true;
      }
      this.dirty = false;
      this.changed.emit(r.id);
      if (close) this.closed.emit();
      return true;
    } catch (e) { this.error.set(errorMessage(e, '保存失败')); return false; }
  }

  private async act(fn: (r: RiskRow) => Promise<unknown>, fallback: string) {
    const r = this.risk();
    if (!r) return;
    if (this.dirty && !(await this.save(false))) return;
    this.error.set('');
    try { await fn(r); this.changed.emit(r.id); } catch (e) { this.error.set(errorMessage(e, fallback)); }
  }

  addMeasure(title: string, ownerId: string, dueDate: string, cost: number) {
    if (!title.trim()) { this.error.set('请填写措施内容'); return; }
    return this.act((r) => this.api.post(r.level === 'ENTERPRISE' ? `${this.base(r)}/measures` : `${this.base(r)}/actions`, {
      title: title.trim(), ownerId: ownerId || undefined, dueDate: dueDate || undefined, ...(r.level === 'ENTERPRISE' && cost ? { cost } : {}),
    }), '添加失败');
  }
  measureDone(mid: string) { return this.act((r) => this.api.post(`${this.base(r)}/measures/${mid}/done`, {}), '更新失败'); }
  approveAccept() { return this.act((r) => this.api.post(`${this.base(r)}/accept-approve`, {}), '确认失败'); }
  trigger() { return this.act((r) => this.api.post(`${this.base(r)}/trigger`, {}), '操作失败'); }
  review(probability: number, impact: number, note: string, clearTrigger: boolean) {
    if (!note.trim()) { this.error.set('请填写复查意见'); return; }
    return this.act((r) => this.api.post(`${this.base(r)}/review`, { probability, impact, note: note.trim(), clearTrigger: clearTrigger || undefined }), '复查失败');
  }
  close(note: string) {
    if (!note.trim()) { this.error.set('请填写关闭说明'); return; }
    const [residualProbability, residualImpact] = this.res();
    return this.act((r) => this.api.post(`${this.base(r)}/close`, { residualProbability, residualImpact, note: note.trim() }), '关闭失败');
  }
  occurred() {
    const note = askText('发生情况说明（可不填）');
    if (note === null) return;
    return this.act((r) => this.api.post(`${this.base(r)}/occurred`, { note: note || undefined }), '操作失败');
  }
  escalate() {
    const r = this.risk();
    if (!r) return;
    const to = r.level === 'WORK_PACKAGE' ? '项目级（项目经理接手）' : '企业级（管理层接手，所有人可见）';
    const note = askText(`升级为${to}。说明原因：`);
    if (note === null) return;
    return this.act((x) => this.api.post(`${this.base(x)}/escalate`, { note: note || undefined }), '升级失败');
  }
}
