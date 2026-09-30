import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { CurrentUser } from '../common/decorators.js';
import type { AuthUser } from '../common/auth.types.js';
import { CreateCostAccountDto, CreateCostEntryDto, UpdateCostAccountDto } from './cost.dto.js';
import { CostService } from './cost.service.js';

@Controller('projects/:id/cost')
export class CostController {
  constructor(private readonly cost: CostService) {}

  @Get() summary(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.cost.summary(u, id); }
  @Get('entries') entries(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.cost.entries(u, id); }
  @Post('accounts') createAccount(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CreateCostAccountDto) { return this.cost.createAccount(u, id, dto); }
  @Patch('accounts/:aid')
  updateAccount(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Param('aid', ParseUUIDPipe) aid: string, @Body() dto: UpdateCostAccountDto) { return this.cost.updateAccount(u, id, aid, dto); }
  @Post('entries') addEntry(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CreateCostEntryDto) { return this.cost.addEntry(u, id, dto); }
}
