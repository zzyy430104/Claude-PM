import { BadRequestException, Body, Controller, Get, Patch } from '@nestjs/common';
import { IsNumber, IsOptional, Max, Min } from 'class-validator';
import { AuditService } from '../audit/audit.service.js';
import { CurrentUser, Roles } from '../common/decorators.js';
import { requireTenantId } from '../common/auth.types.js';
import type { AuthUser } from '../common/auth.types.js';
import { Role } from '../generated/prisma/enums.js';
import { PrismaService } from '../prisma/prisma.service.js';

export class UpdateTenantSettingsDto {
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.5) @Max(1) evmAmber?: number;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.5) @Max(1) evmRed?: number;
}

/** 企业设置：目前是挣值预警阈值（SPI / CPI 低于黄线为黄，低于红线为红） */
@Controller('tenant-settings')
export class SettingsController {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  @Get() async get(@CurrentUser() u: AuthUser) {
    const t = await this.prisma.tenant.findUniqueOrThrow({ where: { id: requireTenantId(u) }, select: { evmAmber: true, evmRed: true } });
    return { evmAmber: Number(t.evmAmber), evmRed: Number(t.evmRed) };
  }

  @Patch() @Roles(Role.TENANT_ADMIN)
  async update(@CurrentUser() u: AuthUser, @Body() dto: UpdateTenantSettingsDto) {
    const id = requireTenantId(u);
    const cur = await this.get(u);
    const next = { evmAmber: dto.evmAmber ?? cur.evmAmber, evmRed: dto.evmRed ?? cur.evmRed };
    if (next.evmRed >= next.evmAmber) throw new BadRequestException('The red threshold must be below the amber threshold');
    await this.audit.tx(
      u,
      { action: 'tenant.settings', entity: 'Tenant', entityId: () => id, before: cur, after: () => next },
      (tx) => tx.tenant.update({ where: { id }, data: next }),
    );
    return next;
  }
}
