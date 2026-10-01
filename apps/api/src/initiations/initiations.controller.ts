import { BadRequestException, Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Res, StreamableFile, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { ApprovalRoleKind, ProjectType, Role } from '../generated/prisma/enums.js';
import { CurrentUser, Roles } from '../common/decorators.js';
import type { AuthUser } from '../common/auth.types.js';
import { ApprovalRolesService } from './approval-roles.service.js';
import {
  AddFromLibraryDto, AssignByRoleDto, DecisionDto, OpinionDto, OptionalWpDto, ReplaceAssignmentsDto, SaveInitiationDto, SaveRequirementChangeDto, UpdateOptionalWpDto,
} from './dto.js';
import { InitiationsService } from './initiations.service.js';
import { PlanTemplateExcelService } from './plan-template-excel.service.js';
import { normalizeRows } from './plan-templates.js';
import { PlanningService } from './planning.service.js';
import { RequirementChangesService } from './requirement-changes.service.js';

const Id = (name = 'id') => Param(name, ParseUUIDPipe);
const kindOf = (k: string) => {
  if (!(Object.values(ApprovalRoleKind) as string[]).includes(k)) throw new BadRequestException('Unknown role kind');
  return k as ApprovalRoleKind;
};
const typeOf = (t: string) => {
  if (!(Object.values(ProjectType) as string[]).includes(t)) throw new BadRequestException('Unknown project type');
  return t as ProjectType;
};

@Controller()
export class InitiationsController {
  constructor(
    private readonly initiations: InitiationsService,
    private readonly changes: RequirementChangesService,
    private readonly roles: ApprovalRolesService,
    private readonly planning: PlanningService,
    private readonly templateExcel: PlanTemplateExcelService,
  ) {}

  // 立项与审批角色
  @Get('approval-roles') @Roles(Role.TENANT_ADMIN, Role.TOP_MANAGEMENT) listRoles(@CurrentUser() u: AuthUser) { return this.roles.list(u); }
  @Get('approval-roles/mine') mine(@CurrentUser() u: AuthUser) { return this.roles.mine(u); }
  @Put('approval-roles/:kind') @Roles(Role.TENANT_ADMIN)
  replaceRoles(@CurrentUser() u: AuthUser, @Param('kind') kind: string, @Body() dto: ReplaceAssignmentsDto) { return this.roles.replace(u, kindOf(kind), dto.entries); }

  // 立项申请
  @Get('initiations') list(@CurrentUser() u: AuthUser) { return this.initiations.list(u); }
  @Post('initiations') create(@CurrentUser() u: AuthUser, @Body() dto: SaveInitiationDto) { return this.initiations.create(u, dto); }
  @Get('initiations/:id') get(@CurrentUser() u: AuthUser, @Id() id: string) { return this.initiations.get(u, id); }
  @Patch('initiations/:id') update(@CurrentUser() u: AuthUser, @Id() id: string, @Body() dto: SaveInitiationDto) { return this.initiations.update(u, id, dto); }
  @Post('initiations/:id/submit') @HttpCode(200) submit(@CurrentUser() u: AuthUser, @Id() id: string) { return this.initiations.submit(u, id); }
  @Post('initiations/:id/opinions') @HttpCode(200) opinion(@CurrentUser() u: AuthUser, @Id() id: string, @Body() dto: OpinionDto) { return this.initiations.opinion(u, id, dto); }
  @Post('initiations/:id/approve') @HttpCode(200) approve(@CurrentUser() u: AuthUser, @Id() id: string, @Body() dto: DecisionDto) { return this.initiations.approve(u, id, dto); }
  @Post('initiations/:id/reject') @HttpCode(200) reject(@CurrentUser() u: AuthUser, @Id() id: string, @Body() dto: DecisionDto) { return this.initiations.reject(u, id, dto); }
  @Post('initiations/:id/withdraw') @HttpCode(200) withdraw(@CurrentUser() u: AuthUser, @Id() id: string) { return this.initiations.withdraw(u, id); }

  // 项目要求与项目要求变更
  @Get('projects/:id/requirement-versions') versions(@CurrentUser() u: AuthUser, @Id() id: string) { return this.changes.versions(u, id); }
  @Get('projects/:id/requirement-changes') projectChanges(@CurrentUser() u: AuthUser, @Id() id: string) { return this.changes.listForProject(u, id); }
  @Post('projects/:id/requirement-changes') createChange(@CurrentUser() u: AuthUser, @Id() id: string, @Body() dto: SaveRequirementChangeDto) { return this.changes.create(u, id, dto); }
  @Get('requirement-changes') allChanges(@CurrentUser() u: AuthUser) { return this.changes.listAll(u); }
  @Get('requirement-changes/:id') getChange(@CurrentUser() u: AuthUser, @Id() id: string) { return this.changes.get(u, id); }
  @Patch('requirement-changes/:id') updateChange(@CurrentUser() u: AuthUser, @Id() id: string, @Body() dto: SaveRequirementChangeDto) { return this.changes.update(u, id, dto); }
  @Post('requirement-changes/:id/submit') @HttpCode(200) submitChange(@CurrentUser() u: AuthUser, @Id() id: string) { return this.changes.submit(u, id); }
  @Post('requirement-changes/:id/approve') @HttpCode(200) approveChange(@CurrentUser() u: AuthUser, @Id() id: string, @Body() dto: DecisionDto) { return this.changes.approve(u, id, dto); }
  @Post('requirement-changes/:id/reject') @HttpCode(200) rejectChange(@CurrentUser() u: AuthUser, @Id() id: string, @Body() dto: DecisionDto) { return this.changes.reject(u, id, dto); }

  // 计划批准
  @Get('projects/:id/plan-approval') planStatus(@CurrentUser() u: AuthUser, @Id() id: string) { return this.planning.status(u, id); }
  @Post('projects/:id/plan-approval/submit') @HttpCode(200) planSubmit(@CurrentUser() u: AuthUser, @Id() id: string) { return this.planning.submit(u, id); }
  @Post('projects/:id/plan-approval/approve') @HttpCode(200) planApprove(@CurrentUser() u: AuthUser, @Id() id: string) { return this.planning.approve(u, id); }
  @Post('projects/:id/plan-approval/return') @HttpCode(200) planReturn(@CurrentUser() u: AuthUser, @Id() id: string, @Body() dto: DecisionDto) { return this.planning.returnPlan(u, id, dto); }

  // 快速策划
  @Post('projects/:id/wbs/assign-by-role') @HttpCode(200) assignByRole(@CurrentUser() u: AuthUser, @Id() id: string, @Body() dto: AssignByRoleDto) { return this.planning.assignByRole(u, id, dto); }
  @Post('projects/:id/wbs/from-library') addFromLibrary(@CurrentUser() u: AuthUser, @Id() id: string, @Body() dto: AddFromLibraryDto) { return this.planning.addFromLibrary(u, id, dto); }
  @Get('optional-work-packages') library(@CurrentUser() u: AuthUser) { return this.planning.listLibrary(u); }
  @Post('optional-work-packages') @Roles(Role.TENANT_ADMIN) createLibrary(@CurrentUser() u: AuthUser, @Body() dto: OptionalWpDto) { return this.planning.createLibrary(u, dto); }
  @Patch('optional-work-packages/:id') @Roles(Role.TENANT_ADMIN) updateLibrary(@CurrentUser() u: AuthUser, @Id() id: string, @Body() dto: UpdateOptionalWpDto) { return this.planning.updateLibrary(u, id, dto); }

  // A/B/C 计划模板
  @Get('plan-templates/:type') template(@CurrentUser() u: AuthUser, @Param('type') t: string) { return this.planning.getTemplate(u, typeOf(t)); }
  @Put('plan-templates/:type') @Roles(Role.TENANT_ADMIN)
  saveTemplate(@CurrentUser() u: AuthUser, @Param('type') t: string, @Body() body: { items: unknown }) {
    return this.planning.saveTemplate(u, typeOf(t), normalizeRows(body?.items));
  }
  @Get('plan-templates/:type/export')
  async exportTemplate(@CurrentUser() u: AuthUser, @Param('type') t: string, @Res({ passthrough: true }) res: Response) {
    const { buffer, fileName } = await this.templateExcel.export(u, typeOf(t));
    res.set({ 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename="${fileName}"`, 'X-Content-Type-Options': 'nosniff' });
    return new StreamableFile(buffer);
  }
  @Post('plan-templates/:type/import') @HttpCode(200) @Roles(Role.TENANT_ADMIN)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024, files: 1 } }))
  importTemplate(@CurrentUser() u: AuthUser, @Param('type') t: string, @UploadedFile() file: { buffer: Buffer } | undefined) {
    if (!file?.buffer?.length) throw new BadRequestException('An .xlsx file is required');
    return this.templateExcel.import(u, typeOf(t), file.buffer);
  }
  @Post('plan-templates/:type/reset') @HttpCode(200) @Roles(Role.TENANT_ADMIN) resetTemplate(@CurrentUser() u: AuthUser, @Param('type') t: string) { return this.planning.resetTemplate(u, typeOf(t)); }
}
