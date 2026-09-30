import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Put } from '@nestjs/common';
import { CurrentUser } from '../common/decorators.js';
import type { AuthUser } from '../common/auth.types.js';
import { CreateCommLogDto, CreateTrainingDto, UpdateCommPlanDto, UpdateTrainingDto } from './team.dto.js';
import { TeamService } from './team.service.js';

const P = () => Param('id', ParseUUIDPipe);

@Controller('projects/:id')
export class TeamController {
  constructor(private readonly team: TeamService) {}

  @Get('communication-plan') plan(@CurrentUser() u: AuthUser, @P() id: string) { return this.team.getCommPlan(u, id); }
  @Put('communication-plan') updatePlan(@CurrentUser() u: AuthUser, @P() id: string, @Body() dto: UpdateCommPlanDto) { return this.team.updateCommPlan(u, id, dto); }
  @Get('communication-logs') logs(@CurrentUser() u: AuthUser, @P() id: string) { return this.team.listLogs(u, id); }
  @Post('communication-logs') addLog(@CurrentUser() u: AuthUser, @P() id: string, @Body() dto: CreateCommLogDto) { return this.team.addLog(u, id, dto); }
  @Get('trainings') trainings(@CurrentUser() u: AuthUser, @P() id: string) { return this.team.listTrainings(u, id); }
  @Post('trainings') addTraining(@CurrentUser() u: AuthUser, @P() id: string, @Body() dto: CreateTrainingDto) { return this.team.addTraining(u, id, dto); }
  @Patch('trainings/:tid') updateTraining(@CurrentUser() u: AuthUser, @P() id: string, @Param('tid', ParseUUIDPipe) tid: string, @Body() dto: UpdateTrainingDto) { return this.team.updateTraining(u, id, tid, dto); }
}
