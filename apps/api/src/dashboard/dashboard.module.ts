import { Module } from '@nestjs/common';
import { CostModule } from '../cost/cost.module.js';
import { DashboardController } from './dashboard.controller.js';
import { DashboardService } from './dashboard.service.js';

@Module({ imports: [CostModule], controllers: [DashboardController], providers: [DashboardService] })
export class DashboardModule {}
