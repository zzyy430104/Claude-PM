import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { CurrentUser } from '../common/decorators.js';
import type { AuthUser } from '../common/auth.types.js';
import {
  ActionInputDto, AuthorizeOverrideDto, ChangeNoteDto, CreateChangeDto, CreateIssueDto, CreateProjectReviewDto,
  CreateRiskDto, CustomerContactDto, GateDecisionDto, IssueListQuery, RequiredNoteDto, UpdateChangeDto,
  UpdateGateDto, UpdateIssueDto, UpdateRiskDto,
} from './dto.js';
import { ChangesService } from './changes.service.js';
import { GatesService } from './gates.service.js';
import { IssuesService } from './issues.service.js';
import { ReviewsService } from './reviews.service.js';
import { RisksService } from './risks.service.js';

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
  ) {}

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
}
