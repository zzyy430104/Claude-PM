import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { withBypass } from '../prisma/tenant-context.js';
import { CalendarSettings, DEFAULT_CALENDAR, WorkCalendar } from './calendar.js';

/** 读取企业的工作日历设置 */
@Injectable()
export class CalendarService {
  constructor(private readonly prisma: PrismaService) {}

  async settings(tenantId: string): Promise<CalendarSettings> {
    const t = await withBypass(() =>
      this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { workWeek: true, holidays: true, extraWorkdays: true } }),
    );
    if (!t) return DEFAULT_CALENDAR;
    return {
      workWeek: t.workWeek?.length ? t.workWeek : DEFAULT_CALENDAR.workWeek,
      holidays: Array.isArray(t.holidays) ? (t.holidays as string[]) : [],
      extraWorkdays: Array.isArray(t.extraWorkdays) ? (t.extraWorkdays as string[]) : [],
    };
  }

  async forTenant(tenantId: string) {
    return new WorkCalendar(await this.settings(tenantId));
  }
}
