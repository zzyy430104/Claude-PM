/** 关键路径法（CPM）：只处理叶子工作包，依赖关系为“完成-开始”，工期单位为天 */
export interface ScheduleNode {
  id: string;
  durationDays: number;
}

export interface ScheduleEdge {
  predecessorId: string;
  successorId: string;
}

export interface ScheduleResult {
  id: string;
  /** 距项目开始日的天数 */
  earlyStart: number;
  earlyFinish: number;
  lateStart: number;
  lateFinish: number;
  totalFloat: number;
  critical: boolean;
}

export class CycleError extends Error {
  constructor() {
    super('Dependency cycle detected');
  }
}

/** 拓扑排序；有环则抛出 CycleError */
export function topoOrder(ids: string[], edges: ScheduleEdge[]): string[] {
  const indeg = new Map(ids.map((id) => [id, 0]));
  const next = new Map<string, string[]>(ids.map((id) => [id, []]));
  for (const e of edges) {
    if (!indeg.has(e.predecessorId) || !indeg.has(e.successorId)) continue;
    indeg.set(e.successorId, indeg.get(e.successorId)! + 1);
    next.get(e.predecessorId)!.push(e.successorId);
  }
  const queue = ids.filter((id) => indeg.get(id) === 0);
  const order: string[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    order.push(id);
    for (const n of next.get(id)!) {
      indeg.set(n, indeg.get(n)! - 1);
      if (indeg.get(n) === 0) queue.push(n);
    }
  }
  if (order.length !== ids.length) throw new CycleError();
  return order;
}

export function computeSchedule(
  nodes: ScheduleNode[],
  edges: ScheduleEdge[],
): { items: ScheduleResult[]; projectDurationDays: number } {
  if (nodes.length === 0) return { items: [], projectDurationDays: 0 };
  const dur = new Map(nodes.map((n) => [n.id, n.durationDays]));
  const ids = nodes.map((n) => n.id);
  const order = topoOrder(ids, edges);
  const preds = new Map<string, string[]>(ids.map((id) => [id, []]));
  const succs = new Map<string, string[]>(ids.map((id) => [id, []]));
  for (const e of edges) {
    if (!dur.has(e.predecessorId) || !dur.has(e.successorId)) continue;
    preds.get(e.successorId)!.push(e.predecessorId);
    succs.get(e.predecessorId)!.push(e.successorId);
  }

  const es = new Map<string, number>();
  const ef = new Map<string, number>();
  for (const id of order) {
    const start = Math.max(0, ...preds.get(id)!.map((p) => ef.get(p)!));
    es.set(id, start);
    ef.set(id, start + dur.get(id)!);
  }
  const total = Math.max(...ef.values());

  const ls = new Map<string, number>();
  const lf = new Map<string, number>();
  for (const id of [...order].reverse()) {
    const finish = succs.get(id)!.length
      ? Math.min(...succs.get(id)!.map((s) => ls.get(s)!))
      : total;
    lf.set(id, finish);
    ls.set(id, finish - dur.get(id)!);
  }

  const items = ids.map((id) => {
    const slack = ls.get(id)! - es.get(id)!;
    return {
      id,
      earlyStart: es.get(id)!,
      earlyFinish: ef.get(id)!,
      lateStart: ls.get(id)!,
      lateFinish: lf.get(id)!,
      totalFloat: slack,
      critical: slack === 0,
    };
  });
  return { items, projectDurationDays: total };
}
