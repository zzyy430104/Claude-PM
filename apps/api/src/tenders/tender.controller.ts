import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { CurrentUser } from '../common/decorators.js';
import type { AuthUser } from '../common/auth.types.js';
import { ConvertTenderDto, CreateTenderDto, TenderDecisionDto, UpdateTenderDto } from './tender.dto.js';
import { TenderService } from './tender.service.js';

const I = () => Param('id', ParseUUIDPipe);

@Controller('tenders')
export class TenderController {
  constructor(private readonly t: TenderService) {}

  @Get() list(@CurrentUser() u: AuthUser) { return this.t.list(u); }
  @Post() create(@CurrentUser() u: AuthUser, @Body() dto: CreateTenderDto) { return this.t.create(u, dto); }
  @Get(':id') get(@CurrentUser() u: AuthUser, @I() id: string) { return this.t.get(u, id); }
  @Patch(':id') update(@CurrentUser() u: AuthUser, @I() id: string, @Body() dto: UpdateTenderDto) { return this.t.update(u, id, dto); }
  @Post(':id/submit') @HttpCode(200) submit(@CurrentUser() u: AuthUser, @I() id: string) { return this.t.submit(u, id); }
  @Post(':id/approve') @HttpCode(200) approve(@CurrentUser() u: AuthUser, @I() id: string, @Body() dto: TenderDecisionDto) { return this.t.approve(u, id, dto); }
  @Post(':id/reject') @HttpCode(200) reject(@CurrentUser() u: AuthUser, @I() id: string, @Body() dto: TenderDecisionDto) { return this.t.reject(u, id, dto); }
  @Post(':id/won') @HttpCode(200) won(@CurrentUser() u: AuthUser, @I() id: string) { return this.t.outcome(u, id, true); }
  @Post(':id/lost') @HttpCode(200) lost(@CurrentUser() u: AuthUser, @I() id: string) { return this.t.outcome(u, id, false); }
  @Post(':id/convert') convert(@CurrentUser() u: AuthUser, @I() id: string, @Body() dto: ConvertTenderDto) { return this.t.convert(u, id, dto); }
}
