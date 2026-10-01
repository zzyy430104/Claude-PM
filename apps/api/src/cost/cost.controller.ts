import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put } from '@nestjs/common';
import { CurrentUser } from '../common/decorators.js';
import type { AuthUser } from '../common/auth.types.js';
import { CommitmentDto, CreateCostAccountDto, CreateCostEntryDto, UpdateCostAccountDto, WpCostDto, WpEtcDto } from './cost.dto.js';
import { CostPlanService } from './cost-plan.service.js';
import { CostService } from './cost.service.js';

@Controller('projects/:id/cost')
export class CostController {
  constructor(private readonly cost: CostService) {}

  @Get() summary(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.cost.summary(u, id); }
  @Get('entries') entries(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.cost.entries(u, id); }
  @Post('accounts') createAccount(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CreateCostAccountDto) { return this.cost.createAccount(u, id, dto); }
  @Patch('accounts/:aid')
  updateAccount(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Param('aid', ParseUUIDPipe) aid: string, @Body() dto: UpdateCostAccountDto) { return this.cost.updateAccount(u, id, aid, dto); }
  @Post('entries') addEntry(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CreateCostEntryDto) { return this.cost.addEntry(u, id, dto); }
}

/** 成本策划：工作包预算、科目、承诺成本、尚需成本 */
@Controller('projects/:id')
export class CostPlanController {
  constructor(private readonly plan: CostPlanService) {}
  @Get('cost-plan') summary(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.plan.summary(u, id); }
  @Post('cost-plan/default-accounts') @HttpCode(200) defaults(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.plan.ensureAccounts(u, id); }
  @Post('cost-plan/sync-accounts') @HttpCode(200) sync(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.plan.syncAccounts(u, id); }
  @Put('wbs/:wid/cost') wpCost(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Param('wid', ParseUUIDPipe) wid: string, @Body() dto: WpCostDto) { return this.plan.setWpCost(u, id, wid, dto); }
  @Put('wbs/:wid/etc') etc(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Param('wid', ParseUUIDPipe) wid: string, @Body() dto: WpEtcDto) { return this.plan.setEtc(u, id, wid, dto); }
  @Get('cost/commitments') commitments(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.plan.commitments(u, id); }
  @Post('cost/commitments') addCommitment(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CommitmentDto) { return this.plan.addCommitment(u, id, dto); }
}
