import { BadRequestException, Body, Controller, Get, Put } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.js';
import { Role } from '../generated/prisma/enums.js';
import { AuditService } from '../audit/audit.service.js';
import { CurrentUser, Roles } from '../common/decorators.js';
import { requireTenantId } from '../common/auth.types.js';
import type { AuthUser } from '../common/auth.types.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { defaultPermConfig, loadPermConfig, PERM_KEYS, PERM_LABELS, PQM, type PermConfig, type PermKey } from './permissions.js';

/** 企业设置 → 项目权限：各项内容除项目经理外哪些角色可以编辑 */
@Controller('project-permissions')
export class ProjectPermissionsController {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  private roles(tenantId: string) {
    return this.prisma.functionalRole.findMany({ where: { tenantId, active: true }, select: { id: true, name: true }, orderBy: { sortOrder: 'asc' } });
  }

  @Get()
  async get(@CurrentUser() u: AuthUser) {
    const tenantId = requireTenantId(u);
    const [config, roles] = await Promise.all([loadPermConfig(this.prisma, tenantId), this.roles(tenantId)]);
    return { config, roles, rows: PERM_KEYS.map((key) => ({ key, label: PERM_LABELS[key] })) };
  }

  @Put() @Roles(Role.TENANT_ADMIN)
  async put(@CurrentUser() u: AuthUser, @Body() body: Partial<PermConfig> & { reset?: boolean }) {
    const tenantId = requireTenantId(u);
    const [cur, roles] = await Promise.all([loadPermConfig(this.prisma, tenantId), this.roles(tenantId)]);
    let next: PermConfig;
    if (body.reset) next = defaultPermConfig(roles);
    else {
      if (!body.grants || typeof body.grants !== 'object') throw new BadRequestException('grants required');
      const valid = new Set([PQM, ...roles.map((r) => r.id)]);
      const grants = {} as Record<PermKey, string[]>;
      for (const k of PERM_KEYS) {
        const v = (body.grants as Record<string, unknown>)[k] ?? [];
        if (!Array.isArray(v) || v.some((x) => typeof x !== 'string' || !valid.has(x))) throw new BadRequestException(`invalid grants for ${k}`);
        grants[k] = [...new Set(v as string[])];
      }
      next = { grants };
    }
    await this.audit.tx(u, { action: 'tenant.projectPermissions', entity: 'Tenant', entityId: () => tenantId, before: cur as unknown as Prisma.InputJsonValue, after: () => next as unknown as Prisma.InputJsonValue },
      (tx) => tx.tenant.update({ where: { id: tenantId }, data: { permConfig: next as unknown as Prisma.InputJsonValue } }));
    return this.get(u);
  }
}
