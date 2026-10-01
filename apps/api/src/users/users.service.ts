import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { Role } from '../generated/prisma/enums.js';
import { AuditService } from '../audit/audit.service.js';
import { requireTenantId } from '../common/auth.types.js';
import type { AuthUser } from '../common/auth.types.js';
import { hashPassword } from '../common/password.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateUserDto, UpdateUserDto } from './dto.js';

const publicSelect = {
  id: true,
  email: true,
  name: true,
  role: true,
  functionalRoleId: true,
  active: true,
  mustChangePassword: true,
  createdAt: true,
} satisfies Prisma.UserSelect;

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  list(actor: AuthUser) {
    return this.prisma.user.findMany({
      where: { tenantId: requireTenantId(actor) },
      select: publicSelect,
      orderBy: { createdAt: 'asc' },
    });
  }

  /** 企业通讯录：任何租户内用户都可查询在职用户的姓名与邮箱，用于选人（如加入项目） */
  directory(actor: AuthUser) {
    return this.prisma.user.findMany({
      where: { tenantId: requireTenantId(actor), active: true },
      select: { id: true, name: true, email: true, role: true, functionalRoleId: true },
      orderBy: { name: 'asc' },
    });
  }

  async get(actor: AuthUser, id: string) {
    const user = await this.prisma.user.findFirst({
      where: { id, tenantId: requireTenantId(actor) },
      select: publicSelect,
    });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async create(actor: AuthUser, dto: CreateUserDto) {
    const tenantId = requireTenantId(actor);
    if (dto.role === Role.PLATFORM_ADMIN) {
      throw new BadRequestException('Role not allowed in a tenant');
    }
    await this.assertFunctionalRole(tenantId, dto.functionalRoleId);
    const passwordHash = await hashPassword(dto.password);
    try {
      return await this.prisma.txn(async (tx) => {
        const user = await tx.user.create({
          data: {
            tenantId,
            email: dto.email.toLowerCase(),
            name: dto.name,
            passwordHash,
            role: dto.role,
            functionalRoleId: dto.functionalRoleId ?? null,
            mustChangePassword: true,
          },
          select: publicSelect,
        });
        await this.audit.record(
          {
            tenantId,
            actorId: actor.id,
            action: 'user.create',
            entity: 'User',
            entityId: user.id,
            after: { email: user.email, role: user.role },
          },
          tx,
        );
        return user;
      });
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        throw new ConflictException('Email already exists in this tenant');
      }
      throw e;
    }
  }

  /** 职能角色必须属于本企业且在用 */
  private async assertFunctionalRole(tenantId: string, id: string | null | undefined) {
    if (!id) return;
    const r = await this.prisma.functionalRole.findFirst({ where: { id, tenantId, active: true } });
    if (!r) throw new BadRequestException('Functional role not found');
  }

  async update(actor: AuthUser, id: string, dto: UpdateUserDto) {
    const tenantId = requireTenantId(actor);
    if (dto.role === Role.PLATFORM_ADMIN) {
      throw new BadRequestException('Role not allowed in a tenant');
    }
    // 防止租户管理员把自己降级或停用而锁死租户
    if (
      id === actor.id &&
      ((dto.role && dto.role !== actor.role) || dto.active === false)
    ) {
      throw new BadRequestException('Cannot change own role or deactivate self');
    }
    const existing = await this.prisma.user.findFirst({
      where: { id, tenantId },
      select: publicSelect,
    });
    if (!existing) throw new NotFoundException('User not found');
    await this.assertFunctionalRole(tenantId, dto.functionalRoleId);

    const data: Prisma.UserUpdateInput = {
      name: dto.name,
      role: dto.role,
      active: dto.active,
      functionalRoleId: dto.functionalRoleId,
    };
    if (dto.password) {
      // 管理员重置别人的密码后，对方下次登录必须自己改掉
      data.passwordHash = await hashPassword(dto.password);
      data.mustChangePassword = id !== actor.id;
      data.passwordChangedAt = new Date();
    }

    return this.prisma.txn(async (tx) => {
      const user = await tx.user.update({
        where: { id },
        data,
        select: publicSelect,
      });
      if (dto.active === false || dto.password) {
        await tx.refreshToken.updateMany({
          where: { userId: id, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }
      await this.audit.record(
        {
          tenantId,
          actorId: actor.id,
          action: 'user.update',
          entity: 'User',
          entityId: id,
          before: {
            name: existing.name,
            role: existing.role,
            active: existing.active,
            functionalRoleId: existing.functionalRoleId,
          },
          after: {
            name: user.name,
            role: user.role,
            active: user.active,
            functionalRoleId: user.functionalRoleId,
            ...(dto.password ? { passwordReset: true } : {}),
          },
        },
        tx,
      );
      return user;
    });
  }
}
