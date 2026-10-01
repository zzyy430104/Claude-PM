import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { Role } from '../generated/prisma/enums.js';
import { AuditService } from '../audit/audit.service.js';
import { hashPassword } from '../common/password.js';
import { PrismaService } from '../prisma/prisma.service.js';

/** 新企业默认的职能角色，企业可以改名、增加或停用 */
export const DEFAULT_FUNCTIONAL_ROLES = ['项目经理', '技术', '设计', '工艺', '质量', '生产', '采购', '计划', '物流', '仓库', '售后'];

export interface CreateTenantInput {
  name: string;
  slug: string;
  adminEmail: string;
  adminName: string;
  adminPassword: string;
}

@Injectable()
export class TenantsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** 创建租户及其首个租户管理员，同事务写审计 */
  async create(input: CreateTenantInput, actorId: string | null) {
    const passwordHash = await hashPassword(input.adminPassword);
    try {
      return await this.prisma.txn(async (tx) => {
        const tenant = await tx.tenant.create({
          data: { name: input.name, slug: input.slug },
        });
        await tx.functionalRole.createMany({
          data: DEFAULT_FUNCTIONAL_ROLES.map((name, i) => ({ tenantId: tenant.id, name, sortOrder: i + 1 })),
        });
        const admin = await tx.user.create({
          data: {
            tenantId: tenant.id,
            email: input.adminEmail.toLowerCase(),
            name: input.adminName,
            passwordHash,
            mustChangePassword: actorId !== null,
            role: Role.TENANT_ADMIN,
          },
        });
        await this.audit.record(
          {
            tenantId: tenant.id,
            actorId,
            action: 'tenant.create',
            entity: 'Tenant',
            entityId: tenant.id,
            after: { slug: tenant.slug, name: tenant.name },
          },
          tx,
        );
        await this.audit.record(
          {
            tenantId: tenant.id,
            actorId,
            action: 'user.create',
            entity: 'User',
            entityId: admin.id,
            after: { email: admin.email, role: admin.role },
          },
          tx,
        );
        return { tenant, adminId: admin.id };
      });
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        throw new ConflictException('Tenant slug already exists');
      }
      throw e;
    }
  }

  list() {
    return this.prisma.tenant.findMany({ orderBy: { createdAt: 'desc' } });
  }

  async setActive(id: string, active: boolean, actorId: string) {
    const existing = await this.prisma.tenant.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Tenant not found');
    return this.prisma.txn(async (tx) => {
      const tenant = await tx.tenant.update({ where: { id }, data: { active } });
      await this.audit.record(
        {
          tenantId: id,
          actorId,
          action: 'tenant.update',
          entity: 'Tenant',
          entityId: id,
          before: { active: existing.active },
          after: { active },
        },
        tx,
      );
      return tenant;
    });
  }
}
