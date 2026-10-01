import { ConflictException, Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { AuditService } from '../audit/audit.service.js';
import { requireTenantId } from '../common/auth.types.js';
import type { AuthUser } from '../common/auth.types.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreatePhaseTemplateDto } from './dto.js';

/** 未选择模板时使用的轨道交通典型阶段 */
export const DEFAULT_PHASES = [
  { name: '项目策划', checklist: ['项目要求已分解为需求清单', '计划已批准', '风险与机会已识别'], mandatoryRoles: ['PROJECT_MANAGER', 'TOP_MANAGEMENT'] },
  { name: '技术准备', checklist: ['客户图纸与技术文件已评审', 'PFMEA 与控制计划已完成', '工艺文件与工装检具已就绪'], mandatoryRoles: ['PROJECT_MANAGER', 'PROJECT_QUALITY_MANAGER'] },
  { name: 'FAI 首件鉴定', checklist: ['首件检验已完成', 'FAI 报告已出具', '遗留问题已关闭或已有计划'], mandatoryRoles: ['PROJECT_MANAGER', 'PROJECT_QUALITY_MANAGER'] },
  { name: '量产', checklist: ['采购计划已批准', '长周期物料已下单', '批量生产与出厂检验已完成'], mandatoryRoles: ['PROJECT_MANAGER', 'PROJECT_QUALITY_MANAGER'] },
  { name: '交付', checklist: ['交付文件已准备', '客户已验收'], mandatoryRoles: ['PROJECT_MANAGER', 'PROJECT_QUALITY_MANAGER'] },
  { name: '项目总结', checklist: ['项目要求达成情况已评价', '经验教训已登记', '售后交接已完成'], mandatoryRoles: ['PROJECT_MANAGER'] },
] as const;

@Injectable()
export class TemplatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  list(actor: AuthUser) {
    return this.prisma.phaseTemplate.findMany({
      where: { tenantId: requireTenantId(actor), active: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  async create(actor: AuthUser, dto: CreatePhaseTemplateDto) {
    const tenantId = requireTenantId(actor);
    try {
      return await this.audit.tx(
        actor,
        {
          action: 'phaseTemplate.create',
          entity: 'PhaseTemplate',
          entityId: (t) => t.id,
          after: (t) => ({ name: t.name, phases: dto.phases.length }),
        },
        (tx) =>
          tx.phaseTemplate.create({
            data: {
              tenantId,
              name: dto.name,
              phases: dto.phases as unknown as Prisma.InputJsonValue,
            },
          }),
      );
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('Template name already exists');
      }
      throw e;
    }
  }

  async deactivate(actor: AuthUser, id: string) {
    const tenantId = requireTenantId(actor);
    const existing = await this.prisma.phaseTemplate.findFirst({ where: { id, tenantId } });
    if (!existing) return;
    await this.audit.tx(
      actor,
      { action: 'phaseTemplate.deactivate', entity: 'PhaseTemplate', entityId: () => id },
      (tx) => tx.phaseTemplate.update({ where: { id }, data: { active: false } }),
    );
  }
}
