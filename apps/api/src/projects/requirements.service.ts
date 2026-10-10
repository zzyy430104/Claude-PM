import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthUser } from '../common/auth.types.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ProjectAccess, ProjectCtx } from './access.service.js';
import { ChangeGuard } from './change-guard.service.js';
import { CreateRequirementDto, UpdateRequirementDto } from './dto.js';
import { BadRequestException } from '@nestjs/common';

/**
 * 项目需求（8.1.3.1.1 a、8.1.3.3 a）。
 * 计划批准后，新增或删除需求属于范围变化，须引用已批准的范围变更；修改验证状态等不受限。
 */
@Injectable()
export class RequirementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: ProjectAccess,
    private readonly guard: ChangeGuard,
  ) {}

  async list(actor: AuthUser, projectId: string) {
    const ctx = await this.access.load(actor, projectId);
    return this.prisma.requirement.findMany({ where: { projectId, tenantId: ctx.tenantId }, orderBy: { code: 'asc' } });
  }

  async create(actor: AuthUser, projectId: string, dto: CreateRequirementDto) {
    const ctx = await this.access.load(actor, projectId);
    this.access.requireCan(ctx, 'REQUIREMENTS');
    this.access.requireOpen(ctx);
    await this.guard.assertAllowed(ctx, dto.changeRequestId);
    await this.checkDeliverable(ctx, dto.deliverableId);
    const { changeRequestId: _cr, ...data } = dto;
    try {
      return await this.audit.tx(
        actor,
        { action: 'requirement.create', entity: 'Requirement', entityId: (r) => r.id, after: (r) => ({ code: r.code, title: r.title }) },
        (tx) => tx.requirement.create({ data: { ...data, tenantId: ctx.tenantId, projectId } }),
      );
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new ConflictException('Requirement code already exists in this project');
      throw e;
    }
  }

  async update(actor: AuthUser, projectId: string, id: string, dto: UpdateRequirementDto) {
    const ctx = await this.access.load(actor, projectId);
    this.access.requireCan(ctx, 'REQUIREMENTS');
    this.access.requireOpen(ctx);
    const r = await this.find(ctx, id);
    await this.checkDeliverable(ctx, dto.deliverableId ?? undefined);
    return this.audit.tx(
      actor,
      {
        action: 'requirement.update', entity: 'Requirement', entityId: () => id,
        before: { status: r.status, deliverableId: r.deliverableId }, after: (x) => ({ status: x.status, deliverableId: x.deliverableId }),
      },
      (tx) => tx.requirement.update({ where: { id }, data: dto }),
    );
  }

  async remove(actor: AuthUser, projectId: string, id: string, changeRequestId?: string) {
    const ctx = await this.access.load(actor, projectId);
    this.access.requireCan(ctx, 'REQUIREMENTS');
    this.access.requireOpen(ctx);
    await this.guard.assertAllowed(ctx, changeRequestId);
    const r = await this.find(ctx, id);
    await this.audit.tx(
      actor,
      { action: 'requirement.delete', entity: 'Requirement', entityId: () => id, before: { code: r.code, title: r.title } },
      (tx) => tx.requirement.delete({ where: { id } }),
    );
  }

  private async find(ctx: ProjectCtx, id: string) {
    const r = await this.prisma.requirement.findFirst({ where: { id, projectId: ctx.project.id, tenantId: ctx.tenantId } });
    if (!r) throw new NotFoundException('Requirement not found');
    return r;
  }

  private async checkDeliverable(ctx: ProjectCtx, deliverableId?: string | null) {
    if (!deliverableId) return;
    const d = await this.prisma.deliverable.findFirst({ where: { id: deliverableId, projectId: ctx.project.id, tenantId: ctx.tenantId } });
    if (!d) throw new BadRequestException('Deliverable not found in this project');
  }
}
