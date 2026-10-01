import { Module } from '@nestjs/common';
import { ApprovalRolesService } from './approval-roles.service.js';
import { InitiationsController } from './initiations.controller.js';
import { InitiationsService } from './initiations.service.js';
import { PlanBuilderService } from './plan-builder.service.js';
import { PlanningService } from './planning.service.js';
import { RequirementChangesService } from './requirement-changes.service.js';
import { PlanTemplateExcelService } from './plan-template-excel.service.js';

@Module({
  controllers: [InitiationsController],
  providers: [ApprovalRolesService, InitiationsService, PlanBuilderService, PlanningService, RequirementChangesService, PlanTemplateExcelService],
})
export class InitiationsModule {}
