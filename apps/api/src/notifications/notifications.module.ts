import { Global, Module } from '@nestjs/common';
import { EmailService } from './email.service.js';
import { NotificationsController } from './notifications.controller.js';
import { NotificationsService } from './notifications.service.js';

@Global()
@Module({ controllers: [NotificationsController], providers: [EmailService, NotificationsService], exports: [NotificationsService, EmailService] })
export class NotificationsModule {}
