import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put } from '@nestjs/common';
import { CurrentUser } from '../common/decorators.js';
import type { AuthUser } from '../common/auth.types.js';
import { CreateNcDto, NcTransitionDto, UpdateNcDto, UpdateQualityPlanDto } from './quality.dto.js';
import { QualityService } from './quality.service.js';

const P = () => Param('id', ParseUUIDPipe);

@Controller('projects/:id')
export class QualityController {
  constructor(private readonly q: QualityService) {}

  @Get('quality-plan') plan(@CurrentUser() u: AuthUser, @P() id: string) { return this.q.getPlan(u, id); }
  @Put('quality-plan') updatePlan(@CurrentUser() u: AuthUser, @P() id: string, @Body() dto: UpdateQualityPlanDto) { return this.q.updatePlan(u, id, dto); }
  @Post('quality-plan/approve') @HttpCode(200) approve(@CurrentUser() u: AuthUser, @P() id: string) { return this.q.approvePlan(u, id); }

  @Get('nonconformities') list(@CurrentUser() u: AuthUser, @P() id: string) { return this.q.listNc(u, id); }
  @Post('nonconformities') create(@CurrentUser() u: AuthUser, @P() id: string, @Body() dto: CreateNcDto) { return this.q.createNc(u, id, dto); }
  @Patch('nonconformities/:nid') update(@CurrentUser() u: AuthUser, @P() id: string, @Param('nid', ParseUUIDPipe) nid: string, @Body() dto: UpdateNcDto) { return this.q.updateNc(u, id, nid, dto); }
  @Post('nonconformities/:nid/transition') @HttpCode(200)
  transition(@CurrentUser() u: AuthUser, @P() id: string, @Param('nid', ParseUUIDPipe) nid: string, @Body() dto: NcTransitionDto) { return this.q.transition(u, id, nid, dto); }
}
