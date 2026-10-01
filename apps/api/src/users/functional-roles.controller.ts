import { Body, ConflictException, Controller, Get, NotFoundException, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { Role } from '../generated/prisma/enums.js';
import { AuditService } from '../audit/audit.service.js';
import { CurrentUser, Roles } from '../common/decorators.js';
import { requireTenantId } from '../common/auth.types.js';
import type { AuthUser } from '../common/auth.types.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateFunctionalRoleDto, UpdateFunctionalRoleDto } from './dto.js';

/** 职能角色字典：企业内所有人可查，管理员维护（改名、增加、停用） */
@Controller('functional-roles')
export class FunctionalRolesController {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  @Get()
  list(@CurrentUser() u: AuthUser) {
    return this.prisma.functionalRole.findMany({
      where: { tenantId: requireTenantId(u) },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
  }

  @Post() @Roles(Role.TENANT_ADMIN)
  async create(@CurrentUser() u: AuthUser, @Body() dto: CreateFunctionalRoleDto) {
    const tenantId = requireTenantId(u);
    const max = await this.prisma.functionalRole.aggregate({ where: { tenantId }, _max: { sortOrder: true } });
    return this.unique(() => this.audit.tx(
      u,
      { action: 'functionalRole.create', entity: 'FunctionalRole', entityId: (r) => r.id, after: (r) => ({ name: r.name }) },
      (tx) => tx.functionalRole.create({ data: { tenantId, name: dto.name.trim(), sortOrder: (max._max.sortOrder ?? 0) + 1 } }),
    ));
  }

  @Patch(':id') @Roles(Role.TENANT_ADMIN)
  async update(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateFunctionalRoleDto) {
    const tenantId = requireTenantId(u);
    const cur = await this.prisma.functionalRole.findFirst({ where: { id, tenantId } });
    if (!cur) throw new NotFoundException('Functional role not found');
    return this.unique(() => this.audit.tx(
      u,
      { action: 'functionalRole.update', entity: 'FunctionalRole', entityId: () => id, before: { name: cur.name, active: cur.active, sortOrder: cur.sortOrder }, after: (r) => ({ name: r.name, active: r.active, sortOrder: r.sortOrder }) },
      (tx) => tx.functionalRole.update({ where: { id }, data: { name: dto.name?.trim(), sortOrder: dto.sortOrder, active: dto.active } }),
    ));
  }

  private async unique<T>(fn: () => Promise<T>) {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new ConflictException('A role with this name already exists');
      throw e;
    }
  }
}
