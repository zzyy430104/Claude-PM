import { Module } from '@nestjs/common';
import { CostController, CostPlanController } from './cost.controller.js';
import { CostPlanService } from './cost-plan.service.js';
import { CostService } from './cost.service.js';

@Module({ controllers: [CostController, CostPlanController], providers: [CostService, CostPlanService], exports: [CostService, CostPlanService] })
export class CostModule {}
