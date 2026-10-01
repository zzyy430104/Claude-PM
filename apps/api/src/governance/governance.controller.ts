import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { Role } from '../generated/prisma/enums.js';
import { Roles } from '../common/decorators.js';
import { requireTenantId } from '../common/auth.types.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { ObjectivesService } from './objectives.service.js';
import { DEFAULT_CRITERIA, DEFAULT_RULES, DEFAULT_STRATEGIES, MATRIX_3, MATRIX_5, loadRiskSettings } from './risk-settings.js';
import { CurrentUser } from '../common/decorators.js';
import type { AuthUser } from '../common/auth.types.js';
import {
  ActionInputDto, AuthorizeOverrideDto, ChangeNoteDto, CreateChangeDto, CreateIssueDto, CreateProjectReviewDto,
  CreateRiskDto, CustomerContactDto, GateDecisionDto, IssueListQuery, RequiredNoteDto, UpdateChangeDto,
  UpdateGateDto, UpdateIssueDto, UpdateRiskDto, CloseRiskDto, EnterpriseRiskDto, EscalateRiskDto, MeasureDto, ObjectiveDto, OccurredDto, ReviewRiskDto, UpdateObjectiveDto,
} from './dto.js';
import { ChangesService } from './changes.service.js';
import { GatesService } from './gates.service.js';
import { IssuesService } from './issues.service.js';
import { ReviewsService } from './reviews.service.js';
import { RisksService } from './risks.service.js';
import { PerformanceService } from './performance.service.js';
import { ProjectAccess } from '../projects/access.service.js';

const P = () => Param('id', ParseUUIDPipe);
const U = (name: string) => Param(name, ParseUUIDPipe);

@Controller('projects/:id')
export class GovernanceController {
  constructor(
    private readonly gates: GatesService,
    private readonly reviews: ReviewsService,
    private readonly changes: ChangesService,
    private readonly risks: RisksService,
    private readonly issues: IssuesService,
    private readonly performance: PerformanceService,
    private readonly access: ProjectAccess,
    private readonly objectives: ObjectivesService,
  ) {}

  /** 绩效：挣值、计划与实际对比、质量 / 进度 / 成本红黄绿 */
  @Get('performance') async perf(@CurrentUser() u: AuthUser, @P() id: string) {
    return this.performance.compute(await this.access.load(u, id));
  }

  // 阶段关口评审
  @Get('gate-reviews') listGates(@CurrentUser() u: AuthUser, @P() id: string) { return this.gates.list(u, id); }
  @Get('phases/:phaseId/readiness') readiness(@CurrentUser() u: AuthUser, @P() id: string, @U('phaseId') phaseId: string) { return this.gates.readiness(u, id, phaseId); }
  @Post('phases/:phaseId/gate-reviews') createGate(@CurrentUser() u: AuthUser, @P() id: string, @U('phaseId') phaseId: string) { return this.gates.create(u, id, phaseId); }
  @Patch('gate-reviews/:rid') updateGate(@CurrentUser() u: AuthUser, @P() id: string, @U('rid') rid: string, @Body() dto: UpdateGateDto) { return this.gates.update(u, id, rid, dto); }
  @Post('gate-reviews/:rid/authorize-override') @HttpCode(200)
  authorize(@CurrentUser() u: AuthUser, @P() id: string, @U('rid') rid: string, @Body() dto: AuthorizeOverrideDto) { return this.gates.authorizeOverride(u, id, rid, dto); }
  @Post('gate-reviews/:rid/decision') @HttpCode(200)
  decide(@CurrentUser() u: AuthUser, @P() id: string, @U('rid') rid: string, @Body() dto: GateDecisionDto) { return this.gates.decide(u, id, rid, dto); }

  // 项目评审
  @Get('reviews') listReviews(@CurrentUser() u: AuthUser, @P() id: string) { return this.reviews.list(u, id); }
  @Get('reviews/prepare') prepareReview(@CurrentUser() u: AuthUser, @P() id: string) { return this.reviews.prepare(u, id); }
  @Post('reviews') createReview(@CurrentUser() u: AuthUser, @P() id: string, @Body() dto: CreateProjectReviewDto) { return this.reviews.create(u, id, dto); }

  // 问题与行动项
  @Get('issues') listIssues(@CurrentUser() u: AuthUser, @P() id: string, @Query() q: IssueListQuery) { return this.issues.list(u, id, q.status); }
  @Post('issues') createIssue(@CurrentUser() u: AuthUser, @P() id: string, @Body() dto: CreateIssueDto) { return this.issues.create(u, id, dto); }
  @Patch('issues/:iid') updateIssue(@CurrentUser() u: AuthUser, @P() id: string, @U('iid') iid: string, @Body() dto: UpdateIssueDto) { return this.issues.update(u, id, iid, dto); }

  // 变更控制
  @Get('changes') listChanges(@CurrentUser() u: AuthUser, @P() id: string) { return this.changes.list(u, id); }
  @Post('changes') createChange(@CurrentUser() u: AuthUser, @P() id: string, @Body() dto: CreateChangeDto) { return this.changes.create(u, id, dto); }
  @Patch('changes/:cid') updateChange(@CurrentUser() u: AuthUser, @P() id: string, @U('cid') cid: string, @Body() dto: UpdateChangeDto) { return this.changes.update(u, id, cid, dto); }
  @Get('changes/:cid/history') changeHistory(@CurrentUser() u: AuthUser, @P() id: string, @U('cid') cid: string) { return this.changes.history(u, id, cid); }
  @Post('changes/:cid/submit') @HttpCode(200) submit(@CurrentUser() u: AuthUser, @P() id: string, @U('cid') cid: string) { return this.changes.submit(u, id, cid); }
  @Post('changes/:cid/customer-contact') @HttpCode(200)
  customer(@CurrentUser() u: AuthUser, @P() id: string, @U('cid') cid: string, @Body() dto: CustomerContactDto) { return this.changes.customerContact(u, id, cid, dto); }
  @Post('changes/:cid/approve') @HttpCode(200) approve(@CurrentUser() u: AuthUser, @P() id: string, @U('cid') cid: string, @Body() dto: ChangeNoteDto) { return this.changes.approve(u, id, cid, dto); }
  @Post('changes/:cid/reject') @HttpCode(200) reject(@CurrentUser() u: AuthUser, @P() id: string, @U('cid') cid: string, @Body() dto: RequiredNoteDto) { return this.changes.reject(u, id, cid, dto); }
  @Post('changes/:cid/implement') @HttpCode(200) implement(@CurrentUser() u: AuthUser, @P() id: string, @U('cid') cid: string) { return this.changes.implement(u, id, cid); }
  @Post('changes/:cid/verify') @HttpCode(200) verify(@CurrentUser() u: AuthUser, @P() id: string, @U('cid') cid: string, @Body() dto: RequiredNoteDto) { return this.changes.verify(u, id, cid, dto); }
  @Post('changes/:cid/close') @HttpCode(200) close(@CurrentUser() u: AuthUser, @P() id: string, @U('cid') cid: string) { return this.changes.close(u, id, cid); }

  // 风险与机会
  @Get('risks') listRisks(@CurrentUser() u: AuthUser, @P() id: string) { return this.risks.list(u, id); }
  @Post('risks') createRisk(@CurrentUser() u: AuthUser, @P() id: string, @Body() dto: CreateRiskDto) { return this.risks.create(u, id, dto); }
  @Patch('risks/:rid') updateRisk(@CurrentUser() u: AuthUser, @P() id: string, @U('rid') rid: string, @Body() dto: UpdateRiskDto) { return this.risks.update(u, id, rid, dto); }
  @Post('risks/:rid/actions') addRiskAction(@CurrentUser() u: AuthUser, @P() id: string, @U('rid') rid: string, @Body() dto: ActionInputDto) { return this.risks.addAction(u, id, rid, dto); }
  @Get('risk-warnings') riskWarnings(@CurrentUser() u: AuthUser, @P() id: string) { return this.risks.warnings(u, id); }
  @Get('risks/:rid/reviews') riskReviews(@CurrentUser() u: AuthUser, @P() id: string, @U('rid') rid: string) { return this.risks.reviews(u, id, rid); }
  @Post('risks/:rid/review') @HttpCode(200) reviewRisk(@CurrentUser() u: AuthUser, @P() id: string, @U('rid') rid: string, @Body() dto: ReviewRiskDto) { return this.risks.review(u, id, rid, dto); }
  @Post('risks/:rid/trigger') @HttpCode(200) triggerRisk(@CurrentUser() u: AuthUser, @P() id: string, @U('rid') rid: string) { return this.risks.trigger(u, id, rid); }
  @Post('risks/:rid/accept-approve') @HttpCode(200) acceptRisk(@CurrentUser() u: AuthUser, @P() id: string, @U('rid') rid: string) { return this.risks.approveAccept(u, id, rid); }
  @Post('risks/:rid/close') @HttpCode(200) closeRisk(@CurrentUser() u: AuthUser, @P() id: string, @U('rid') rid: string, @Body() dto: CloseRiskDto) { return this.risks.closeRisk(u, id, rid, dto); }
  @Post('risks/:rid/occurred') occurred(@CurrentUser() u: AuthUser, @P() id: string, @U('rid') rid: string, @Body() dto: OccurredDto) { return this.risks.occurred(u, id, rid, dto); }
  @Post('risks/:rid/escalate') @HttpCode(200) escalate(@CurrentUser() u: AuthUser, @P() id: string, @U('rid') rid: string, @Body() dto: EscalateRiskDto) { return this.risks.escalate(u, id, rid, dto); }

  // 项目目标
  @Get('objectives') objectivesList(@CurrentUser() u: AuthUser, @P() id: string) { return this.objectives.list(u, id); }
  @Post('objectives') createObjective(@CurrentUser() u: AuthUser, @P() id: string, @Body() dto: ObjectiveDto) { return this.objectives.create(u, id, dto); }
  @Patch('objectives/:oid') updateObjective(@CurrentUser() u: AuthUser, @P() id: string, @U('oid') oid: string, @Body() dto: UpdateObjectiveDto) { return this.objectives.update(u, id, oid, dto); }
  @Delete('objectives/:oid') removeObjective(@CurrentUser() u: AuthUser, @P() id: string, @U('oid') oid: string) { return this.objectives.remove(u, id, oid); }
}

/** 企业级风险：企业内所有人可见；管理层登记、审批和监控 */
@Controller('enterprise-risks')
export class EnterpriseRisksController {
  constructor(private readonly risks: RisksService) {}
  @Get() list(@CurrentUser() u: AuthUser) { return this.risks.enterpriseList(u); }
  @Post() create(@CurrentUser() u: AuthUser, @Body() dto: EnterpriseRiskDto) { return this.risks.enterpriseCreate(u, dto); }
  @Patch(':rid') update(@CurrentUser() u: AuthUser, @U('rid') rid: string, @Body() dto: UpdateRiskDto) { return this.risks.enterpriseUpdate(u, rid, dto); }
  @Get(':rid/reviews') reviews(@CurrentUser() u: AuthUser, @U('rid') rid: string) { return this.risks.reviews(u, null, rid); }
  @Post(':rid/review') @HttpCode(200) review(@CurrentUser() u: AuthUser, @U('rid') rid: string, @Body() dto: ReviewRiskDto) { return this.risks.enterpriseReview(u, rid, dto); }
  @Post(':rid/trigger') @HttpCode(200) trigger(@CurrentUser() u: AuthUser, @U('rid') rid: string) { return this.risks.trigger(u, null, rid); }
  @Post(':rid/accept-approve') @HttpCode(200) accept(@CurrentUser() u: AuthUser, @U('rid') rid: string) { return this.risks.approveAccept(u, null, rid); }
  @Post(':rid/close') @HttpCode(200) close(@CurrentUser() u: AuthUser, @U('rid') rid: string, @Body() dto: CloseRiskDto) { return this.risks.enterpriseClose(u, rid, dto); }
  @Post(':rid/measures') measure(@CurrentUser() u: AuthUser, @U('rid') rid: string, @Body() dto: MeasureDto) { return this.risks.enterpriseMeasure(u, rid, dto); }
  @Post(':rid/measures/:mid/done') @HttpCode(200) done(@CurrentUser() u: AuthUser, @U('rid') rid: string, @U('mid') mid: string) { return this.risks.enterpriseMeasureDone(u, rid, mid); }
}

/** 风险管理设置：评价矩阵、影响判断标准、应对策略、按“层级 × 重要度”的规则 */
@Controller('risk-settings')
export class RiskSettingsController {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}
  @Get() get(@CurrentUser() u: AuthUser) { return loadRiskSettings(this.prisma, requireTenantId(u)); }
  @Get('defaults') defaults() { return { matrix3: MATRIX_3, matrix5: MATRIX_5, criteria: DEFAULT_CRITERIA, strategies: DEFAULT_STRATEGIES, rules: DEFAULT_RULES }; }
  @Put() @Roles(Role.TENANT_ADMIN)
  async put(@CurrentUser() u: AuthUser, @Body() body: { scale?: number; matrix?: number[][]; criteria?: Record<string, string[]>; strategies?: { RISK?: string[]; OPPORTUNITY?: string[] }; rules?: Record<string, unknown> }) {
    const tenantId = requireTenantId(u);
    const cur = await loadRiskSettings(this.prisma, tenantId);
    const scale = body.scale ?? cur.scale;
    if (scale !== 3 && scale !== 5) throw new BadRequestException('scale must be 3 or 5');
    const matrix = body.matrix ?? (scale === cur.scale ? cur.matrix : scale === 5 ? MATRIX_5 : MATRIX_3);
    if (!Array.isArray(matrix) || matrix.length !== scale || matrix.some((r) => !Array.isArray(r) || r.length !== scale || r.some((v) => ![0, 1, 2].includes(v)))) throw new BadRequestException('matrix must be scale × scale of 0 / 1 / 2');
    const str = (x: unknown, max: number) => typeof x === 'string' && x.trim().length > 0 && x.length <= max;
    const criteria = body.criteria ?? cur.criteria;
    if (typeof criteria !== 'object' || Object.entries(criteria).some(([k, v]) => !str(k, 20) || !Array.isArray(v) || v.length !== 3 || !v.every((x) => str(x, 200)))) throw new BadRequestException('criteria must map each dimension to [low, medium, high]');
    const strategies = { RISK: body.strategies?.RISK ?? cur.strategies.RISK, OPPORTUNITY: body.strategies?.OPPORTUNITY ?? cur.strategies.OPPORTUNITY };
    for (const l of [strategies.RISK, strategies.OPPORTUNITY]) if (!Array.isArray(l) || !l.length || l.length > 10 || !l.every((x) => str(x, 30))) throw new BadRequestException('invalid strategies');
    const rules = { ...cur.rules };
    for (const [k, v] of Object.entries(body.rules ?? {})) {
      if (!(k in DEFAULT_RULES)) throw new BadRequestException(`Unknown rule ${k}`);
      const r = v as Record<string, unknown>;
      const who = ['OWNER', 'PM', 'MANAGEMENT'];
      if ((r.approve && !who.includes(r.approve as string)) || (r.close && !who.includes(r.close as string)) || (r.accept && !['REASON', 'REASON_PLAN', 'REASON_PLAN_APPROVAL'].includes(r.accept as string))
        || (r.notify && (!Array.isArray(r.notify) || !(r.notify as string[]).every((x) => who.includes(x)))) || (r.reviewDays !== undefined && (!Number.isInteger(r.reviewDays) || (r.reviewDays as number) < 1 || (r.reviewDays as number) > 365))) throw new BadRequestException(`Invalid rule ${k}`);
      rules[k] = { ...rules[k], ...(r as object) };
    }
    const next = { scale, matrix, criteria, strategies, rules };
    await this.audit.tx(u, { action: 'tenant.riskSettings', entity: 'Tenant', entityId: () => tenantId, before: cur as unknown as object, after: () => next as unknown as object },
      (tx) => tx.tenant.update({ where: { id: tenantId }, data: { riskScale: scale, riskMatrix: matrix, riskCriteria: criteria, riskStrategies: strategies, riskRules: rules as unknown as object } }));
    return next;
  }
}
