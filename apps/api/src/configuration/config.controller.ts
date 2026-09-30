import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { CurrentUser } from '../common/decorators.js';
import type { AuthUser } from '../common/auth.types.js';
import { CreateBaselineDto, CreateConfigItemDto, UpdateConfigItemDto } from './config.dto.js';
import { ConfigService } from './config.service.js';

const P = () => Param('id', ParseUUIDPipe);

@Controller('projects/:id/config')
export class ConfigController {
  constructor(private readonly cfg: ConfigService) {}

  @Get('items') items(@CurrentUser() u: AuthUser, @P() id: string) { return this.cfg.items(u, id); }
  @Post('items') create(@CurrentUser() u: AuthUser, @P() id: string, @Body() dto: CreateConfigItemDto) { return this.cfg.create(u, id, dto); }
  @Patch('items/:iid') update(@CurrentUser() u: AuthUser, @P() id: string, @Param('iid', ParseUUIDPipe) iid: string, @Body() dto: UpdateConfigItemDto) { return this.cfg.update(u, id, iid, dto); }
  @Get('baselines') baselines(@CurrentUser() u: AuthUser, @P() id: string) { return this.cfg.baselines(u, id); }
  @Post('baselines') createBaseline(@CurrentUser() u: AuthUser, @P() id: string, @Body() dto: CreateBaselineDto) { return this.cfg.createBaseline(u, id, dto); }
  @Get('status') status(@CurrentUser() u: AuthUser, @P() id: string) { return this.cfg.status(u, id); }
}
