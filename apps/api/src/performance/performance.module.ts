import { Module } from '@nestjs/common';
import { DepartmentsController, PerfSettingsController, PerformanceController } from './performance.controller.js';
import { EvaluationService } from './evaluation.service.js';

@Module({
  controllers: [PerformanceController, DepartmentsController, PerfSettingsController],
  providers: [EvaluationService],
})
export class PerformanceModule {}
