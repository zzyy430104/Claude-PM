import { Global, Module } from '@nestjs/common';
import { ProjectAccess } from './access.service.js';
import { ChangeGuard } from './change-guard.service.js';
import { DeliverablesService } from './deliverables.service.js';
import { ProjectPermissionsController } from './permissions.controller.js';
import { ProjectsController } from './projects.controller.js';
import { ProjectsService } from './projects.service.js';
import { TemplatesService } from './templates.service.js';
import { WbsService } from './wbs.service.js';
import { PlanVersionsService } from './plan-versions.service.js';
import { RequirementsService } from './requirements.service.js';
import { CalendarService } from './calendar.service.js';
import { WbsExcelService } from './wbs-excel.service.js';
import { WbsTemplatesService } from './wbs-templates.service.js';
import { CostControlService } from './cost-control.service.js';

@Global()
@Module({
  controllers: [ProjectsController, ProjectPermissionsController],
  providers: [ProjectAccess, ChangeGuard, ProjectsService, WbsService, TemplatesService, DeliverablesService, PlanVersionsService, RequirementsService, CalendarService, WbsExcelService, WbsTemplatesService, CostControlService],
  exports: [ProjectAccess, ChangeGuard, PlanVersionsService, WbsService, CalendarService, CostControlService],
})
export class ProjectsModule {}
