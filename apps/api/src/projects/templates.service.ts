import { ConflictException, Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { AuditService } from '../audit/audit.service.js';
import { requireTenantId } from '../common/auth.types.js';
import type { AuthUser } from '../common/auth.types.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreatePhaseTemplateDto } from './dto.js';

/** 未选择模板时使用的轨道交通典型阶段 */
export const DEFAULT_PHASES = [
  { name: '投标', checklist: ['投标文件已评审', '风险与机会已评估', '报价已批准'], mandatoryRoles: ['PROJECT_MANAGER'] },
  { name: '设计与开发', checklist: ['设计输入已确认', '设计评审已完成', '设计输出已受控'], mandatoryRoles: ['PROJECT_MANAGER', 'PROJECT_QUALITY_MANAGER'] },
  { name: '采购', checklist: ['供方已评价', '采购合同已签订'], mandatoryRoles: ['PROJECT_MANAGER', 'FUNCTION_MANAGER'] },
  { name: '制造', checklist: ['首件检验已通过', '过程控制计划已执行'], mandatoryRoles: ['PROJECT_MANAGER', 'PROJECT_QUALITY_MANAGER'] },
  { name: '调试与验证', checklist: ['型式试验已完成', '调试记录已归档'], mandatoryRoles: ['PROJECT_MANAGER', 'PROJECT_QUALITY_MANAGER'] },
  { name: '交付', checklist: ['客户验收点已确认', '交付文件已移交'], mandatoryRoles: ['PROJECT_MANAGER', 'PROJECT_QUALITY_MANAGER'] },
  { name: '质保期', checklist: ['质保期问题已关闭', '经验教训已登记'], mandatoryRoles: ['PROJECT_MANAGER'] },
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
