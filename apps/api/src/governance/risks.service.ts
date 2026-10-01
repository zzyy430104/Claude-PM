import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { Risk } from '../generated/prisma/client.js';
import { IssueKind, IssueStatus, ProjectRole, RiskKind, RiskLevel3, RiskStatus, Role } from '../generated/prisma/enums.js';
import { AuditService } from '../audit/audit.service.js';
import { requireTenantId } from '../common/auth.types.js';
import type { AuthUser } from '../common/auth.types.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ProjectAccess, type ProjectCtx } from '../projects/access.service.js';
import {
  ActionInputDto, CloseRiskDto, CreateRiskDto, EnterpriseRiskDto, EscalateRiskDto, MeasureDto, OccurredDto, ReviewRiskDto, UpdateRiskDto,
} from './dto.js';
import { IssuesService } from './issues.service.js';
import { ACCEPT, type Importance, importanceOf, loadRiskSettings, type RiskSettings, type Rule, ruleOf, type Who } from './risk-settings.js';

const PROBABILITY_PERCENT = [0, 10, 30, 50, 70, 90];
const OPEN_STATUSES: RiskStatus[] = [RiskStatus.OPEN, RiskStatus.MITIGATING, RiskStatus.REVIEW];
const day = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (n: number) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + n); return new Date(day(d)); };
const isMgmt = (u: AuthUser) => u.role === Role.TOP_MANAGEMENT || u.role === Role.TENANT_ADMIN;

type WarningKind = 'NO_MEASURE' | 'MEASURE_OVERDUE' | 'REVIEW_DUE' | 'AWAITING_REVIEW' | 'TRIGGERED' | 'ACCEPT_APPROVAL';
export interface Warning { riskId: string; title: string; importance: Importance; kind: WarningKind; message: string; severity: 'red' | 'amber'; ownerId: string | null }
type MeasureRow = { id: string; title: string; ownerId: string | null; dueDate: Date | null; doneAt: Date | null; cost: unknown };
type RiskRow = Risk & { measures: MeasureRow[]; links: { projectId: string }[] };

/**
 * 风险与机会（第 5B 章）：企业级 / 项目级 / 工作包级三层；评价矩阵得出重要度；
 * 应对策略与措施（项目内措施即行动项，企业级措施单独记录）；预警、复查、复评与关闭、升级、转为问题。
 * 审批、关闭、通知、复查周期按企业设置的“层级 × 重要度”规则。
 */
@Injectable()
export class RisksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: ProjectAccess,
    private readonly issues: IssuesService,
    private readonly notifications: NotificationsService,
  ) {}

  settings(tenantId: string) {
    return loadRiskSettings(this.prisma, tenantId);
  }

  // ───── 读取 ─────

  /** 项目的风险与机会：本项目的，加上挂到本项目的企业级风险 */
  async list(actor: AuthUser, projectId: string) {
    const ctx = await this.access.load(actor, projectId);
    const links = await this.prisma.riskProjectLink.findMany({ where: { projectId, tenantId: ctx.tenantId }, select: { riskId: true } });
    const risks = await this.prisma.risk.findMany({
      where: { tenantId: ctx.tenantId, OR: [{ projectId }, { id: { in: links.map((l) => l.riskId) } }] },
      include: { measures: true, links: true },
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    });
    return this.decorate(ctx.tenantId, risks);
  }

  private async decorate(tenantId: string, risks: RiskRow[]) {
    const s = await this.settings(tenantId);
    const actions = await this.prisma.issue.findMany({ where: { tenantId, riskId: { in: risks.map((r) => r.id) } }, select: { id: true, riskId: true, kind: true, title: true, ownerId: true, dueDate: true, status: true } });
    const projects = await this.prisma.project.findMany({ where: { tenantId, id: { in: [...new Set(risks.flatMap((r) => r.links.map((l) => l.projectId)))] } }, select: { id: true, code: true, name: true } });
    const today = day(new Date());
    return risks.map((r) => {
      const exposure = Number(r.exposureAmount);
      const expected = (exposure * (PROBABILITY_PERCENT[r.probability] ?? 0)) / 100;
      const imp = importanceOf(s, r.probability, r.impact);
      const measures = r.level === RiskLevel3.ENTERPRISE
        ? r.measures.map((m) => ({ id: m.id, title: m.title, ownerId: m.ownerId, dueDate: m.dueDate ? day(m.dueDate) : null, done: !!m.doneAt, cost: Number(m.cost), issue: false }))
        : actions.filter((a) => a.riskId === r.id && a.kind === IssueKind.ACTION).map((a) => ({ id: a.id, title: a.title, ownerId: a.ownerId, dueDate: a.dueDate ? day(a.dueDate) : null, done: a.status === IssueStatus.CLOSED, cost: 0, issue: true }));
      return {
        ...r,
        measures,
        projects: r.links.map((l) => projects.find((p) => p.id === l.projectId)).filter(Boolean),
        score: r.probability * r.impact,
        importance: imp,
        residualImportance: r.residualProbability && r.residualImpact ? importanceOf(s, r.residualProbability, r.residualImpact) : null,
        rule: ruleOf(s, r.level, imp),
        expectedValue: expected,
        netBenefitOfResponse: expected - Number(r.responseCost),
        openActions: measures.filter((m) => !m.done).length,
        closedActions: measures.filter((m) => m.done).length,
        overdueMeasures: measures.filter((m) => !m.done && m.dueDate && m.dueDate < today).length,
        reviewDue: !!r.nextReviewAt && day(r.nextReviewAt) <= today && OPEN_STATUSES.includes(r.status),
        issues: actions.filter((a) => a.riskId === r.id && a.kind === IssueKind.ISSUE).map((a) => ({ id: a.id, title: a.title, status: a.status })),
      };
    });
  }

  /** 预警：高风险没有措施、措施逾期、复查到期、待复评、预警条件已触发、“接受”待批准 */
  async warnings(actor: AuthUser, projectId: string): Promise<Warning[]> {
    return this.collectWarnings(await this.list(actor, projectId));
  }
  collectWarnings(rows: Awaited<ReturnType<RisksService['decorate']>>): Warning[] {
    const out: Warning[] = [];
    for (const r of rows) {
      if (!OPEN_STATUSES.includes(r.status)) continue;
      const base = { riskId: r.id, title: r.title, importance: r.importance, ownerId: r.ownerId };
      if (r.kind === RiskKind.RISK && r.importance === 'HIGH' && !r.measures.length && r.strategy !== ACCEPT) out.push({ ...base, kind: 'NO_MEASURE', message: '高风险还没有应对措施', severity: 'red' });
      if (r.overdueMeasures) out.push({ ...base, kind: 'MEASURE_OVERDUE', message: `${r.overdueMeasures} 条措施逾期`, severity: 'red' });
      if (r.triggeredAt) out.push({ ...base, kind: 'TRIGGERED', message: `预警条件已触发：${r.trigger}`, severity: 'red' });
      if (r.reviewDue) out.push({ ...base, kind: 'REVIEW_DUE', message: `复查到期（${day(r.nextReviewAt!)}）`, severity: 'amber' });
      if (r.status === RiskStatus.REVIEW) out.push({ ...base, kind: 'AWAITING_REVIEW', message: '措施已全部完成，等待复评后关闭', severity: 'amber' });
      if (r.strategy === ACCEPT && r.rule.accept === 'REASON_PLAN_APPROVAL' && !r.acceptApprovedAt) out.push({ ...base, kind: 'ACCEPT_APPROVAL', message: '选择“接受”，等待管理层确认', severity: 'amber' });
    }
    return out;
  }

  // ───── 权限与通知 ─────

  private async pms(projectId: string | null) {
    if (!projectId) return [];
    return (await this.prisma.projectMember.findMany({ where: { projectId, projectRole: ProjectRole.PROJECT_MANAGER, active: true }, select: { userId: true } })).map((m) => m.userId);
  }
  private async mgmt(tenantId: string) {
    return (await this.prisma.user.findMany({ where: { tenantId, active: true, role: Role.TOP_MANAGEMENT }, select: { id: true } })).map((u) => u.id);
  }
  private async recipients(r: Risk, who: Who[]) {
    const ids: (string | null)[] = [];
    if (who.includes('OWNER')) ids.push(r.ownerId);
    if (who.includes('PM')) ids.push(...(await this.pms(r.projectId)));
    if (who.includes('MANAGEMENT')) ids.push(...(await this.mgmt(r.tenantId)));
    return ids;
  }
  /** 能否按规则做某事：OWNER 责任人或以上；PM 项目经理或管理层；MANAGEMENT 管理层 */
  private allowed(who: Who, actor: AuthUser, r: Risk, ctx: ProjectCtx | null) {
    if (isMgmt(actor)) return true;
    if (who === 'MANAGEMENT') return false;
    if (who === 'PM') return !!ctx?.isManager;
    return !!ctx?.isManager || !!ctx?.isQuality || r.ownerId === actor.id;
  }
  /** 重要度变成“高”时，按规则通知 */
  private async notifyIfHigher(r: Risk, s: RiskSettings, actorId: string) {
    const imp = importanceOf(s, r.probability, r.impact);
    if (imp === r.notifiedLevel) return;
    await this.prisma.risk.update({ where: { id: r.id }, data: { notifiedLevel: imp } });
    if (imp !== 'HIGH') return;
    const rule = ruleOf(s, r.level, imp);
    await this.notifications.notify(r.tenantId, await this.recipients(r, rule.notify), {
      kind: 'RISK_HIGH', title: `高${r.kind === RiskKind.RISK ? '风险' : '机会'}：${r.title}`, body: r.effect || r.description || '',
      link: r.projectId ? `/projects/${r.projectId}?g=ctrl&s=risks` : '/enterprise-risks',
    }, actorId);
  }

  private async load(actor: AuthUser, projectId: string, id: string) {
    const ctx = await this.access.load(actor, projectId);
    const r = await this.prisma.risk.findFirst({ where: { id, tenantId: ctx.tenantId, OR: [{ projectId }, { links: { some: { projectId } } }] } });
    if (!r) throw new NotFoundException('Risk not found');
    return { ctx, r };
  }
  private async loadEnterprise(actor: AuthUser, id: string) {
    const r = await this.prisma.risk.findFirst({ where: { id, tenantId: requireTenantId(actor), level: RiskLevel3.ENTERPRISE } });
    if (!r) throw new NotFoundException('Risk not found');
    return r;
  }
  private canEdit(actor: AuthUser, r: Risk, ctx: ProjectCtx | null) {
    if (isMgmt(actor) || r.ownerId === actor.id) return true;
    if (r.level === RiskLevel3.ENTERPRISE) return false;
    return !!ctx?.isManager || !!ctx?.isQuality;
  }
  private checkScale(s: RiskSettings, p?: number, i?: number) {
    for (const v of [p, i]) if (v !== undefined && (v < 1 || v > s.scale)) throw new BadRequestException(`probability and impact must be between 1 and ${s.scale}`);
  }
  private async checkRefs(ctx: ProjectCtx, dto: { workPackageId?: string | null; objectiveId?: string | null }) {
    if (dto.workPackageId && !(await this.prisma.workPackage.findFirst({ where: { id: dto.workPackageId, projectId: ctx.project.id } }))) throw new BadRequestException('Work package not found in this project');
    if (dto.objectiveId && !(await this.prisma.projectObjective.findFirst({ where: { id: dto.objectiveId, projectId: ctx.project.id } }))) throw new BadRequestException('Objective not found in this project');
  }
  private checkStrategy(s: RiskSettings, kind: RiskKind, strategy?: string | null) {
    if (strategy && !s.strategies[kind].includes(strategy)) throw new BadRequestException({ code: 'UNKNOWN_STRATEGY', message: `Unknown strategy: ${strategy}` });
  }
  /** 定了应对策略就要有成本收益分析（8.1.3.9）；选“接受”时按规则检查理由和应急预案 */
  private checkAccept(rule: Rule, strategy: string | null | undefined, reason?: string | null, plan?: string | null, cba?: string | null) {
    if (strategy && !cba?.trim()) throw new BadRequestException({ code: 'CBA_REQUIRED', message: 'A cost-benefit analysis is required once a response strategy is chosen' });
    if (strategy !== ACCEPT) return;
    if (!reason?.trim()) throw new BadRequestException({ code: 'ACCEPT_REASON_REQUIRED', message: 'A reason is required to accept this risk' });
    if (rule.accept !== 'REASON' && !plan?.trim()) throw new BadRequestException({ code: 'CONTINGENCY_REQUIRED', message: 'A contingency plan is required to accept this risk' });
  }

  // ───── 项目内 ─────

  async create(actor: AuthUser, projectId: string, dto: CreateRiskDto) {
    const ctx = await this.access.load(actor, projectId);
    this.access.requireOpen(ctx);
    if (!ctx.member && !ctx.isManager) throw new ForbiddenException('Project members only');
    const s = await this.settings(ctx.tenantId);
    this.checkScale(s, dto.probability, dto.impact);
    this.checkStrategy(s, dto.kind, dto.strategy);
    await this.issues.checkOwner(ctx.tenantId, projectId, dto.ownerId);
    await this.checkRefs(ctx, dto);
    const level = !dto.level || dto.level === RiskLevel3.ENTERPRISE ? (dto.workPackageId ? RiskLevel3.WORK_PACKAGE : RiskLevel3.PROJECT) : dto.level;
    const rule = ruleOf(s, level, importanceOf(s, dto.probability, dto.impact));
    this.checkAccept(rule, dto.strategy, dto.acceptReason, dto.contingencyPlan, dto.costBenefitAnalysis);
    const { level: _l, ...rest } = dto;
    const r = await this.audit.tx(
      actor,
      { action: 'risk.create', entity: 'Risk', entityId: (x) => x.id, after: (x) => ({ kind: x.kind, level: x.level, title: x.title, probability: x.probability, impact: x.impact }) },
      (tx) => tx.risk.create({
        data: {
          ...rest, level, tenantId: ctx.tenantId, projectId, createdById: actor.id, ownerId: dto.ownerId ?? actor.id,
          costBenefitAnalysis: dto.costBenefitAnalysis ?? '', exposureAmount: dto.exposureAmount ?? 0, responseCost: dto.responseCost ?? 0,
          reviewCycleDays: dto.reviewCycleDays ?? rule.reviewDays, nextReviewAt: addDays(dto.reviewCycleDays ?? rule.reviewDays),
        },
      }),
    );
    await this.notifyIfHigher(r, s, actor.id);
    return r;
  }

  async update(actor: AuthUser, projectId: string, id: string, dto: UpdateRiskDto) {
    const { ctx, r } = await this.load(actor, projectId, id);
    this.access.requireOpen(ctx);
    return this.applyUpdate(actor, r, ctx, dto);
  }

  private async applyUpdate(actor: AuthUser, r: Risk, ctx: ProjectCtx | null, dto: UpdateRiskDto) {
    if (!this.canEdit(actor, r, ctx)) throw new ForbiddenException('Only the owner or project management can update this entry');
    if (r.status === RiskStatus.CLOSED) throw new ConflictException('Closed entries are locked');
    const s = await this.settings(r.tenantId);
    this.checkScale(s, dto.probability, dto.impact);
    this.checkStrategy(s, r.kind, dto.strategy);
    if (ctx) { await this.issues.checkOwner(r.tenantId, ctx.project.id, dto.ownerId); await this.checkRefs(ctx, dto); }
    if (dto.status === RiskStatus.CLOSED) {
      return this.close(actor, r, ctx, { note: dto.closureNote ?? '', residualProbability: dto.probability ?? r.probability, residualImpact: dto.impact ?? r.impact });
    }
    const p = dto.probability ?? r.probability, i = dto.impact ?? r.impact;
    const rule = ruleOf(s, r.level, importanceOf(s, p, i));
    const strategy = dto.strategy === undefined ? r.strategy : dto.strategy;
    this.checkAccept(rule, strategy, dto.acceptReason ?? r.acceptReason, dto.contingencyPlan ?? r.contingencyPlan, dto.costBenefitAnalysis ?? r.costBenefitAnalysis);
    const { reviewed, closureNote: _c, status, ...rest } = dto;
    const resetAccept = dto.strategy !== undefined && dto.strategy !== r.strategy;
    const updated = await this.audit.tx(
      actor,
      {
        action: 'risk.update', entity: 'Risk', entityId: () => r.id,
        before: { status: r.status, probability: r.probability, impact: r.impact, strategy: r.strategy },
        after: (x) => ({ status: x.status, probability: x.probability, impact: x.impact, strategy: x.strategy }),
      },
      (tx) => tx.risk.update({
        where: { id: r.id },
        data: {
          ...rest,
          ...(status ? { status } : {}),
          ...(resetAccept ? { acceptApprovedAt: null, acceptApprovedById: null } : {}),
          ...(reviewed ? { lastReviewedAt: new Date(), nextReviewAt: addDays(r.reviewCycleDays ?? rule.reviewDays) } : {}),
          ...(dto.reviewCycleDays ? { nextReviewAt: addDays(dto.reviewCycleDays) } : {}),
        },
      }),
    );
    await this.notifyIfHigher(updated, s, actor.id);
    return updated;
  }

  /** 项目内风险的措施 = 行动项（在「问题与行动」跟踪） */
  async addAction(actor: AuthUser, projectId: string, id: string, dto: ActionInputDto) {
    const { ctx, r } = await this.load(actor, projectId, id);
    this.access.requireOpen(ctx);
    if (!this.canEdit(actor, r, ctx)) throw new ForbiddenException('Owner or project management required');
    if (r.level === RiskLevel3.ENTERPRISE) throw new BadRequestException('Measures of enterprise risks are recorded on the enterprise risk');
    await this.issues.checkOwner(ctx.tenantId, projectId, dto.ownerId);
    const created = await this.audit.tx(
      actor,
      { action: 'risk.addAction', entity: 'Risk', entityId: () => id, after: () => ({ title: dto.title }) },
      async (tx) => {
        const a = await this.issues.insert(tx, ctx.tenantId, projectId, actor.id, { kind: 'ACTION', title: dto.title, ownerId: dto.ownerId, dueDate: dto.dueDate, source: 'RISK', riskId: id });
        await tx.risk.update({ where: { id }, data: { status: r.status === RiskStatus.OPEN || r.status === RiskStatus.REVIEW ? RiskStatus.MITIGATING : r.status } });
        return a;
      },
    );
    await this.notifications.notify(ctx.tenantId, [dto.ownerId], { kind: 'ACTION_ASSIGNED', title: `新行动项：${dto.title}`, body: `${ctx.project.code} 风险应对`, link: `/projects/${projectId}?g=ctrl&s=issues` }, actor.id);
    return created;
  }

  /** 复查：重新评价可能性和影响，写复查意见，排下次复查 */
  async review(actor: AuthUser, projectId: string, id: string, dto: ReviewRiskDto) {
    const { ctx, r } = await this.load(actor, projectId, id);
    this.access.requireOpen(ctx);
    return this.doReview(actor, r, ctx, dto);
  }
  private async doReview(actor: AuthUser, r: Risk, ctx: ProjectCtx | null, dto: ReviewRiskDto) {
    if (!this.canEdit(actor, r, ctx)) throw new ForbiddenException('Owner or project management required');
    if (r.status === RiskStatus.CLOSED) throw new ConflictException('Closed entries are locked');
    const s = await this.settings(r.tenantId);
    this.checkScale(s, dto.probability, dto.impact);
    const rule = ruleOf(s, r.level, importanceOf(s, dto.probability, dto.impact));
    const updated = await this.audit.tx(
      actor,
      { action: 'risk.review', entity: 'Risk', entityId: () => r.id, before: { probability: r.probability, impact: r.impact }, after: () => ({ probability: dto.probability, impact: dto.impact, note: dto.note }) },
      async (tx) => {
        await tx.riskReview.create({ data: { tenantId: r.tenantId, riskId: r.id, reviewedById: actor.id, probability: dto.probability, impact: dto.impact, note: dto.note.trim() } });
        return tx.risk.update({ where: { id: r.id }, data: { probability: dto.probability, impact: dto.impact, lastReviewedAt: new Date(), nextReviewAt: addDays(r.reviewCycleDays ?? rule.reviewDays), ...(dto.clearTrigger ? { triggeredAt: null } : {}) } });
      },
    );
    await this.notifyIfHigher(updated, s, actor.id);
    return updated;
  }
  async reviews(actor: AuthUser, projectId: string | null, id: string) {
    const r = projectId ? (await this.load(actor, projectId, id)).r : await this.loadEnterprise(actor, id);
    return this.prisma.riskReview.findMany({ where: { riskId: r.id }, orderBy: { createdAt: 'desc' } });
  }

  /** 预警条件触发：通知规则里的人（项目内同时通知项目经理） */
  async trigger(actor: AuthUser, projectId: string | null, id: string) {
    let r: Risk;
    if (projectId) {
      const x = await this.load(actor, projectId, id);
      if (!x.ctx.member && !x.ctx.isManager && !isMgmt(actor)) throw new ForbiddenException('Project members only');
      r = x.r;
    } else r = await this.loadEnterprise(actor, id);
    const s = await this.settings(r.tenantId);
    const rule = ruleOf(s, r.level, importanceOf(s, r.probability, r.impact));
    const updated = await this.audit.tx(actor, { action: 'risk.trigger', entity: 'Risk', entityId: () => r.id, after: () => ({ trigger: r.trigger }) }, (tx) => tx.risk.update({ where: { id: r.id }, data: { triggeredAt: new Date() } }));
    await this.notifications.notify(r.tenantId, [...(await this.recipients(r, rule.notify)), ...(await this.pms(r.projectId))], {
      kind: 'RISK_TRIGGERED', title: `风险预警：${r.title}`, body: `预警条件已触发：${r.trigger || '（未写）'}`, link: r.projectId ? `/projects/${r.projectId}?g=ctrl&s=risks` : '/enterprise-risks',
    }, actor.id);
    return updated;
  }

  /** “接受”需要管理层确认时，由管理层确认 */
  async approveAccept(actor: AuthUser, projectId: string | null, id: string) {
    const r = projectId ? (await this.load(actor, projectId, id)).r : await this.loadEnterprise(actor, id);
    if (r.strategy !== ACCEPT) throw new ConflictException('This entry is not accepted');
    if (!isMgmt(actor)) throw new ForbiddenException('Management approval required');
    return this.audit.tx(actor, { action: 'risk.acceptApprove', entity: 'Risk', entityId: () => r.id }, (tx) => tx.risk.update({ where: { id: r.id }, data: { acceptApprovedAt: new Date(), acceptApprovedById: actor.id } }));
  }

  /** 复评并关闭：措施全部完成；按规则由谁确认；“接受”需批准的要先批准 */
  async closeRisk(actor: AuthUser, projectId: string, id: string, dto: CloseRiskDto) {
    const { ctx, r } = await this.load(actor, projectId, id);
    this.access.requireOpen(ctx);
    return this.close(actor, r, ctx, dto);
  }
  private async close(actor: AuthUser, r: Risk, ctx: ProjectCtx | null, dto: CloseRiskDto) {
    if (r.status === RiskStatus.CLOSED) throw new ConflictException('Already closed');
    if (!dto.note?.trim()) throw new BadRequestException('closureNote is required to close an entry');
    const s = await this.settings(r.tenantId);
    this.checkScale(s, dto.residualProbability, dto.residualImpact);
    const rule = ruleOf(s, r.level, importanceOf(s, r.probability, r.impact));
    if (!this.allowed(rule.close, actor, r, ctx)) throw new ForbiddenException({ code: 'CLOSE_NOT_ALLOWED', message: `Closing needs ${rule.close === 'MANAGEMENT' ? 'management' : 'the project manager'}` });
    const open = r.level === RiskLevel3.ENTERPRISE
      ? await this.prisma.riskMeasure.count({ where: { riskId: r.id, doneAt: null } })
      : await this.prisma.issue.count({ where: { riskId: r.id, kind: IssueKind.ACTION, status: { not: IssueStatus.CLOSED } } });
    if (open) throw new ConflictException({ code: 'MEASURES_OPEN', message: `${open} measure(s) are not completed` });
    if (r.strategy === ACCEPT && rule.accept === 'REASON_PLAN_APPROVAL' && !r.acceptApprovedAt) throw new ConflictException({ code: 'ACCEPT_NOT_APPROVED', message: 'Management has not confirmed accepting this risk' });
    return this.audit.tx(
      actor,
      { action: 'risk.close', entity: 'Risk', entityId: () => r.id, after: () => ({ residual: [dto.residualProbability, dto.residualImpact], note: dto.note }) },
      (tx) => tx.risk.update({
        where: { id: r.id },
        data: { status: RiskStatus.CLOSED, closureNote: dto.note.trim(), residualProbability: dto.residualProbability, residualImpact: dto.residualImpact, closedAt: new Date(), closedById: actor.id, lastReviewedAt: new Date() },
      }),
    );
  }

  /** 风险已发生：转为问题，风险标记为已发生 */
  async occurred(actor: AuthUser, projectId: string, id: string, dto: OccurredDto) {
    const { ctx, r } = await this.load(actor, projectId, id);
    this.access.requireOpen(ctx);
    if (!this.canEdit(actor, r, ctx)) throw new ForbiddenException('Owner or project management required');
    if (r.kind !== RiskKind.RISK) throw new BadRequestException('Only risks can occur');
    if (!OPEN_STATUSES.includes(r.status)) throw new ConflictException('Entry is not open');
    return this.audit.tx(
      actor,
      { action: 'risk.occurred', entity: 'Risk', entityId: () => r.id, after: () => ({ note: dto.note }) },
      async (tx) => {
        const issue = await this.issues.insert(tx, ctx.tenantId, projectId, actor.id, { kind: 'ISSUE', title: `风险已发生：${r.title}`, description: dto.note, ownerId: r.ownerId ?? undefined, source: 'RISK', riskId: r.id });
        await tx.risk.update({ where: { id: r.id }, data: { status: RiskStatus.OCCURRED } });
        return issue;
      },
    );
  }

  /** 升级：工作包级 → 项目级（项目经理接手）；项目级 → 企业级（管理层接手，原项目挂上关联） */
  async escalate(actor: AuthUser, projectId: string, id: string, dto: EscalateRiskDto) {
    const { ctx, r } = await this.load(actor, projectId, id);
    this.access.requireOpen(ctx);
    if (!this.canEdit(actor, r, ctx)) throw new ForbiddenException('Owner or project management required');
    if (r.level === RiskLevel3.ENTERPRISE) throw new ConflictException('Already an enterprise risk');
    const toEnterprise = r.level === RiskLevel3.PROJECT;
    let owner: string | null;
    if (toEnterprise) {
      const mgmt = await this.mgmt(ctx.tenantId);
      if (dto.ownerId && !mgmt.includes(dto.ownerId)) throw new BadRequestException('The owner of an enterprise risk must be in management');
      owner = dto.ownerId ?? mgmt[0] ?? null;
    } else owner = (await this.pms(projectId))[0] ?? r.ownerId;
    const updated = await this.audit.tx(
      actor,
      { action: 'risk.escalate', entity: 'Risk', entityId: () => r.id, before: { level: r.level, ownerId: r.ownerId }, after: (x) => ({ level: x.level, ownerId: x.ownerId, note: dto.note ?? null }) },
      async (tx) => {
        if (toEnterprise) await tx.riskProjectLink.upsert({ where: { riskId_projectId: { riskId: r.id, projectId } }, create: { tenantId: ctx.tenantId, riskId: r.id, projectId }, update: {} });
        return tx.risk.update({ where: { id: r.id }, data: { level: toEnterprise ? RiskLevel3.ENTERPRISE : RiskLevel3.PROJECT, ownerId: owner, ...(toEnterprise ? { projectId: null, workPackageId: null, objectiveId: null } : {}), notifiedLevel: null } });
      },
    );
    const s = await this.settings(ctx.tenantId);
    await this.notifications.notify(ctx.tenantId, [owner], { kind: 'RISK_ESCALATED', title: `风险升级为${toEnterprise ? '企业级' : '项目级'}：${r.title}`, body: dto.note ?? '', link: toEnterprise ? '/enterprise-risks' : `/projects/${projectId}?g=ctrl&s=risks` }, actor.id);
    await this.notifyIfHigher(updated, s, actor.id);
    return updated;
  }

  // ───── 企业级（所有人可见；管理层审批和监控） ─────

  async enterpriseList(actor: AuthUser) {
    const tenantId = requireTenantId(actor);
    const risks = await this.prisma.risk.findMany({ where: { tenantId, level: RiskLevel3.ENTERPRISE }, include: { measures: { orderBy: { createdAt: 'asc' } }, links: true }, orderBy: [{ status: 'asc' }, { createdAt: 'desc' }] });
    const rows = await this.decorate(tenantId, risks);
    return { risks: rows, warnings: this.collectWarnings(rows) };
  }
  async enterpriseCreate(actor: AuthUser, dto: EnterpriseRiskDto) {
    const tenantId = requireTenantId(actor);
    if (!isMgmt(actor)) throw new ForbiddenException('Management required');
    const s = await this.settings(tenantId);
    this.checkScale(s, dto.probability, dto.impact);
    this.checkStrategy(s, dto.kind, dto.strategy);
    const rule = ruleOf(s, RiskLevel3.ENTERPRISE, importanceOf(s, dto.probability, dto.impact));
    this.checkAccept(rule, dto.strategy, dto.acceptReason, dto.contingencyPlan, dto.costBenefitAnalysis);
    const projects = dto.projectIds?.length ? await this.prisma.project.findMany({ where: { tenantId, id: { in: dto.projectIds } }, select: { id: true } }) : [];
    if (projects.length !== (dto.projectIds?.length ?? 0)) throw new BadRequestException('Unknown project');
    if (dto.ownerId && !(await this.prisma.user.findFirst({ where: { id: dto.ownerId, tenantId, active: true } }))) throw new BadRequestException('Unknown owner');
    const { projectIds: _p, ...rest } = dto;
    const r = await this.audit.tx(
      actor,
      { action: 'risk.create', entity: 'Risk', entityId: (x) => x.id, after: (x) => ({ kind: x.kind, level: x.level, title: x.title }) },
      async (tx) => {
        const x = await tx.risk.create({ data: { ...rest, tenantId, level: RiskLevel3.ENTERPRISE, createdById: actor.id, ownerId: dto.ownerId ?? actor.id, reviewCycleDays: rule.reviewDays, nextReviewAt: addDays(rule.reviewDays) } });
        if (projects.length) await tx.riskProjectLink.createMany({ data: projects.map((p) => ({ tenantId, riskId: x.id, projectId: p.id })) });
        return x;
      },
    );
    await this.notifyIfHigher(r, s, actor.id);
    return r;
  }
  async enterpriseUpdate(actor: AuthUser, id: string, dto: UpdateRiskDto) {
    const r = await this.loadEnterprise(actor, id);
    const { projectIds, ...rest } = dto;
    if (projectIds) {
      if (!isMgmt(actor)) throw new ForbiddenException('Management required');
      const projects = await this.prisma.project.findMany({ where: { tenantId: r.tenantId, id: { in: projectIds } }, select: { id: true } });
      if (projects.length !== projectIds.length) throw new BadRequestException('Unknown project');
      await this.prisma.riskProjectLink.deleteMany({ where: { riskId: id, projectId: { notIn: projectIds } } });
      await this.prisma.riskProjectLink.createMany({ data: projectIds.map((p) => ({ tenantId: r.tenantId, riskId: id, projectId: p })), skipDuplicates: true });
    }
    if (rest.ownerId && !(await this.prisma.user.findFirst({ where: { id: rest.ownerId, tenantId: r.tenantId, active: true } }))) throw new BadRequestException('Unknown owner');
    return this.applyUpdate(actor, r, null, { ...rest, workPackageId: undefined, objectiveId: undefined });
  }
  async enterpriseReview(actor: AuthUser, id: string, dto: ReviewRiskDto) { return this.doReview(actor, await this.loadEnterprise(actor, id), null, dto); }
  async enterpriseClose(actor: AuthUser, id: string, dto: CloseRiskDto) { return this.close(actor, await this.loadEnterprise(actor, id), null, dto); }
  async enterpriseMeasure(actor: AuthUser, id: string, dto: MeasureDto) {
    const r = await this.loadEnterprise(actor, id);
    if (!this.canEdit(actor, r, null)) throw new ForbiddenException('Owner or management required');
    if (dto.ownerId && !(await this.prisma.user.findFirst({ where: { id: dto.ownerId, tenantId: r.tenantId, active: true } }))) throw new BadRequestException('Unknown owner');
    const m = await this.audit.tx(actor, { action: 'risk.addMeasure', entity: 'Risk', entityId: () => id, after: () => ({ title: dto.title }) }, async (tx) => {
      const x = await tx.riskMeasure.create({ data: { tenantId: r.tenantId, riskId: id, title: dto.title.trim(), ownerId: dto.ownerId, dueDate: dto.dueDate ? new Date(dto.dueDate) : null, cost: dto.cost ?? 0 } });
      if (r.status === RiskStatus.OPEN || r.status === RiskStatus.REVIEW) await tx.risk.update({ where: { id }, data: { status: RiskStatus.MITIGATING } });
      return x;
    });
    await this.notifications.notify(r.tenantId, [dto.ownerId], { kind: 'ACTION_ASSIGNED', title: `企业风险措施：${dto.title}`, body: r.title, link: '/enterprise-risks' }, actor.id);
    return m;
  }
  async enterpriseMeasureDone(actor: AuthUser, id: string, mid: string) {
    const r = await this.loadEnterprise(actor, id);
    const m = await this.prisma.riskMeasure.findFirst({ where: { id: mid, riskId: id } });
    if (!m) throw new NotFoundException('Measure not found');
    if (!isMgmt(actor) && m.ownerId !== actor.id && r.ownerId !== actor.id) throw new ForbiddenException('Measure owner or management required');
    if (m.doneAt) throw new ConflictException('Already done');
    await this.audit.tx(actor, { action: 'risk.measureDone', entity: 'Risk', entityId: () => id, after: () => ({ measure: m.title }) }, (tx) => tx.riskMeasure.update({ where: { id: mid }, data: { doneAt: new Date() } }));
    const open = await this.prisma.riskMeasure.count({ where: { riskId: id, doneAt: null } });
    if (open === 0 && (r.status === RiskStatus.OPEN || r.status === RiskStatus.MITIGATING)) await this.prisma.risk.update({ where: { id }, data: { status: RiskStatus.REVIEW } });
    return { ok: true };
  }
}
