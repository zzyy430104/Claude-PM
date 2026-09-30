import { Module } from '@nestjs/common';
import { CostModule } from '../cost/cost.module.js';
import { DashboardController } from './dashboard.controller.js';
import { DashboardService } from './dashboard.service.js';
import { SettingsController } from './settings.controller.js';

@Module({ imports: [CostModule], controllers: [DashboardController, SettingsController], providers: [DashboardService] })
export class DashboardModule {}
