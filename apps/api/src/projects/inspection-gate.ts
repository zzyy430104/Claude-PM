import { InspectionResult, NcStatus } from '../generated/prisma/enums.js';
import type { PrismaService } from '../prisma/prisma.service.js';

/** 工作包核验前的质量把关：检验项全部有结果、没有不合格、关联的不符合项都已关闭 */
export const InspectionGate = {
  async check(prisma: PrismaService, wpId: string): Promise<string[]> {
    const [items, ncs] = await Promise.all([
      prisma.inspectionItem.findMany({ where: { workPackageId: wpId }, select: { name: true, result: true } }),
      prisma.nonconformity.findMany({ where: { workPackageId: wpId, status: { not: NcStatus.CLOSED } }, select: { code: true } }),
    ]);
    const out: string[] = [];
    const pending = items.filter((i) => i.result === InspectionResult.PENDING);
    const failed = items.filter((i) => i.result === InspectionResult.FAIL);
    if (pending.length) out.push(`还有 ${pending.length} 个检验项没有结果（${pending.slice(0, 3).map((i) => i.name).join('、')}）`);
    if (failed.length) out.push(`有 ${failed.length} 个检验项不合格（${failed.slice(0, 3).map((i) => i.name).join('、')}）`);
    if (ncs.length) out.push(`关联的不符合项未关闭：${ncs.map((n) => n.code).join('、')}`);
    return out;
  },
};
