import { Module } from '@nestjs/common';
import { CostModule } from '../cost/cost.module.js';
import { InitiationsModule } from '../initiations/initiations.module.js';
import { DashboardController } from './dashboard.controller.js';
import { DashboardService } from './dashboard.service.js';
import { BrandingController, SettingsController } from './settings.controller.js';
import { ResourceService } from './resource.service.js';

@Module({ imports: [CostModule, InitiationsModule], controllers: [DashboardController, SettingsController, BrandingController], providers: [DashboardService, ResourceService] })
export class DashboardModule {}
