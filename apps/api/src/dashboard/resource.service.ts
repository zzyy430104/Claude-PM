import { Injectable } from '@nestjs/common';
import { ProjectStatus, Role, WpStatus } from '../generated/prisma/enums.js';
import { requireTenantId } from '../common/auth.types.js';
import type { AuthUser } from '../common/auth.types.js';
import { CalendarService } from '../projects/calendar.service.js';
import { WbsService } from '../projects/wbs.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

const DAY = 86_400_000;
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);

/**
 * 资源负荷（8.1.3.4 b）：按人汇总所有进行中项目的工作包人天，按周分布，与每周可用工作日对比。
 * 工作包的人天均匀摊到它计划期内的每个工作日；没填人天的按“负责人全职投入”（人天 = 工期）计算。
 */
@Injectable()
export class ResourceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly wbs: WbsService,
    private readonly calendars: CalendarService,
  ) {}

  async load(actor: AuthUser, fromIso: string, weeks: number) {
    const tenantId = requireTenantId(actor);
    const seesAll = actor.role === Role.TENANT_ADMIN || actor.role === Role.TOP_MANAGEMENT;
    const projects = await this.prisma.project.findMany({
      where: {
        tenantId, status: { in: [ProjectStatus.PLANNING, ProjectStatus.ACTIVE] },
        ...(seesAll ? {} : { members: { some: { userId: actor.id, active: true } } }),
      },
      select: { id: true, code: true },
    });
    const cal = await this.calendars.forTenant(tenantId);
    // 起始周一
    const start = Date.parse(`${fromIso}T00:00:00Z`);
    const monday = start - (((new Date(start).getUTCDay() || 7) - 1) * DAY);
    const weekStarts = Array.from({ length: weeks }, (_, i) => monday + i * 7 * DAY);
    const end = monday + weeks * 7 * DAY;
    const capacity = weekStarts.map((w) => Array.from({ length: 7 }, (_, d) => w + d * DAY).filter((t) => cal.isWorking(t)).length);

    const people = new Map<string, { load: number[]; items: { project: string; code: string; name: string; days: number }[] }>();
    for (const p of projects) {
      const { items } = await this.wbs.get(actor, p.id);
      for (const w of items) {
        if (!w.isLeaf || !w.ownerId || w.isMilestone || w.status === WpStatus.DONE || w.status === WpStatus.VERIFIED) continue;
        const s = Date.parse(`${w.scheduledStart}T00:00:00Z`);
        const e = Date.parse(`${w.scheduledEnd}T00:00:00Z`);
        if (e < monday || s >= end) continue;
        const workdays: number[] = [];
        for (let t = s; t <= e; t += DAY) if (cal.isWorking(t)) workdays.push(t);
        if (!workdays.length) continue;
        const total = w.resourceDays !== null ? Number(w.resourceDays) : w.durationDays;
        const remaining = total * (1 - w.percentComplete / 100);
        const perDay = remaining / workdays.length;
        const person = people.get(w.ownerId) ?? { load: weekStarts.map(() => 0), items: [] };
        let inWindow = 0;
        for (const t of workdays) {
          const k = Math.floor((t - monday) / (7 * DAY));
          if (k >= 0 && k < weeks) { person.load[k] += perDay; inWindow += perDay; }
        }
        if (inWindow > 0) person.items.push({ project: p.code, code: w.code, name: w.name, days: Math.round(inWindow * 10) / 10 });
        people.set(w.ownerId, person);
      }
    }
    const users = await this.prisma.user.findMany({ where: { tenantId, id: { in: [...people.keys()] } }, select: { id: true, name: true } });
    const nameOf = new Map(users.map((u) => [u.id, u.name]));
    return {
      weeks: weekStarts.map((w, i) => ({ start: iso(w), capacity: capacity[i] })),
      people: [...people.entries()]
        .map(([id, v]) => ({
          userId: id, name: nameOf.get(id) ?? '', load: v.load.map((x) => Math.round(x * 10) / 10),
          overloadedWeeks: v.load.filter((x, i) => x > capacity[i] + 0.05).length, items: v.items,
        }))
        .sort((a, b) => b.overloadedWeeks - a.overloadedWeeks || a.name.localeCompare(b.name)),
    };
  }
}
