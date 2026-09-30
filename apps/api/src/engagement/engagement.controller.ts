import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { CurrentUser } from '../common/decorators.js';
import type { AuthUser } from '../common/auth.types.js';
import { CreateDeviationDto, CreateSwotDto, StakeholderDto, UpdateStakeholderDto } from './engagement.dto.js';
import { EngagementService } from './engagement.service.js';

const P = () => Param('id', ParseUUIDPipe);

@Controller('projects/:id')
export class EngagementController {
  constructor(private readonly e: EngagementService) {}

  @Get('swot') swot(@CurrentUser() u: AuthUser, @P() id: string) { return this.e.listSwot(u, id); }
  @Post('swot') addSwot(@CurrentUser() u: AuthUser, @P() id: string, @Body() dto: CreateSwotDto) { return this.e.createSwot(u, id, dto); }

  @Get('deviations') deviations(@CurrentUser() u: AuthUser, @P() id: string) { return this.e.listDeviations(u, id); }
  @Post('deviations') addDeviation(@CurrentUser() u: AuthUser, @P() id: string, @Body() dto: CreateDeviationDto) { return this.e.createDeviation(u, id, dto); }

  @Get('stakeholders') stakeholders(@CurrentUser() u: AuthUser, @P() id: string) { return this.e.listStakeholders(u, id); }
  @Post('stakeholders') addStakeholder(@CurrentUser() u: AuthUser, @P() id: string, @Body() dto: StakeholderDto) { return this.e.createStakeholder(u, id, dto); }
  @Patch('stakeholders/:sid')
  updateStakeholder(@CurrentUser() u: AuthUser, @P() id: string, @Param('sid', ParseUUIDPipe) sid: string, @Body() dto: UpdateStakeholderDto) {
    return this.e.updateStakeholder(u, id, sid, dto);
  }
  @Delete('stakeholders/:sid') @HttpCode(204)
  deleteStakeholder(@CurrentUser() u: AuthUser, @P() id: string, @Param('sid', ParseUUIDPipe) sid: string) { return this.e.deleteStakeholder(u, id, sid); }

  @Get('weekly-report') report(@CurrentUser() u: AuthUser, @P() id: string, @Query('days') days?: string) {
    return this.e.weeklyReport(u, id, Math.min(Math.max(Number(days ?? 7) || 7, 1), 31));
  }
}
