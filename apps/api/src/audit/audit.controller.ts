import { Controller, Get, Query } from '@nestjs/common';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { CurrentUser, Roles } from '../common/decorators.js';
import { requireTenantId } from '../common/auth.types.js';
import type { AuthUser } from '../common/auth.types.js';
import { Role } from '../generated/prisma/enums.js';
import { AuditService } from './audit.service.js';

class AuditQuery {
  @IsOptional() @IsString() entity?: string;
  @IsOptional() @IsString() entityId?: string;
  @IsOptional() @IsString() cursor?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) limit?: number;
}

@Controller('audit-logs')
@Roles(Role.TENANT_ADMIN, Role.TOP_MANAGEMENT)
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query() q: AuditQuery) {
    return this.audit.list(requireTenantId(user), {
      entity: q.entity,
      entityId: q.entityId,
      cursor: q.cursor,
      take: q.limit ?? 50,
    });
  }
}
