import { Module } from '@nestjs/common';
import { InspectionTemplatesController, QualityController } from './quality.controller.js';
import { InspectionsService } from './inspections.service.js';
import { QualityService } from './quality.service.js';

@Module({ controllers: [QualityController, InspectionTemplatesController], providers: [QualityService, InspectionsService], exports: [QualityService, InspectionsService] })
export class QualityModule {}
