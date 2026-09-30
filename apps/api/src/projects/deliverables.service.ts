import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import type { AuthUser } from '../common/auth.types.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ProjectAccess } from './access.service.js';
import { CreateDeliverableDto, UpdateDeliverableDto } from './dto.js';

@Injectable()
export class DeliverablesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: ProjectAccess,
  ) {}

  async list(actor: AuthUser, projectId: string) {
    const ctx = await this.access.load(actor, projectId);
    return this.prisma.deliverable.findMany({
      where: { projectId, tenantId: ctx.tenantId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async create(actor: AuthUser, projectId: string, dto: CreateDeliverableDto) {
    const ctx = await this.access.load(actor, projectId);
    this.access.requireManagerOrQuality(ctx);
    this.access.requireOpen(ctx);
    if (dto.phaseId) {
      const ph = await this.prisma.phase.findFirst({
        where: { id: dto.phaseId, projectId, tenantId: ctx.tenantId },
      });
      if (!ph) throw new BadRequestException('Phase not found in this project');
    }
    return this.audit.tx(
      actor,
      {
        action: 'deliverable.create',
        entity: 'Deliverable',
        entityId: (d) => d.id,
        after: (d) => ({ name: d.name, kind: d.kind }),
      },
      (tx) =>
        tx.deliverable.create({
          data: {
            tenantId: ctx.tenantId,
            projectId,
            phaseId: dto.phaseId,
            name: dto.name,
            kind: dto.kind,
            supplier: dto.supplier,
            dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined,
            notes: dto.notes,
          },
        }),
    );
  }

  async update(actor: AuthUser, projectId: string, id: string, dto: UpdateDeliverableDto) {
    const ctx = await this.access.load(actor, projectId);
    this.access.requireManagerOrQuality(ctx);
    this.access.requireOpen(ctx);
    const d = await this.prisma.deliverable.findFirst({
      where: { id, projectId, tenantId: ctx.tenantId },
    });
    if (!d) throw new NotFoundException('Deliverable not found');
    return this.audit.tx(
      actor,
      {
        action: 'deliverable.update',
        entity: 'Deliverable',
        entityId: () => id,
        before: { status: d.status },
        after: (x) => ({ status: x.status }),
      },
      (tx) =>
        tx.deliverable.update({
          where: { id },
          data: {
            name: dto.name,
            status: dto.status,
            supplier: dto.supplier,
            dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined,
            notes: dto.notes,
          },
        }),
    );
  }
}
