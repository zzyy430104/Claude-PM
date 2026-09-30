import { Module } from '@nestjs/common';
import { CostController } from './cost.controller.js';
import { CostService } from './cost.service.js';

@Module({ controllers: [CostController], providers: [CostService], exports: [CostService] })
export class CostModule {}
