import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { CurrentUser } from '../common/decorators.js';
import type { AuthUser } from '../common/auth.types.js';
import { CloseProjectDto, CreateLessonDto } from './knowledge.dto.js';
import { KnowledgeService } from './knowledge.service.js';

@Controller()
export class KnowledgeController {
  constructor(private readonly k: KnowledgeService) {}

  @Get('lessons') search(@CurrentUser() u: AuthUser, @Query('q') q?: string) { return this.k.search(u, q?.slice(0, 100)); }
  @Get('projects/:id/lessons') list(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.k.listForProject(u, id); }
  @Post('projects/:id/lessons') create(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CreateLessonDto) { return this.k.create(u, id, dto); }
  @Post('projects/:id/close') @HttpCode(200) close(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CloseProjectDto) { return this.k.close(u, id, dto); }
}
