import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put } from '@nestjs/common';
import { Role } from '../generated/prisma/enums.js';
import { Roles } from '../common/decorators.js';
import { CurrentUser } from '../common/decorators.js';
import type { AuthUser } from '../common/auth.types.js';
import {
  CreateNcDto, FromTemplateDto, InspectionItemDto, InspectionResultDto, InspectionTemplateDto, NcTransitionDto, UpdateInspectionItemDto, UpdateInspectionTemplateDto, UpdateNcDto, UpdateQualityPlanDto,
} from './quality.dto.js';
import { InspectionsService } from './inspections.service.js';
import { QualityService } from './quality.service.js';

const P = () => Param('id', ParseUUIDPipe);

@Controller('projects/:id')
export class QualityController {
  constructor(private readonly q: QualityService, private readonly insp: InspectionsService) {}

  @Get('quality-plan') plan(@CurrentUser() u: AuthUser, @P() id: string) { return this.q.getPlan(u, id); }
  @Put('quality-plan') updatePlan(@CurrentUser() u: AuthUser, @P() id: string, @Body() dto: UpdateQualityPlanDto) { return this.q.updatePlan(u, id, dto); }
  @Post('quality-plan/approve') @HttpCode(200) approve(@CurrentUser() u: AuthUser, @P() id: string) { return this.q.approvePlan(u, id); }

  @Get('nonconformities') list(@CurrentUser() u: AuthUser, @P() id: string) { return this.q.listNc(u, id); }
  @Post('nonconformities') create(@CurrentUser() u: AuthUser, @P() id: string, @Body() dto: CreateNcDto) { return this.q.createNc(u, id, dto); }
  @Patch('nonconformities/:nid') update(@CurrentUser() u: AuthUser, @P() id: string, @Param('nid', ParseUUIDPipe) nid: string, @Body() dto: UpdateNcDto) { return this.q.updateNc(u, id, nid, dto); }
  @Post('nonconformities/:nid/transition') @HttpCode(200)
  transition(@CurrentUser() u: AuthUser, @P() id: string, @Param('nid', ParseUUIDPipe) nid: string, @Body() dto: NcTransitionDto) { return this.q.transition(u, id, nid, dto); }

  // 检验 / 验证项
  @Get('inspections') inspections(@CurrentUser() u: AuthUser, @P() id: string) { return this.insp.list(u, id); }
  @Get('inspections/stats') inspectionStats(@CurrentUser() u: AuthUser, @P() id: string) { return this.insp.stats(u, id); }
  @Post('wbs/:wid/inspections') createInspection(@CurrentUser() u: AuthUser, @P() id: string, @Param('wid', ParseUUIDPipe) wid: string, @Body() dto: InspectionItemDto) { return this.insp.create(u, id, wid, dto); }
  @Post('wbs/:wid/inspections/from-template') fromTemplate(@CurrentUser() u: AuthUser, @P() id: string, @Param('wid', ParseUUIDPipe) wid: string, @Body() dto: FromTemplateDto) { return this.insp.addFromTemplate(u, id, wid, dto.templateId); }
  @Patch('inspections/:iid') updateInspection(@CurrentUser() u: AuthUser, @P() id: string, @Param('iid', ParseUUIDPipe) iid: string, @Body() dto: UpdateInspectionItemDto) { return this.insp.update(u, id, iid, dto); }
  @Delete('inspections/:iid') removeInspection(@CurrentUser() u: AuthUser, @P() id: string, @Param('iid', ParseUUIDPipe) iid: string) { return this.insp.remove(u, id, iid); }
  @Post('inspections/:iid/result') @HttpCode(200) result(@CurrentUser() u: AuthUser, @P() id: string, @Param('iid', ParseUUIDPipe) iid: string, @Body() dto: InspectionResultDto) { return this.insp.record(u, id, iid, dto); }
  @Post('inspections/:iid/nonconformity') openNc(@CurrentUser() u: AuthUser, @P() id: string, @Param('iid', ParseUUIDPipe) iid: string) { return this.insp.openNc(u, id, iid); }
}

/** 企业检验项库 */
@Controller('inspection-templates')
export class InspectionTemplatesController {
  constructor(private readonly insp: InspectionsService) {}
  @Get() list(@CurrentUser() u: AuthUser) { return this.insp.templates(u); }
  @Post() @Roles(Role.TENANT_ADMIN) create(@CurrentUser() u: AuthUser, @Body() dto: InspectionTemplateDto) { return this.insp.createTemplate(u, dto); }
  @Patch(':tid') @Roles(Role.TENANT_ADMIN) update(@CurrentUser() u: AuthUser, @Param('tid', ParseUUIDPipe) tid: string, @Body() dto: UpdateInspectionTemplateDto) { return this.insp.updateTemplate(u, tid, dto); }
}
