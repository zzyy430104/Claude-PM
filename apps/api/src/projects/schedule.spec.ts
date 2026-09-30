import { computeSchedule, CycleError, topoOrder } from './schedule.js';

const n = (id: string, durationDays: number) => ({ id, durationDays });
const e = (predecessorId: string, successorId: string) => ({ predecessorId, successorId });

describe('computeSchedule', () => {
  it('没有节点时返回空结果', () => {
    expect(computeSchedule([], [])).toEqual({ items: [], projectDurationDays: 0 });
  });

  it('串行任务：总工期为工期之和，全部在关键路径上', () => {
    const r = computeSchedule([n('a', 3), n('b', 2)], [e('a', 'b')]);
    expect(r.projectDurationDays).toBe(5);
    expect(r.items.every((i) => i.critical)).toBe(true);
    expect(r.items.find((i) => i.id === 'b')).toMatchObject({ earlyStart: 3, earlyFinish: 5 });
  });

  it('并行分支：较长分支为关键路径，较短分支有浮动时间', () => {
    //   a(2) → b(5) → d(1)
    //   a(2) → c(2) → d(1)
    const r = computeSchedule(
      [n('a', 2), n('b', 5), n('c', 2), n('d', 1)],
      [e('a', 'b'), e('a', 'c'), e('b', 'd'), e('c', 'd')],
    );
    const by = Object.fromEntries(r.items.map((i) => [i.id, i]));
    expect(r.projectDurationDays).toBe(8);
    expect(by.b.critical).toBe(true);
    expect(by.c.critical).toBe(false);
    expect(by.c.totalFloat).toBe(3);
    expect(by.d.earlyStart).toBe(7);
  });

  it('没有依赖的任务从第 0 天开始', () => {
    const r = computeSchedule([n('a', 4), n('b', 1)], []);
    expect(r.items.map((i) => i.earlyStart)).toEqual([0, 0]);
    expect(r.projectDurationDays).toBe(4);
    expect(r.items.find((i) => i.id === 'b')!.totalFloat).toBe(3);
  });

  it('有环时抛出 CycleError', () => {
    expect(() => topoOrder(['a', 'b'], [e('a', 'b'), e('b', 'a')])).toThrow(CycleError);
  });
});
