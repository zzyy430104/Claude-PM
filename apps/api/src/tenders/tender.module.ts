import { Module } from '@nestjs/common';
import { TenderController } from './tender.controller.js';
import { TenderService } from './tender.service.js';

@Module({ controllers: [TenderController], providers: [TenderService] })
export class TenderModule {}
