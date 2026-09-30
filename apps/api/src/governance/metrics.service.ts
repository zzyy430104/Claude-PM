import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import type { Project } from '../generated/prisma/client.js';
import { computeSchedule } from '../projects/schedule.js';
import { CalendarService } from '../projects/calendar.service.js';

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
  constructor(private readonly prisma: PrismaService, private readonly calendars: CalendarService) {}

  async progress(ctx: { project: Project; tenantId: string }, today = new Date()): Promise<ProgressSnapshot> {
    const { project, tenantId } = ctx;
    const [wps, deps] = await Promise.all([
      this.prisma.workPackage.findMany({ where: { projectId: project.id, tenantId } }),
      this.prisma.wpDependency.findMany({ where: { projectId: project.id, tenantId } }),
    ]);
    const parents = new Set(wps.map((w) => w.parentId).filter(Boolean));
    const leaves = wps.filter((w) => !parents.has(w.id));
    const sched = computeSchedule(leaves.map((w) => ({ id: w.id, durationDays: w.durationDays })), deps);
    const by = new Map(sched.items.map((i) => [i.id, i]));
    // 按工作日计：今天是项目开始后的第几个工作日
    const cal = await this.calendars.forTenant(tenantId);
    const offset = cal.workdaysBetween(project.startDate, today);

    let planned = 0;
    let actual = 0;
    let total = 0;
    for (const w of leaves) {
      const s = by.get(w.id)!;
      const span = s.earlyFinish - s.earlyStart;
      const frac = span > 0 ? Math.min(Math.max((offset - s.earlyStart) / span, 0), 1) : offset >= s.earlyStart ? 1 : 0;
      planned += frac * w.durationDays;
      actual += (w.percentComplete / 100) * w.durationDays;
      total += w.durationDays;
    }
    const plannedPercent = total ? Math.round((planned / total) * 100) : 0;
    const actualPercent = total ? Math.round((actual / total) * 100) : 0;
    const projectedEnd = sched.projectDurationDays > 0 ? cal.dateAt(project.startDate, sched.projectDurationDays - 1) : iso(project.startDate);
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
