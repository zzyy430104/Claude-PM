import { Module } from '@nestjs/common';
import { CostModule } from '../cost/cost.module.js';
import { EvidenceController } from './evidence.controller.js';
import { EvidenceService } from './evidence.service.js';

@Module({ imports: [CostModule], controllers: [EvidenceController], providers: [EvidenceService] })
export class EvidenceModule {}
