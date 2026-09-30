import { Global, Module } from '@nestjs/common';
import { ProjectAccess } from './access.service.js';
import { ChangeGuard } from './change-guard.service.js';
import { DeliverablesService } from './deliverables.service.js';
import { ProjectsController } from './projects.controller.js';
import { ProjectsService } from './projects.service.js';
import { TemplatesService } from './templates.service.js';
import { WbsService } from './wbs.service.js';
import { PlanVersionsService } from './plan-versions.service.js';
import { RequirementsService } from './requirements.service.js';

@Global()
@Module({
  controllers: [ProjectsController],
  providers: [ProjectAccess, ChangeGuard, ProjectsService, WbsService, TemplatesService, DeliverablesService, PlanVersionsService, RequirementsService],
  exports: [ProjectAccess, ChangeGuard, PlanVersionsService, WbsService],
})
export class ProjectsModule {}
