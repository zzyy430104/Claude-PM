import { BadRequestException, Body, Controller, Delete, Get, Header, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { CurrentUser } from '../common/decorators.js';
import type { AuthUser } from '../common/auth.types.js';
import { AnnouncementsService } from './announcements.service.js';
import { CommentsService } from './comments.service.js';
import { AnnouncementDto, CommentDto, CommentQuery, ExternalRsvpDto, MeetingDto, MinutesDto, RsvpDto, UpdateMeetingDto } from './dto.js';
import { MeetingsService } from './meetings.service.js';

const P = () => Param('id', ParseUUIDPipe);
const U = (name: string) => Param(name, ParseUUIDPipe);

/** 会议与公告 */
@Controller()
export class CommController {
  constructor(private readonly meetings: MeetingsService, private readonly ann: AnnouncementsService, private readonly comments: CommentsService) {}

  @Get('projects/:id/meetings') list(@CurrentUser() u: AuthUser, @P() id: string) { return this.meetings.list(u, id); }
  @Post('projects/:id/meetings') create(@CurrentUser() u: AuthUser, @P() id: string, @Body() dto: MeetingDto) { return this.meetings.create(u, id, dto); }
  @Get('projects/:id/meetings/:mid') get(@CurrentUser() u: AuthUser, @P() id: string, @U('mid') mid: string) { return this.meetings.get(u, id, mid); }
  @Patch('projects/:id/meetings/:mid') update(@CurrentUser() u: AuthUser, @P() id: string, @U('mid') mid: string, @Body() dto: UpdateMeetingDto) { return this.meetings.update(u, id, mid, dto); }
  @Post('projects/:id/meetings/:mid/notify') @HttpCode(200) notify(@CurrentUser() u: AuthUser, @P() id: string, @U('mid') mid: string) { return this.meetings.notify(u, id, mid); }
  @Get('projects/:id/meetings/:mid/ics') @Header('Content-Type', 'text/calendar; charset=utf-8') @Header('Content-Disposition', 'attachment; filename="meeting.ics"')
  ics(@CurrentUser() u: AuthUser, @P() id: string, @U('mid') mid: string) { return this.meetings.ics(u, id, mid); }
  @Post('projects/:id/meetings/:mid/rsvp') @HttpCode(200) rsvp(@CurrentUser() u: AuthUser, @P() id: string, @U('mid') mid: string, @Body() dto: RsvpDto) { return this.meetings.respond(u, id, mid, dto); }
  @Post('projects/:id/meetings/:mid/attendees/:aid/rsvp') @HttpCode(200) ext(@CurrentUser() u: AuthUser, @P() id: string, @U('mid') mid: string, @U('aid') aid: string, @Body() dto: ExternalRsvpDto) { return this.meetings.registerExternal(u, id, mid, aid, dto); }
  @Post('projects/:id/meetings/:mid/remind') @HttpCode(200) remind(@CurrentUser() u: AuthUser, @P() id: string, @U('mid') mid: string) { return this.meetings.remind(u, id, mid); }
  @Put('projects/:id/meetings/:mid/minutes') minutes(@CurrentUser() u: AuthUser, @P() id: string, @U('mid') mid: string, @Body() dto: MinutesDto) { return this.meetings.saveMinutes(u, id, mid, dto); }
  @Post('projects/:id/meetings/:mid/publish') @HttpCode(200) publish(@CurrentUser() u: AuthUser, @P() id: string, @U('mid') mid: string) { return this.meetings.publish(u, id, mid); }
  @Post('projects/:id/meetings/:mid/next') next(@CurrentUser() u: AuthUser, @P() id: string, @U('mid') mid: string) { return this.meetings.next(u, id, mid); }
  @Post('projects/:id/meetings/:mid/cancel') @HttpCode(200) cancel(@CurrentUser() u: AuthUser, @P() id: string, @U('mid') mid: string) { return this.meetings.cancel(u, id, mid); }
  @Get('meetings/mine') mine(@CurrentUser() u: AuthUser) { return this.meetings.mine(u); }

  @Get('projects/:id/announcements') annList(@CurrentUser() u: AuthUser, @P() id: string) { return this.ann.list(u, id); }
  @Post('projects/:id/announcements') annCreate(@CurrentUser() u: AuthUser, @P() id: string, @Body() dto: AnnouncementDto) { return this.ann.create(u, id, dto); }
  @Post('projects/:id/announcements/:aid/read') @HttpCode(200) annRead(@CurrentUser() u: AuthUser, @P() id: string, @U('aid') aid: string) { return this.ann.markRead(u, id, aid); }
  @Post('projects/:id/announcements/:aid/remind') @HttpCode(200) annRemind(@CurrentUser() u: AuthUser, @P() id: string, @U('aid') aid: string) { return this.ann.remind(u, id, aid); }
  @Get('projects/:id/comments') commentList(@CurrentUser() u: AuthUser, @P() id: string, @Query() q: CommentQuery) {
    if (!q.entityId) throw new BadRequestException('entityId is required');
    return this.comments.list(u, id, q.type, q.entityId);
  }
  @Get('projects/:id/comment-counts') commentCounts(@CurrentUser() u: AuthUser, @P() id: string, @Query() q: CommentQuery) { return this.comments.counts(u, id, q.type); }
  @Post('projects/:id/comments') commentCreate(@CurrentUser() u: AuthUser, @P() id: string, @Body() dto: CommentDto) { return this.comments.create(u, id, dto); }
  @Delete('projects/:id/comments/:cid') commentRemove(@CurrentUser() u: AuthUser, @P() id: string, @U('cid') cid: string) { return this.comments.remove(u, id, cid); }
  @Get('me/mentions') mentions(@CurrentUser() u: AuthUser) { return this.comments.mentions(u); }

  @Get('announcements/unread') unread(@CurrentUser() u: AuthUser) { return this.ann.unreadForMe(u); }
}
