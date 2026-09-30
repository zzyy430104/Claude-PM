import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { CurrentUser, Roles } from '../common/decorators.js';
import type { AuthUser } from '../common/auth.types.js';
import { Role } from '../generated/prisma/enums.js';
import { DashboardService } from './dashboard.service.js';
import { ResourceService } from './resource.service.js';

@Controller()
export class DashboardController {
  constructor(private readonly d: DashboardService, private readonly resources: ResourceService) {}

  @Get('dashboard') portfolio(@CurrentUser() u: AuthUser) { return this.d.portfolio(u); }
  @Get('me/todos') todos(@CurrentUser() u: AuthUser) { return this.d.todos(u); }

  /** 资源负荷：from 为起始日期（默认今天），weeks 为周数（默认 12，最多 52） */
  @Get('resource-load')
  @Roles(Role.TENANT_ADMIN, Role.TOP_MANAGEMENT, Role.PROJECT_MANAGER, Role.FUNCTION_MANAGER)
  load(@CurrentUser() u: AuthUser, @Query('from') from?: string, @Query('weeks') weeks?: string) {
    const f = from ?? new Date().toISOString().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(f)) throw new BadRequestException('from must be YYYY-MM-DD');
    const w = Math.min(Math.max(Number(weeks ?? 12) || 12, 1), 52);
    return this.resources.load(u, f, w);
  }
}
