import { Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
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

  list(
    tenantId: string,
    q: { entity?: string; entityId?: string; take: number; cursor?: string },
  ) {
    return this.prisma.auditLog.findMany({
      where: { tenantId, entity: q.entity, entityId: q.entityId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: q.take,
      ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
    });
  }
}
