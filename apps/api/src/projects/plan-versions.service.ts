import { Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import type { AuthUser } from '../common/auth.types.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ProjectAccess } from './access.service.js';
import { WbsService } from './wbs.service.js';

export interface PlanSnapshot {
  project: { startDate: string; endDate: string; customerDeliveryDate: string | null; budget: string | null };
  workPackages: { id: string; code: string; name: string; start: string; end: string; durationDays: number; budget: string | null; isLeaf: boolean }[];
}

const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

/**
 * 计划批准版本：批准计划时保存第 1 版，之后每实施一次范围、进度、预算或交期变更就保存新一版。
 * 快照记录当时的项目日期、预算和每个工作包的计划日期与预算，是“计划与实际对比”的依据（8.1.3.11 a）。
 */
@Injectable()
export class PlanVersionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ProjectAccess,
    private readonly wbs: WbsService,
  ) {}

  /** tenantId 已知时（计划批准人不一定是项目成员）跳过项目权限检查，由调用方负责 */
  async capture(actor: AuthUser, projectId: string, note: string, changeRequestId?: string, tenantId?: string) {
    const ctx = tenantId
      ? { tenantId, project: await this.prisma.project.findFirstOrThrow({ where: { id: projectId, tenantId } }) }
      : await this.access.load(actor, projectId);
    const schedule = await this.wbs.scheduleOf(ctx.tenantId, ctx.project);
    const p = ctx.project;
    const snapshot: PlanSnapshot = {
      project: {
        startDate: day(p.startDate)!,
        endDate: day(p.endDate)!,
        customerDeliveryDate: day(p.customerDeliveryDate),
        budget: p.budget?.toString() ?? null,
      },
      workPackages: schedule.items.map((w) => ({
        id: w.id, code: w.code, name: w.name, start: w.scheduledStart, end: w.scheduledEnd,
        durationDays: w.durationDays, budget: w.budget?.toString() ?? null, isLeaf: w.isLeaf,
      })),
    };
    const last = await this.prisma.planVersion.findFirst({
      where: { projectId, tenantId: ctx.tenantId }, orderBy: { version: 'desc' }, select: { version: true },
    });
    return this.prisma.planVersion.create({
      data: {
        tenantId: ctx.tenantId, projectId, version: (last?.version ?? 0) + 1, changeRequestId, note,
        snapshot: snapshot as unknown as Prisma.InputJsonValue, createdById: actor.id,
      },
    });
  }

  async list(actor: AuthUser, projectId: string) {
    const ctx = await this.access.load(actor, projectId);
    return this.prisma.planVersion.findMany({ where: { projectId, tenantId: ctx.tenantId }, orderBy: { version: 'desc' } });
  }
}
