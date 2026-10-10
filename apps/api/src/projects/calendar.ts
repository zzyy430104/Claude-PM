/**
 * 工作日历：企业设定每周哪几天上班、法定节假日和调休上班日，工期按工作日计算。
 * 约定：偏移量 0 = 项目开始日当天或之后的第一个工作日；工作包的结束日期是最后一个工作日（含当天）。
 */
export interface CalendarSettings {
  /** 1 = 周一 … 7 = 周日 */
  workWeek: number[];
  /** 放假日（YYYY-MM-DD） */
  holidays: string[];
  /** 调休上班的周末（YYYY-MM-DD） */
  extraWorkdays: string[];
}

export const DEFAULT_CALENDAR: CalendarSettings = { workWeek: [1, 2, 3, 4, 5], holidays: [], extraWorkdays: [] };

const DAY = 86_400_000;
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
const utc = (d: Date | string) => {
  const s = typeof d === 'string' ? d : d.toISOString().slice(0, 10);
  return Date.parse(`${s}T00:00:00Z`);
};

export class WorkCalendar {
  private readonly week: Set<number>;
  // 节假日和调休按“自 1970-01-01 起的天数”存，判断工作日时不用每天生成日期字符串（排程、挣值要逐日循环，很热）
  private readonly off: Set<number>;
  private readonly on: Set<number>;

  constructor(s: CalendarSettings = DEFAULT_CALENDAR) {
    this.week = new Set(s.workWeek.length ? s.workWeek : DEFAULT_CALENDAR.workWeek);
    this.off = new Set(s.holidays.map((d) => utc(d) / DAY));
    this.on = new Set(s.extraWorkdays.map((d) => utc(d) / DAY));
  }

  private workDay(d: number): boolean {
    if (this.on.has(d)) return true;
    if (this.off.has(d)) return false;
    return this.week.has((((d + 3) % 7) + 7) % 7 + 1); // 1970-01-01 是周四
  }

  isWorking(t: number): boolean {
    return this.workDay(Math.floor(t / DAY));
  }

  /** 从 start 起第 offset 个工作日（offset 0 为 start 当天或之后第一个工作日） */
  dateAt(start: Date | string, offset: number): string {
    let d = utc(start) / DAY;
    let guard = 0;
    while (!this.workDay(d) && guard++ < 3660) d++;
    for (let n = 0; n < offset && guard < 20000; guard++) {
      d++;
      if (this.workDay(d)) n++;
    }
    return iso(d * DAY);
  }

  /** 工作包的计划起止：开始 = 第 es 个工作日；结束 = 最后一个工作日（里程碑工期为 0，起止同一天） */
  span(start: Date | string, es: number, ef: number): { start: string; end: string } {
    return { start: this.dateAt(start, es), end: this.dateAt(start, Math.max(ef - 1, es)) };
  }

  /** [from, to) 之间的工作日数；to 早于 from 时为负数 */
  workdaysBetween(from: Date | string, to: Date | string): number {
    const a = utc(from) / DAY;
    const b = utc(to) / DAY;
    const sign = b >= a ? 1 : -1;
    let n = 0;
    for (let d = Math.min(a, b); d < Math.max(a, b); d++) if (this.workDay(d)) n++;
    return sign * n;
  }
}
