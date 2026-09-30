import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import type { ProjectCtx } from '../projects/access.service.js';
import { computeSchedule } from '../projects/schedule.js';

const DAY = 86_400_000;
const iso = (d: Date) => d.toISOString().slice(0, 10);

export interface ProgressSnapshot {
  plannedPercent: number;
  actualPercent: number;
  /** 实际减计划，负数表示落后 */
  varianceDays: number;
  projectedEnd: string;
  exceedsPlannedEnd: boolean;
  plannedEnd: string;
  leafCount: number;
}

/** 进度指标：计划进度按 CPM 排程和今天推算，实际进度按工期加权的完成百分比 */
@Injectable()
export class MetricsService {
  constructor(private readonly prisma: PrismaService) {}

  async progress(ctx: ProjectCtx, today = new Date()): Promise<ProgressSnapshot> {
    const { project, tenantId } = ctx;
    const [wps, deps] = await Promise.all([
      this.prisma.workPackage.findMany({ where: { projectId: project.id, tenantId } }),
      this.prisma.wpDependency.findMany({ where: { projectId: project.id, tenantId } }),
    ]);
    const parents = new Set(wps.map((w) => w.parentId).filter(Boolean));
    const leaves = wps.filter((w) => !parents.has(w.id));
    const sched = computeSchedule(leaves.map((w) => ({ id: w.id, durationDays: w.durationDays })), deps);
    const by = new Map(sched.items.map((i) => [i.id, i]));
    const offset = Math.floor((today.getTime() - project.startDate.getTime()) / DAY);

    let planned = 0;
    let actual = 0;
    let total = 0;
    for (const w of leaves) {
      const s = by.get(w.id)!;
      const span = Math.max(s.earlyFinish - s.earlyStart, 1);
      const frac = Math.min(Math.max((offset - s.earlyStart) / span, 0), 1);
      planned += frac * w.durationDays;
      actual += (w.percentComplete / 100) * w.durationDays;
      total += w.durationDays;
    }
    const plannedPercent = total ? Math.round((planned / total) * 100) : 0;
    const actualPercent = total ? Math.round((actual / total) * 100) : 0;
    const projectedEnd = iso(new Date(project.startDate.getTime() + sched.projectDurationDays * DAY));
    return {
      plannedPercent,
      actualPercent,
      varianceDays: total ? Math.round(((actual - planned) / total) * sched.projectDurationDays) : 0,
      projectedEnd,
      exceedsPlannedEnd: !!leaves.length && projectedEnd > iso(project.endDate),
      plannedEnd: iso(project.endDate),
      leafCount: leaves.length,
    };
  }
}
