import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Project, ProjectMember } from '../generated/prisma/client.js';
import { ProjectRole, Role } from '../generated/prisma/enums.js';
import { requireTenantId } from '../common/auth.types.js';
import type { AuthUser } from '../common/auth.types.js';
import { PrismaService } from '../prisma/prisma.service.js';

export interface ProjectCtx {
  actor: AuthUser;
  tenantId: string;
  project: Project;
  member: ProjectMember | null;
  /** 项目经理，或企业管理员 */
  isManager: boolean;
  isQuality: boolean;
  isCcb: boolean;
  /** 最高管理层 */
  isTopManagement: boolean;
}

/** 项目访问控制：企业管理员和最高管理层可看全部项目，其余人只能看自己参与的项目 */
@Injectable()
export class ProjectAccess {
  constructor(private readonly prisma: PrismaService) {}

  async load(actor: AuthUser, projectId: string): Promise<ProjectCtx> {
    const tenantId = requireTenantId(actor);
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, tenantId },
    });
    if (!project) throw new NotFoundException('Project not found');
    const member = await this.prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId, userId: actor.id } },
    });
    const activeMember = member?.active ? member : null;
    const seesAll = actor.role === Role.TENANT_ADMIN || actor.role === Role.TOP_MANAGEMENT;
    if (!seesAll && !activeMember) {
      // 不暴露项目是否存在
      throw new NotFoundException('Project not found');
    }
    return {
      actor,
      tenantId,
      project,
      member: activeMember,
      isManager:
        actor.role === Role.TENANT_ADMIN ||
        activeMember?.projectRole === ProjectRole.PROJECT_MANAGER,
      isQuality:
        actor.role === Role.TENANT_ADMIN ||
        activeMember?.projectRole === ProjectRole.PROJECT_QUALITY_MANAGER,
      isCcb: !!activeMember?.isCcb,
      isTopManagement: actor.role === Role.TOP_MANAGEMENT,
    };
  }

  requireManager(ctx: ProjectCtx) {
    if (!ctx.isManager) throw new ForbiddenException('Project manager required');
  }

  requireManagerOrQuality(ctx: ProjectCtx) {
    if (!ctx.isManager && !ctx.isQuality) {
      throw new ForbiddenException('Project manager or quality manager required');
    }
  }

  /** 项目已关闭或取消后不再允许修改 */
  requireOpen(ctx: ProjectCtx) {
    if (ctx.project.status === 'CLOSED' || ctx.project.status === 'CANCELLED') {
      throw new ForbiddenException('Project is closed');
    }
  }
}
