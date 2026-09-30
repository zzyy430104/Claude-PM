import { Global, Module } from '@nestjs/common';
import { ChangesService } from './changes.service.js';
import { GatesService } from './gates.service.js';
import { GovernanceController } from './governance.controller.js';
import { IssuesService } from './issues.service.js';
import { MetricsService } from './metrics.service.js';
import { PerformanceService } from './performance.service.js';
import { ReviewsService } from './reviews.service.js';
import { RisksService } from './risks.service.js';

@Global()
@Module({
  controllers: [GovernanceController],
  providers: [GatesService, ReviewsService, ChangesService, RisksService, IssuesService, MetricsService, PerformanceService],
  exports: [IssuesService, MetricsService, PerformanceService],
})
export class GovernanceModule {}
