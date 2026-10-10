import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { CurrentUser } from '../common/decorators.js';
import type { AuthUser } from '../common/auth.types.js';
import { NotificationsService } from './notifications.service.js';

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly n: NotificationsService) {}

  @Get() list(@CurrentUser() u: AuthUser, @Query('unread') unread?: string) { return this.n.list(u, unread === 'true'); }
  @Get('email-prefs') prefs(@CurrentUser() u: AuthUser) { return this.n.emailPrefs(u); }
  @Put('email-prefs') setPrefs(@CurrentUser() u: AuthUser, @Body() body: Record<string, unknown>) { return this.n.setEmailPrefs(u, body ?? {}); }
  @Get('count') count(@CurrentUser() u: AuthUser) { return this.n.unreadCount(u); }
  @Post('read-all') @HttpCode(204) readAll(@CurrentUser() u: AuthUser) { return this.n.markAllRead(u); }
  @Post(':id/read') @HttpCode(204) read(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.n.markRead(u, id); }
}
