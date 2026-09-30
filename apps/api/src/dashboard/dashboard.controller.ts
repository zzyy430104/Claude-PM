import { Controller, Get } from '@nestjs/common';
import { CurrentUser } from '../common/decorators.js';
import type { AuthUser } from '../common/auth.types.js';
import { DashboardService } from './dashboard.service.js';

@Controller()
export class DashboardController {
  constructor(private readonly d: DashboardService) {}

  @Get('dashboard') portfolio(@CurrentUser() u: AuthUser) { return this.d.portfolio(u); }
  @Get('me/todos') todos(@CurrentUser() u: AuthUser) { return this.d.todos(u); }
}
