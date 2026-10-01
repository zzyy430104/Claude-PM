import { Module } from '@nestjs/common';
import { AnnouncementsService } from './announcements.service.js';
import { CommController } from './comm.controller.js';
import { MeetingsService } from './meetings.service.js';

@Module({
  controllers: [CommController],
  providers: [MeetingsService, AnnouncementsService],
})
export class CommModule {}
