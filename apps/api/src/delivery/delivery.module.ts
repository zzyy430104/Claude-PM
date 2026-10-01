import { Module } from '@nestjs/common';
import { DeliveryController } from './delivery.controller.js';
import { FaiService } from './fai.service.js';
import { HandoverService } from './handover.service.js';
import { PurchaseService } from './purchase.service.js';

@Module({
  controllers: [DeliveryController],
  providers: [PurchaseService, FaiService, HandoverService],
})
export class DeliveryModule {}
