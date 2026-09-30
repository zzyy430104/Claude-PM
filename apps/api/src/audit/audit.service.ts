import { Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import type { AuthUser } from '../common/auth.types.js';
import { PrismaService } from '../prisma/prisma.service.js';

export interface AuditEntry {
  tenantId: string | null;
  actorId: string | null;
  action: string;
  entity: string;
  entityId: string;
  before?: Prisma.InputJsonValue;
  after?: Prisma.InputJsonValue;
}

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  /** 传入事务客户端，使业务变更与审计记录同事务提交 */
  record(entry: AuditEntry, tx: Prisma.TransactionClient = this.prisma) {
    return tx.auditLog.create({
      data: {
        tenantId: entry.tenantId,
        actorId: entry.actorId,
        action: entry.action,
        entity: entry.entity,
        entityId: entry.entityId,
        before: entry.before,
        after: entry.after,
      },
    });
  }

  /** 在事务里执行变更并同时写审计，变更与审计要么都成功要么都不生效 */
  tx<T>(
    actor: AuthUser,
    entry: {
      action: string;
      entity: string;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      entityId: (result: any) => string;
      before?: Prisma.InputJsonValue;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      after?: (result: any) => Prisma.InputJsonValue | undefined;
    },
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      const result = await fn(tx);
      await this.record(
        {
          tenantId: actor.tenantId,
          actorId: actor.id,
          action: entry.action,
          entity: entry.entity,
          entityId: entry.entityId(result),
          before: entry.before,
          after: entry.after?.(result),
        },
        tx,
      );
      return result;
    });
  }

  async list(
    tenantId: string,
    q: { entity?: string; entityId?: string; take: number; cursor?: string },
  ) {
    const rows = await this.prisma.auditLog.findMany({
      where: { tenantId, entity: q.entity, entityId: q.entityId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: q.take,
      ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
    });
    const actorIds = [...new Set(rows.map((r) => r.actorId).filter(Boolean))] as string[];
    const users = await this.prisma.user.findMany({
      where: { id: { in: actorIds }, tenantId },
      select: { id: true, name: true },
    });
    const names = new Map(users.map((u) => [u.id, u.name]));
    return rows.map((r) => ({
      ...r,
      actorName: r.actorId ? (names.get(r.actorId) ?? null) : null,
    }));
  }
}
