import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { WpStatus } from '../generated/prisma/enums.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthUser } from '../common/auth.types.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ProjectAccess, ProjectCtx } from './access.service.js';
import { ChangeGuard } from './change-guard.service.js';
import { AddDependencyDto, CreateWpDto, UpdateWpDto } from './dto.js';
import { computeSchedule, CycleError, topoOrder } from './schedule.js';
import { CalendarService } from './calendar.service.js';

const iso = (d: Date) => d.toISOString().slice(0, 10);

@Injectable()
export class WbsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: ProjectAccess,
    private readonly guard: ChangeGuard,
    private readonly calendars: CalendarService,
  ) {}

  /** WBS 树、依赖、按 CPM 计算的排程；父节点的日期由子节点汇总 */
  async get(actor: AuthUser, projectId: string) {
    const ctx = await this.access.load(actor, projectId);
    const [wps, deps] = await Promise.all([
      this.prisma.workPackage.findMany({
        where: { projectId, tenantId: ctx.tenantId },
        orderBy: { code: 'asc' },
      }),
      this.prisma.wpDependency.findMany({ where: { projectId, tenantId: ctx.tenantId } }),
    ]);
    const parents = new Set(wps.map((w) => w.parentId).filter(Boolean));
    const leaves = wps.filter((w) => !parents.has(w.id));
    const sched = computeSchedule(
      leaves.map((w) => ({ id: w.id, durationDays: w.durationDays })),
      deps,
    );
    const byId = new Map(sched.items.map((i) => [i.id, i]));

    // 父节点汇总：最早开始、最晚结束、关键路径标记
    const range = new Map<string, { es: number; ef: number; critical: boolean }>();
    const rollUp = (id: string): { es: number; ef: number; critical: boolean } => {
      const cached = range.get(id);
      if (cached) return cached;
      const kids = wps.filter((w) => w.parentId === id);
      let r: { es: number; ef: number; critical: boolean };
      if (kids.length === 0) {
        const s = byId.get(id)!;
        r = { es: s.earlyStart, ef: s.earlyFinish, critical: s.critical };
      } else {
        const rs = kids.map((k) => rollUp(k.id));
        r = {
          es: Math.min(...rs.map((x) => x.es)),
          ef: Math.max(...rs.map((x) => x.ef)),
          critical: rs.some((x) => x.critical),
        };
      }
      range.set(id, r);
      return r;
    };

    // 排程以工作日计算，再按企业工作日历换成日期；甘特图用的偏移量是自然日，便于与批准计划的日期对比
    const start = ctx.project.startDate;
    const cal = await this.calendars.forTenant(ctx.tenantId);
    const origin = Date.parse(iso(start));
    const calOffset = (d: string) => Math.round((Date.parse(d) - origin) / 86_400_000);
    const items = wps.map((w) => {
      const r = rollUp(w.id);
      const s = byId.get(w.id);
      const span = cal.span(start, r.es, r.ef);
      return {
        ...w,
        isLeaf: !parents.has(w.id),
        scheduledStart: span.start,
        scheduledEnd: span.end,
        startOffsetDays: calOffset(span.start),
        endOffsetDays: calOffset(span.end) + (w.isMilestone ? 0 : 1),
        critical: r.critical,
        totalFloatDays: s?.totalFloat ?? null,
      };
    });
    const projectedEnd = sched.projectDurationDays > 0 ? cal.dateAt(start, sched.projectDurationDays - 1) : iso(start);
    return {
      items,
      dependencies: deps,
      projectDurationDays: sched.projectDurationDays,
      /** 甘特图横轴长度（自然日） */
      calendarDays: items.length ? Math.max(...items.map((i) => i.endOffsetDays), 1) : 0,
      projectedEnd,
      exceedsPlannedEnd: projectedEnd > iso(ctx.project.endDate),
    };
  }

  async create(actor: AuthUser, projectId: string, dto: CreateWpDto) {
    const ctx = await this.access.load(actor, projectId);
    this.access.requireManager(ctx);
    this.access.requireOpen(ctx);
    await this.guard.assertAllowed(ctx, dto.changeRequestId);

    if (dto.parentId) {
      const parent = await this.prisma.workPackage.findFirst({
        where: { id: dto.parentId, projectId, tenantId: ctx.tenantId },
      });
      if (!parent) throw new BadRequestException('Parent work package not found');
      const depCount = await this.prisma.wpDependency.count({
        where: { OR: [{ predecessorId: parent.id }, { successorId: parent.id }] },
      });
      if (depCount > 0) {
        throw new ConflictException('Parent has dependencies: move them to leaf work packages first');
      }
    }
    await this.checkRefs(ctx, dto.phaseId, dto.ownerId, dto);
    const durationDays = dto.isMilestone ? 0 : dto.durationDays;
    if (durationDays < 1 && !dto.isMilestone) throw new BadRequestException('durationDays must be at least 1 (use a milestone for zero duration)');
    try {
      return await this.audit.tx(
        actor,
        {
          action: 'workPackage.create',
          entity: 'WorkPackage',
          entityId: (w) => w.id,
          after: (w) => ({ code: w.code, name: w.name, durationDays: w.durationDays }),
        },
        (tx) =>
          tx.workPackage.create({
            data: {
              tenantId: ctx.tenantId,
              projectId,
              code: dto.code,
              name: dto.name,
              description: dto.description,
              parentId: dto.parentId,
              phaseId: dto.phaseId,
              ownerId: dto.ownerId,
              durationDays,
              isMilestone: dto.isMilestone ?? false,
              budget: dto.budget,
              costAccountId: dto.costAccountId,
              deliverableId: dto.deliverableId,
              resourceDays: dto.resourceDays,
              externalProvider: dto.externalProvider?.trim() || null,
              longLead: dto.longLead ?? false,
            },
          }),
      );
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('Work package code already exists in this project');
      }
      throw e;
    }
  }

  async update(actor: AuthUser, projectId: string, id: string, dto: UpdateWpDto) {
    const ctx = await this.access.load(actor, projectId);
    this.access.requireOpen(ctx);
    const wp = await this.findWp(ctx, id);
    const isOwner = wp.ownerId === actor.id;
    if (!ctx.isManager && !isOwner) throw new ForbiddenException('Manager or owner required');
    if (wp.status === WpStatus.VERIFIED) throw new ConflictException('Verified work package is locked');
    if (dto.status === WpStatus.VERIFIED) {
      throw new BadRequestException('Use the verify endpoint to verify a work package');
    }
    // 负责人只能更新进度，结构与分配由项目经理管理
    const managerOnly = dto.name !== undefined || dto.description !== undefined ||
      dto.ownerId !== undefined || dto.phaseId !== undefined ||
      dto.durationDays !== undefined || dto.budget !== undefined ||
      dto.costAccountId !== undefined || dto.deliverableId !== undefined || dto.resourceDays !== undefined ||
      dto.externalProvider !== undefined || dto.longLead !== undefined || dto.isMilestone !== undefined;
    if (managerOnly && !ctx.isManager) throw new ForbiddenException('Project manager required');
    await this.checkRefs(ctx, dto.phaseId ?? undefined, dto.ownerId, dto);
    const milestone = dto.isMilestone ?? wp.isMilestone;
    const durationDays = milestone ? 0 : dto.durationDays ?? (wp.isMilestone ? 1 : undefined);
    if (!milestone && durationDays !== undefined && durationDays < 1) throw new BadRequestException('durationDays must be at least 1');

    const status =
      dto.status ??
      (dto.percentComplete === 100 ? WpStatus.DONE
        : dto.percentComplete && dto.percentComplete > 0 && wp.status === WpStatus.NOT_STARTED
          ? WpStatus.IN_PROGRESS
          : undefined);

    return this.audit.tx(
      actor,
      {
        action: 'workPackage.update',
        entity: 'WorkPackage',
        entityId: () => id,
        before: { status: wp.status, percentComplete: wp.percentComplete, durationDays: wp.durationDays, ownerId: wp.ownerId },
        after: (w) => ({ status: w.status, percentComplete: w.percentComplete, durationDays: w.durationDays, ownerId: w.ownerId }),
      },
      (tx) =>
        tx.workPackage.update({
          where: { id },
          data: {
            name: dto.name,
            description: dto.description,
            ownerId: dto.ownerId,
            phaseId: dto.phaseId,
            durationDays,
            isMilestone: dto.isMilestone,
            budget: dto.budget,
            costAccountId: dto.costAccountId,
            deliverableId: dto.deliverableId,
            resourceDays: dto.resourceDays,
            externalProvider: dto.externalProvider === undefined ? undefined : dto.externalProvider?.trim() || null,
            longLead: dto.longLead,
            percentComplete: dto.percentComplete,
            status,
            actualStart: dto.actualStart ? new Date(dto.actualStart) : undefined,
            actualEnd: dto.actualEnd ? new Date(dto.actualEnd) : undefined,
          },
        }),
    );
  }

  /** 工作包核验：核验人不能是负责人本人 */
  async verify(actor: AuthUser, projectId: string, id: string) {
    const ctx = await this.access.load(actor, projectId);
    this.access.requireOpen(ctx);
    this.access.requireManagerOrQuality(ctx);
    const wp = await this.findWp(ctx, id);
    if (wp.status !== WpStatus.DONE) throw new ConflictException('Only completed work packages can be verified');
    if (wp.ownerId === actor.id) throw new ForbiddenException('Owner cannot verify own work package');
    return this.audit.tx(
      actor,
      { action: 'workPackage.verify', entity: 'WorkPackage', entityId: () => id },
      (tx) =>
        tx.workPackage.update({
          where: { id },
          data: { status: WpStatus.VERIFIED, verifiedById: actor.id, verifiedAt: new Date() },
        }),
    );
  }

  async remove(actor: AuthUser, projectId: string, id: string, changeRequestId?: string) {
    const ctx = await this.access.load(actor, projectId);
    this.access.requireManager(ctx);
    this.access.requireOpen(ctx);
    await this.guard.assertAllowed(ctx, changeRequestId);
    const wp = await this.findWp(ctx, id);
    const kids = await this.prisma.workPackage.count({ where: { parentId: id } });
    if (kids > 0) throw new ConflictException('Remove child work packages first');
    await this.audit.tx(
      actor,
      {
        action: 'workPackage.delete',
        entity: 'WorkPackage',
        entityId: () => id,
        before: { code: wp.code, name: wp.name, durationDays: wp.durationDays },
      },
      async (tx) => {
        await tx.wpDependency.deleteMany({ where: { OR: [{ predecessorId: id }, { successorId: id }] } });
        await tx.workPackage.delete({ where: { id } });
      },
    );
  }

  async addDependency(actor: AuthUser, projectId: string, dto: AddDependencyDto) {
    const ctx = await this.access.load(actor, projectId);
    this.access.requireManager(ctx);
    this.access.requireOpen(ctx);
    if (dto.predecessorId === dto.successorId) throw new BadRequestException('A work package cannot depend on itself');
    const [a, b] = await Promise.all([
      this.findWp(ctx, dto.predecessorId),
      this.findWp(ctx, dto.successorId),
    ]);
    for (const w of [a, b]) {
      const kids = await this.prisma.workPackage.count({ where: { parentId: w.id } });
      if (kids > 0) throw new BadRequestException('Dependencies can only link leaf work packages');
    }
    const existing = await this.prisma.wpDependency.findMany({
      where: { projectId, tenantId: ctx.tenantId },
    });
    const all = await this.prisma.workPackage.findMany({
      where: { projectId, tenantId: ctx.tenantId },
      select: { id: true },
    });
    try {
      topoOrder(all.map((w) => w.id), [...existing, { predecessorId: a.id, successorId: b.id }]);
    } catch (e) {
      if (e instanceof CycleError) throw new BadRequestException('Dependency would create a cycle');
      throw e;
    }
    try {
      return await this.audit.tx(
        actor,
        {
          action: 'wpDependency.add',
          entity: 'WpDependency',
          entityId: (d) => d.id,
          after: () => ({ predecessor: a.code, successor: b.code }),
        },
        (tx) =>
          tx.wpDependency.create({
            data: { tenantId: ctx.tenantId, projectId, predecessorId: a.id, successorId: b.id },
          }),
      );
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('Dependency already exists');
      }
      throw e;
    }
  }

  async removeDependency(actor: AuthUser, projectId: string, depId: string) {
    const ctx = await this.access.load(actor, projectId);
    this.access.requireManager(ctx);
    this.access.requireOpen(ctx);
    const dep = await this.prisma.wpDependency.findFirst({
      where: { id: depId, projectId, tenantId: ctx.tenantId },
    });
    if (!dep) throw new NotFoundException('Dependency not found');
    await this.audit.tx(
      actor,
      { action: 'wpDependency.remove', entity: 'WpDependency', entityId: () => depId },
      (tx) => tx.wpDependency.delete({ where: { id: depId } }),
    );
  }

  private async findWp(ctx: ProjectCtx, id: string) {
    const wp = await this.prisma.workPackage.findFirst({
      where: { id, projectId: ctx.project.id, tenantId: ctx.tenantId },
    });
    if (!wp) throw new NotFoundException('Work package not found');
    return wp;
  }

  private async checkRefs(
    ctx: ProjectCtx, phaseId?: string, ownerId?: string,
    refs: { costAccountId?: string | null; deliverableId?: string | null } = {},
  ) {
    const where = { projectId: ctx.project.id, tenantId: ctx.tenantId };
    if (refs.costAccountId && !(await this.prisma.costAccount.findFirst({ where: { id: refs.costAccountId, ...where } }))) {
      throw new BadRequestException('Cost account not found in this project');
    }
    if (refs.deliverableId && !(await this.prisma.deliverable.findFirst({ where: { id: refs.deliverableId, ...where } }))) {
      throw new BadRequestException('Deliverable not found in this project');
    }
    if (phaseId) {
      const ph = await this.prisma.phase.findFirst({
        where: { id: phaseId, projectId: ctx.project.id, tenantId: ctx.tenantId },
      });
      if (!ph) throw new BadRequestException('Phase not found in this project');
    }
    if (ownerId) {
      const m = await this.prisma.projectMember.findFirst({
        where: { projectId: ctx.project.id, userId: ownerId, active: true, tenantId: ctx.tenantId },
      });
      if (!m) throw new BadRequestException('Owner must be an active project member');
    }
  }
}
