import { describe, expect, it } from 'vitest';
import { WorkCalendar } from './calendar.js';

describe('工作日历', () => {
  const cal = new WorkCalendar({ workWeek: [1, 2, 3, 4, 5], holidays: ['2026-10-01', '2026-10-02'], extraWorkdays: ['2026-10-10'] });

  it('跳过周末和节假日，调休的周六算工作日', () => {
    expect(cal.dateAt('2026-09-26', 0)).toBe('2026-09-28'); // 周六开始 → 顺延到周一
    expect(cal.dateAt('2026-09-28', 3)).toBe('2026-10-05'); // 9-28、9-29、9-30 为 0..2，10-1/2 放假和周末跳过
    expect(cal.dateAt('2026-10-09', 1)).toBe('2026-10-10'); // 周六调休上班
  });

  it('工作包起止：结束日为最后一个工作日；里程碑起止同一天', () => {
    expect(cal.span('2026-01-05', 0, 10)).toEqual({ start: '2026-01-05', end: '2026-01-16' });
    expect(cal.span('2026-01-05', 10, 10)).toEqual({ start: '2026-01-19', end: '2026-01-19' });
  });

  it('区间内工作日数', () => {
    expect(cal.workdaysBetween('2026-01-05', '2026-01-19')).toBe(10);
    expect(cal.workdaysBetween('2026-01-19', '2026-01-05')).toBe(-10);
  });
});
