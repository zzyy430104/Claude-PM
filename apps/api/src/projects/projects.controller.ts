import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { CurrentUser, Roles } from '../common/decorators.js';
import type { AuthUser } from '../common/auth.types.js';
import { Role } from '../generated/prisma/enums.js';
import {
  AddDependencyDto, AddMemberDto, CreateDeliverableDto, CreatePhaseTemplateDto, CreateProjectDto,
  CreateRequirementDto, CreateWpDto, DeleteWpQuery, UpdateRequirementDto, UpdateDeliverableDto, UpdateMemberDto, UpdatePhaseDto, UpdatePlanDto,
  UpdateProjectDto, UpdateWpDto,
} from './dto.js';
import { DeliverablesService } from './deliverables.service.js';
import { ProjectsService } from './projects.service.js';
import { TemplatesService } from './templates.service.js';
import { WbsService } from './wbs.service.js';
import { PlanVersionsService } from './plan-versions.service.js';
import { RequirementsService } from './requirements.service.js';

const Id = () => Param('id', ParseUUIDPipe);

@Controller()
export class ProjectsController {
  constructor(
    private readonly projects: ProjectsService,
    private readonly wbs: WbsService,
    private readonly templates: TemplatesService,
    private readonly deliverables: DeliverablesService,
    private readonly planVersions: PlanVersionsService,
    private readonly requirements: RequirementsService,
  ) {}

  // 阶段模板
  @Get('phase-templates') listTemplates(@CurrentUser() u: AuthUser) { return this.templates.list(u); }
  @Post('phase-templates') @Roles(Role.TENANT_ADMIN)
  createTemplate(@CurrentUser() u: AuthUser, @Body() dto: CreatePhaseTemplateDto) { return this.templates.create(u, dto); }
  @Delete('phase-templates/:id') @Roles(Role.TENANT_ADMIN) @HttpCode(204)
  deleteTemplate(@CurrentUser() u: AuthUser, @Id() id: string) { return this.templates.deactivate(u, id); }

  // 项目
  @Get('projects') list(@CurrentUser() u: AuthUser) { return this.projects.list(u); }
  @Post('projects') create(@CurrentUser() u: AuthUser, @Body() dto: CreateProjectDto) { return this.projects.create(u, dto); }
  @Get('projects/:id') get(@CurrentUser() u: AuthUser, @Id() id: string) { return this.projects.get(u, id); }
  @Patch('projects/:id') update(@CurrentUser() u: AuthUser, @Id() id: string, @Body() dto: UpdateProjectDto) { return this.projects.update(u, id, dto); }
  @Post('projects/:id/baseline') @HttpCode(200) baseline(@CurrentUser() u: AuthUser, @Id() id: string) { return this.projects.baseline(u, id); }

  @Get('projects/:id/plan-versions') planVersionList(@CurrentUser() u: AuthUser, @Id() id: string) { return this.planVersions.list(u, id); }

  // 需求
  @Get('projects/:id/requirements') reqList(@CurrentUser() u: AuthUser, @Id() id: string) { return this.requirements.list(u, id); }
  @Post('projects/:id/requirements') reqCreate(@CurrentUser() u: AuthUser, @Id() id: string, @Body() dto: CreateRequirementDto) { return this.requirements.create(u, id, dto); }
  @Patch('projects/:id/requirements/:rid')
  reqUpdate(@CurrentUser() u: AuthUser, @Id() id: string, @Param('rid', ParseUUIDPipe) rid: string, @Body() dto: UpdateRequirementDto) {
    return this.requirements.update(u, id, rid, dto);
  }
  @Delete('projects/:id/requirements/:rid') @HttpCode(204)
  reqDelete(@CurrentUser() u: AuthUser, @Id() id: string, @Param('rid', ParseUUIDPipe) rid: string, @Query() q: DeleteWpQuery) {
    return this.requirements.remove(u, id, rid, q.changeRequestId);
  }

  // 成员
  @Get('projects/:id/members') members(@CurrentUser() u: AuthUser, @Id() id: string) { return this.projects.listMembers(u, id); }
  @Post('projects/:id/members') addMember(@CurrentUser() u: AuthUser, @Id() id: string, @Body() dto: AddMemberDto) { return this.projects.addMember(u, id, dto); }
  @Patch('projects/:id/members/:userId')
  updateMember(@CurrentUser() u: AuthUser, @Id() id: string, @Param('userId', ParseUUIDPipe) userId: string, @Body() dto: UpdateMemberDto) {
    return this.projects.updateMember(u, id, userId, dto);
  }

  // 项目管理计划
  @Get('projects/:id/plan') plan(@CurrentUser() u: AuthUser, @Id() id: string) { return this.projects.getPlan(u, id); }
  @Put('projects/:id/plan') updatePlan(@CurrentUser() u: AuthUser, @Id() id: string, @Body() dto: UpdatePlanDto) { return this.projects.updatePlan(u, id, dto); }

  // 阶段
  @Get('projects/:id/phases') phases(@CurrentUser() u: AuthUser, @Id() id: string) { return this.projects.listPhases(u, id); }
  @Patch('projects/:id/phases/:phaseId')
  updatePhase(@CurrentUser() u: AuthUser, @Id() id: string, @Param('phaseId', ParseUUIDPipe) phaseId: string, @Body() dto: UpdatePhaseDto) {
    return this.projects.updatePhase(u, id, phaseId, dto);
  }

  // WBS 与进度
  @Get('projects/:id/wbs') getWbs(@CurrentUser() u: AuthUser, @Id() id: string) { return this.wbs.get(u, id); }
  @Post('projects/:id/wbs') createWp(@CurrentUser() u: AuthUser, @Id() id: string, @Body() dto: CreateWpDto) { return this.wbs.create(u, id, dto); }
  @Patch('projects/:id/wbs/:wpId')
  updateWp(@CurrentUser() u: AuthUser, @Id() id: string, @Param('wpId', ParseUUIDPipe) wpId: string, @Body() dto: UpdateWpDto) {
    return this.wbs.update(u, id, wpId, dto);
  }
  @Post('projects/:id/wbs/:wpId/verify') @HttpCode(200)
  verifyWp(@CurrentUser() u: AuthUser, @Id() id: string, @Param('wpId', ParseUUIDPipe) wpId: string) { return this.wbs.verify(u, id, wpId); }
  @Delete('projects/:id/wbs/:wpId') @HttpCode(204)
  removeWp(@CurrentUser() u: AuthUser, @Id() id: string, @Param('wpId', ParseUUIDPipe) wpId: string, @Query() q: DeleteWpQuery) {
    return this.wbs.remove(u, id, wpId, q.changeRequestId);
  }
  @Post('projects/:id/dependencies') addDep(@CurrentUser() u: AuthUser, @Id() id: string, @Body() dto: AddDependencyDto) { return this.wbs.addDependency(u, id, dto); }
  @Delete('projects/:id/dependencies/:depId') @HttpCode(204)
  removeDep(@CurrentUser() u: AuthUser, @Id() id: string, @Param('depId', ParseUUIDPipe) depId: string) { return this.wbs.removeDependency(u, id, depId); }

  // 交付物
  @Get('projects/:id/deliverables') listDeliverables(@CurrentUser() u: AuthUser, @Id() id: string) { return this.deliverables.list(u, id); }
  @Post('projects/:id/deliverables') createDeliverable(@CurrentUser() u: AuthUser, @Id() id: string, @Body() dto: CreateDeliverableDto) { return this.deliverables.create(u, id, dto); }
  @Patch('projects/:id/deliverables/:did')
  updateDeliverable(@CurrentUser() u: AuthUser, @Id() id: string, @Param('did', ParseUUIDPipe) did: string, @Body() dto: UpdateDeliverableDto) {
    return this.deliverables.update(u, id, did, dto);
  }
}
