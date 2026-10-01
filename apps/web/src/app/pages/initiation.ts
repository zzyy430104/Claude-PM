import { Component, computed, inject, input, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { Api, errorMessage } from '../core/api';
import { askText } from '../core/i18n';
import { AuthService } from '../core/auth.service';
import {
  INITIATION_STATUS_LABELS, Initiation, PROJECT_TYPE_HINTS, PROJECT_TYPE_LABELS, ProjectType, RISK_LABELS, Requirements, RiskLevel, emptyRequirements,
} from '../core/models';
import { requirementProblems } from '../core/requirements';
import { RequirementsEditor, cleanRequirements } from '../components/requirements-editor';
import { RequirementsView } from '../components/requirements-view';
import { AiContract, ContractFields } from '../components/ai-contract';
import { AiMark } from '../components/ai-mark';
import { Ai } from '../core/ai';

interface Person { id: string; name: string; role: string }
interface Form {
  name: string; projectCode: string; type: ProjectType; riskLevel: RiskLevel; productFamily: string; proposedPmId: string;
  customer: string; contractNo: string; contractAmount: string; startDate: string;
}
const blank = (): Form => ({ name: '', projectCode: '', type: 'B', riskLevel: 'MEDIUM', productFamily: '', proposedPmId: '', customer: '', contractNo: '', contractAmount: '', startDate: '' });

/** 立项申请：新建、修改草稿、提交；会签人给意见，批准人批准或驳回。批准后按类型模板生成项目和计划草稿。 */
@Component({
  selector: 'app-initiation',
  imports: [AiContract, AiMark, RouterLink, MatButtonModule, RequirementsEditor, RequirementsView],
  styles: `
    .meta { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; color: var(--pm-muted); font-size: 14px; margin: 0 0 18px; }
    .opinion { border-top: 1px solid var(--pm-line); padding: 8px 0; font-size: 14px; }
    .opinion:first-child { border-top: 0; }
    .opinion .who { font-weight: 600; margin-right: 6px; }
    textarea.op { width: 100%; box-sizing: border-box; font: inherit; border: 1px solid var(--pm-line); border-radius: 9px; padding: 8px; margin: 6px 0; }
    .side .mdc-button { width: 100%; margin: 6px 0 0 !important; }
    .kv { display: grid; grid-template-columns: 110px 1fr; gap: 6px 12px; font-size: 14px; }
    .kv dt { color: var(--pm-muted); }
    .kv dd { margin: 0; }
  `,
  template: `
    <div class="page">
      <div class="crumb"><a routerLink="/initiations">立项管理</a> / {{ isNew() ? '新建立项申请' : (item()?.code ?? '') }}</div>
      <div class="head">
        <div>
          <h1>立项申请{{ f().name ? '：' + f().name : '' }}</h1>
          @if (item(); as i) {
            <div class="meta">
              <span class="pill" [class.green]="i.status === 'APPROVED'" [class.amber]="i.status === 'PENDING' || i.status === 'COSIGN'" [class.red]="i.status === 'REJECTED'">{{ statusLabel() }}</span>
              <span>申请人：{{ person(i.applicantId) }}</span><span>编号 {{ i.code }}</span>
              @if (i.projectId) { <a [routerLink]="['/projects', i.projectId]">打开生成的项目 →</a> }
            </div>
          }
        </div>
        @if (editable()) {
          <div class="actions">
            <button mat-stroked-button type="button" (click)="save()" [disabled]="busy()">保存草稿</button>
            <button mat-flat-button type="button" (click)="submit()" [disabled]="busy()">提交审批</button>
          </div>
        }
      </div>
      @if (error()) { <div class="error" role="alert">{{ error() }}</div> }
      @if (saved()) { <div class="banner green" role="status">{{ saved() }}</div> }

      <div class="split">
        <div>
          @if (editable() && ai.on('CONTRACT')) { <app-ai-contract [type]="f().type" (applied)="applyAi($event)" /> }
          @if (id()) { <app-ai-mark entity="INITIATION" [id]="id()!" /> }
          <section class="pcard">
            <header><h2>基本信息</h2></header>
            <div class="body">
              @if (editable()) {
                <div class="fgrid"><label class="fld">项目名称 <span class="req">*</span><input [value]="f().name" (change)="patch('name', $event)" aria-label="项目名称" /></label></div>
                <div class="fld" style="margin-bottom: 6px">项目类型 <span class="req">*</span>（决定必填项和默认阶段）</div>
                <div class="typecards" role="group" aria-label="项目类型">
                  @for (t of types; track t) {
                    <button type="button" [attr.aria-pressed]="f().type === t" (click)="setType(t)"><b>{{ typeLabel(t) }}</b><span>{{ typeHint(t) }}</span></button>
                  }
                </div>
                <div class="fgrid">
                  <label class="fld">项目编号 <span class="req">*</span><input [value]="f().projectCode" (change)="patch('projectCode', $event)" placeholder="ZY-03" aria-label="项目编号" /></label>
                  <label class="fld">产品族<input [value]="f().productFamily" (change)="patch('productFamily', $event)" /></label>
                  <label class="fld">风险等级
                    <select [value]="f().riskLevel" (change)="patch('riskLevel', $event)">@for (r of risks; track r) { <option [value]="r" [selected]="r === f().riskLevel">{{ riskLabel(r) }}</option> }</select></label>
                </div>
                <div class="fgrid">
                  <label class="fld">建议的项目经理 <span class="req">*</span>
                    <select [value]="f().proposedPmId" (change)="patch('proposedPmId', $event)" aria-label="建议的项目经理">
                      <option value="">请选择</option>
                      @for (u of managers(); track u.id) { <option [value]="u.id" [selected]="u.id === f().proposedPmId">{{ u.name }}</option> }
                    </select></label>
                  <label class="fld">计划开始日期 <span class="req">*</span><input type="date" [value]="f().startDate" (change)="patch('startDate', $event)" aria-label="计划开始日期" /></label>
                </div>
                @if (f().type !== 'C') {
                  <div class="fgrid">
                    <label class="fld">客户 <span class="req">*</span><input [value]="f().customer" (change)="patch('customer', $event)" aria-label="客户" /></label>
                    <label class="fld">合同号<input [value]="f().contractNo" (change)="patch('contractNo', $event)" /></label>
                    <label class="fld">合同金额（元）<input type="number" min="0" [value]="f().contractAmount" (change)="patch('contractAmount', $event)" /></label>
                  </div>
                }
              } @else {
                <dl class="kv">
                  <dt>项目类型</dt><dd>{{ typeLabel(f().type) }}</dd>
                  <dt>项目编号</dt><dd>{{ f().projectCode || '—' }}</dd>
                  <dt>项目经理</dt><dd>{{ person(f().proposedPmId) }}</dd>
                  <dt>计划开始</dt><dd>{{ f().startDate || '—' }}</dd>
                  <dt>风险等级</dt><dd>{{ riskLabel(f().riskLevel) }}</dd>
                  @if (f().productFamily) { <dt>产品族</dt><dd>{{ f().productFamily }}</dd> }
                  @if (f().type !== 'C') {
                    <dt>客户</dt><dd>{{ f().customer || '—' }}</dd>
                    <dt>合同号</dt><dd>{{ f().contractNo || '—' }}</dd>
                    <dt>合同金额</dt><dd>{{ f().contractAmount ? (+f().contractAmount).toLocaleString() + ' 元' : '—' }}</dd>
                  }
                </dl>
              }
            </div>
          </section>
          <section class="pcard">
            <header><h2>项目要求</h2><span class="sub">批准后项目内不能突破，只能通过“项目要求变更”修改</span></header>
            @if (editable()) {
              <div class="body"><app-requirements-editor [(value)]="req" [type]="f().type" /></div>
            } @else {
              <app-requirements-view [value]="req()" [type]="f().type" />
            }
          </section>
        </div>

        <aside class="side">
          @if (editable()) {
            <section class="pcard">
              <header><h3>提交前检查</h3></header>
              <div class="body">
                <ul class="checks">
                  @for (c of checklist(); track c.label) { <li [class.no]="!c.ok">{{ c.label }}</li> }
                </ul>
              </div>
            </section>
          }
          @if (item(); as i) {
            <section class="pcard">
              <header><h3>审批路线</h3></header>
              <div class="body">
                <ol class="steps">
                  @if (i.cosigners?.length) {
                    <li [class.done]="cosignDone()" [class.now]="i.status === 'COSIGN'"><b>1</b>会签<small>{{ cosignText() }}</small></li>
                  }
                  <li [class.done]="i.status === 'APPROVED'" [class.now]="i.status === 'PENDING'"><b>{{ i.cosigners?.length ? 2 : 1 }}</b>批准<small>立项批准人；申请人不能批准自己的申请</small></li>
                  <li [class.done]="i.status === 'APPROVED'"><b>{{ i.cosigners?.length ? 3 : 2 }}</b>生成项目<small>按 {{ f().type }} 类模板生成阶段和计划草稿，通知项目经理</small></li>
                </ol>
                @if (i.decisionNote) { <p class="muted">审批意见：{{ i.decisionNote }}</p> }
                @if (i.can?.cosign) {
                  <textarea class="op" rows="3" #op placeholder="会签意见" aria-label="会签意见"></textarea>
                  <button mat-flat-button type="button" (click)="cosign(true, op.value)">同意</button>
                  <button mat-stroked-button type="button" (click)="cosign(false, op.value)">不同意</button>
                }
                @if (i.can?.decide) {
                  <button mat-flat-button type="button" (click)="decide(true)" [disabled]="busy()">批准立项</button>
                  <button mat-stroked-button type="button" (click)="decide(false)" [disabled]="busy()">驳回</button>
                }
                @if (i.can?.withdraw && !editable()) {
                  <button mat-stroked-button type="button" (click)="withdraw()">撤回申请</button>
                }
              </div>
            </section>
            @if (i.opinions.length) {
              <section class="pcard">
                <header><h3>会签意见</h3></header>
                <div class="body">
                  @for (o of i.opinions; track o.id) {
                    <div class="opinion"><span class="who">{{ person(o.userId) }}</span><span class="pill" [class.green]="o.agree" [class.red]="!o.agree">{{ o.agree ? '同意' : '不同意' }}</span><div>{{ o.opinion }}</div></div>
                  }
                </div>
              </section>
            }
          }
        </aside>
      </div>
    </div>
  `,
})
export class InitiationPage {
  private readonly api = inject(Api);
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);
  /** 路由参数 :id；新建时没有 */
  readonly id = input<string>();
  readonly types: ProjectType[] = ['A', 'B', 'C'];
  readonly risks: RiskLevel[] = ['LOW', 'MEDIUM', 'HIGH'];
  readonly item = signal<Initiation | null>(null);
  readonly f = signal<Form>(blank());
  readonly req = signal<Requirements>(emptyRequirements());
  readonly people = signal<Person[]>([]);
  readonly error = signal('');
  readonly saved = signal('');
  readonly busy = signal(false);

  readonly isNew = computed(() => !this.id());
  readonly editable = computed(() => this.isNew() || !!this.item()?.can?.edit);
  readonly managers = computed(() => this.people().filter((u) => u.role === 'PROJECT_MANAGER' || u.id === this.f().proposedPmId));
  readonly statusLabel = computed(() => { const i = this.item(); return i ? INITIATION_STATUS_LABELS[i.status] : ''; });
  readonly checklist = computed(() => {
    const f = this.f();
    const missing = requirementProblems({ ...f, proposedPmId: f.proposedPmId || null, startDate: f.startDate || null }, cleanRequirements(this.req(), f.type));
    const all = ['项目名称', '项目编号', '项目经理', '计划开始日期', ...(f.type === 'C' ? ['库存计划行（产品、数量、要求日期）'] : ['客户', '全部交付日期', '产品交付物']), '成本上限', ...(f.type !== 'A' && !this.req().quality.fai ? ['不做 FAI 的理由'] : [])];
    return all.map((label) => ({ label, ok: !missing.includes(label) }));
  });
  readonly cosignDone = computed(() => { const i = this.item(); return !!i && i.status !== 'COSIGN' && i.status !== 'DRAFT' && !!i.submittedAt; });
  readonly cosignText = computed(() => {
    const i = this.item();
    if (!i?.cosigners) return '';
    return i.cosigners.map((u) => `${this.person(u)} ${i.opinions.some((o) => o.userId === u) ? '已签' : '待签'}`).join('，');
  });

  readonly ai = inject(Ai);
  /** AI 起草后待保存的使用记录：保存成功时记下“AI 起草，某某确认” */
  private pendingAi: string | null = null;

  ngOnInit() { void this.load(); void this.ai.load(); }

  applyAi(e: { fields: ContractFields; apply: (r: Requirements) => Requirements; usageId: string }) {
    this.f.update((f) => ({ ...f, ...Object.fromEntries(Object.entries(e.fields).filter(([, v]) => v !== undefined && v !== '')) }));
    this.req.update((r) => e.apply(r));
    this.pendingAi = e.usageId;
    this.saved.set('已写入 AI 起草的条目，请核对后保存');
  }

  async load() {
    try {
      this.people.set(await this.api.get<Person[]>('/users/directory'));
      const id = this.id();
      if (!id) {
        if (this.auth.hasRole('PROJECT_MANAGER')) this.f.update((f) => ({ ...f, proposedPmId: this.auth.user()?.id ?? '' }));
        return;
      }
      const i = await this.api.get<Initiation>(`/initiations/${id}`);
      this.item.set(i);
      this.f.set({
        name: i.name, projectCode: i.projectCode, type: i.type, riskLevel: i.riskLevel, productFamily: i.productFamily, proposedPmId: i.proposedPmId ?? '',
        customer: i.customer, contractNo: i.contractNo, contractAmount: i.contractAmount ?? '', startDate: i.startDate?.slice(0, 10) ?? '',
      });
      this.req.set({ ...emptyRequirements(), ...i.requirements, quality: { ...emptyRequirements().quality, ...i.requirements.quality }, cost: { ...emptyRequirements().cost, ...i.requirements.cost } });
    } catch (e) { this.error.set(errorMessage(e, '加载失败')); }
  }

  person(id: string | null | undefined) { return this.people().find((p) => p.id === id)?.name ?? '—'; }
  typeLabel(t: ProjectType) { return PROJECT_TYPE_LABELS[t]; }
  typeHint(t: ProjectType) { return PROJECT_TYPE_HINTS[t]; }
  riskLabel(r: RiskLevel) { return RISK_LABELS[r]; }
  patch(key: keyof Form, e: Event) {
    const v = (e.target as HTMLInputElement).value;
    this.f.update((f) => ({ ...f, [key]: key === 'name' || key === 'projectCode' ? v.trim() : v }));
  }
  setType(t: ProjectType) {
    this.f.update((f) => ({ ...f, type: t }));
    if (t === 'A') this.req.update((r) => ({ ...r, quality: { ...r.quality, fai: true } }));
  }

  private body() {
    const f = this.f();
    return {
      name: f.name || undefined, projectCode: f.projectCode, type: f.type, riskLevel: f.riskLevel, productFamily: f.productFamily,
      proposedPmId: f.proposedPmId || null, customer: f.type === 'C' ? '' : f.customer, contractNo: f.type === 'C' ? '' : f.contractNo,
      contractAmount: f.type === 'C' || f.contractAmount === '' ? null : Number(f.contractAmount), startDate: f.startDate || null,
      requirements: cleanRequirements(this.req(), f.type),
    };
  }

  /** 保存；新建时创建后转到该申请的网址。返回申请 id */
  private async persist(): Promise<string | null> {
    if (!this.f().name || this.f().name.length < 2) { this.error.set('请先填写项目名称（至少 2 个字）'); return null; }
    if (this.isNew()) {
      const i = await this.api.post<Initiation>('/initiations', this.body());
      await this.adoptAi(i.id);
      await this.router.navigate(['/initiations', i.id], { replaceUrl: true });
      return i.id;
    }
    await this.api.patch(`/initiations/${this.id()}`, this.body());
    await this.adoptAi(this.id()!);
    return this.id()!;
  }

  private async adoptAi(id: string) {
    if (!this.pendingAi) return;
    await this.ai.adopt(this.pendingAi, true, 'INITIATION', id);
    this.pendingAi = null;
  }

  async save() {
    this.error.set(''); this.saved.set(''); this.busy.set(true);
    try {
      const id = await this.persist();
      if (id && !this.isNew()) { await this.load(); this.saved.set('草稿已保存'); }
    } catch (e) { this.error.set(errorMessage(e, '保存失败')); } finally { this.busy.set(false); }
  }

  async submit() {
    this.error.set(''); this.saved.set('');
    const missing = this.checklist().filter((c) => !c.ok).map((c) => c.label);
    if (missing.length) { this.error.set(`还缺少：${missing.join('、')}`); return; }
    this.busy.set(true);
    try {
      const id = await this.persist();
      if (!id) return;
      await this.api.post(`/initiations/${id}/submit`);
      await this.router.navigate(['/initiations']);
    } catch (e) { this.error.set(errorMessage(e, '提交失败')); } finally { this.busy.set(false); }
  }

  async cosign(agree: boolean, opinion: string) {
    if (!opinion.trim()) { this.error.set('请填写会签意见'); return; }
    this.error.set('');
    try {
      await this.api.post(`/initiations/${this.id()}/opinions`, { agree, opinion: opinion.trim() });
      await this.load();
    } catch (e) { this.error.set(errorMessage(e, '会签失败')); }
  }

  async decide(approve: boolean) {
    const note = askText(approve ? '审批意见（可不填）' : '驳回理由');
    if (note === null || (!approve && !note.trim())) return;
    this.error.set(''); this.busy.set(true);
    try {
      const r = await this.api.post<{ projectId?: string }>(`/initiations/${this.id()}/${approve ? 'approve' : 'reject'}`, note.trim() ? { note: note.trim() } : {});
      if (approve && r.projectId) await this.router.navigate(['/projects', r.projectId]);
      else await this.load();
    } catch (e) { this.error.set(errorMessage(e, '操作失败')); } finally { this.busy.set(false); }
  }

  async withdraw() {
    if (!confirm('撤回后可以修改再提交。确定撤回？')) return;
    try {
      await this.api.post(`/initiations/${this.id()}/withdraw`);
      await this.load();
    } catch (e) { this.error.set(errorMessage(e, '撤回失败')); }
  }
}
