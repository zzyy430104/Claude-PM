import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { CurrentUser, Roles } from '../common/decorators.js';
import type { AuthUser } from '../common/auth.types.js';
import { Role } from '../generated/prisma/enums.js';
import { CreateTenantDto, SetTenantActiveDto } from './dto.js';
import { TenantsService } from './tenants.service.js';

@Controller('platform/tenants')
@Roles(Role.PLATFORM_ADMIN)
export class TenantsController {
  constructor(private readonly tenants: TenantsService) {}

  @Post()
  async create(@Body() dto: CreateTenantDto, @CurrentUser() user: AuthUser) {
    const { tenant } = await this.tenants.create(dto, user.id);
    return tenant;
  }

  @Get()
  list() {
    return this.tenants.list();
  }

  @Patch(':id')
  setActive(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetTenantActiveDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.tenants.setActive(id, dto.active, user.id);
  }
}
