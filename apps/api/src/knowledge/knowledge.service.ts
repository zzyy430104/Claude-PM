import { BadRequestException, ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import { IssueStatus, PhaseStatus, ProjectStatus } from '../generated/prisma/enums.js';
import { AuditService } from '../audit/audit.service.js';
import { requireTenantId } from '../common/auth.types.js';
import type { AuthUser } from '../common/auth.types.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ProjectAccess } from '../projects/access.service.js';
import { CloseProjectDto, CreateLessonDto } from './knowledge.dto.js';

/** 经验教训库（7.1.6、8.1.3.1.2 c）与项目关闭 */
@Injectable()
export class KnowledgeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: ProjectAccess,
  ) {}

  /** 企业知识库：本企业所有项目的经验教训，任何企业内用户可查（用于投标和新项目策划） */
  async search(actor: AuthUser, q?: string) {
    const tenantId = requireTenantId(actor);
    const lessons = await this.prisma.lesson.findMany({
      where: {
        tenantId,
        ...(q ? { OR: [{ title: { contains: q, mode: 'insensitive' } }, { description: { contains: q, mode: 'insensitive' } }, { recommendation: { contains: q, mode: 'insensitive' } }] } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    const projects = await this.prisma.project.findMany({ where: { id: { in: [...new Set(lessons.map((l) => l.projectId))] }, tenantId }, select: { id: true, code: true, name: true } });
    const byId = new Map(projects.map((p) => [p.id, p]));
    return lessons.map((l) => ({ ...l, project: byId.get(l.projectId) ?? null }));
  }

  async listForProject(actor: AuthUser, projectId: string) {
    const ctx = await this.access.load(actor, projectId);
    return this.prisma.lesson.findMany({ where: { projectId, tenantId: ctx.tenantId }, orderBy: { createdAt: 'desc' } });
  }

  async create(actor: AuthUser, projectId: string, dto: CreateLessonDto) {
    const ctx = await this.access.load(actor, projectId);
    if (ctx.project.status === ProjectStatus.CANCELLED) throw new ForbiddenException('Project is cancelled');
    if (!ctx.member && !ctx.isManager) throw new ForbiddenException('Project members only');
    if (dto.phaseId && !(await this.prisma.phase.findFirst({ where: { id: dto.phaseId, projectId, tenantId: ctx.tenantId } }))) {
      throw new BadRequestException('Phase not found in this project');
    }
    return this.audit.tx(
      actor,
      { action: 'lesson.create', entity: 'Lesson', entityId: (l) => l.id, after: (l) => ({ kind: l.kind, title: l.title }) },
      (tx) => tx.lesson.create({ data: { ...dto, tenantId: ctx.tenantId, projectId, createdById: actor.id } }),
    );
  }

  /** 关闭项目：所有阶段已关闭，无未关闭问题和不符合项，已登记经验教训 */
  async close(actor: AuthUser, projectId: string, dto: CloseProjectDto) {
    const ctx = await this.access.load(actor, projectId);
    this.access.requireManager(ctx);
    if (ctx.project.status === ProjectStatus.CLOSED) throw new ConflictException('Project is already closed');
    if (ctx.project.status !== ProjectStatus.ACTIVE) throw new ConflictException('Only active projects can be closed');
    const [openPhases, openIssues, openNc, lessons] = await Promise.all([
      this.prisma.phase.count({ where: { projectId, tenantId: ctx.tenantId, status: { not: PhaseStatus.CLOSED } } }),
      this.prisma.issue.count({ where: { projectId, tenantId: ctx.tenantId, status: IssueStatus.OPEN } }),
      this.prisma.nonconformity.count({ where: { projectId, tenantId: ctx.tenantId, status: { not: 'CLOSED' } } }),
      this.prisma.lesson.count({ where: { projectId, tenantId: ctx.tenantId } }),
    ]);
    const blockers: string[] = [];
    if (openPhases) blockers.push(`还有 ${openPhases} 个阶段未关闭`);
    if (openIssues) blockers.push(`还有 ${openIssues} 个未关闭的问题 / 行动项`);
    if (openNc) blockers.push(`还有 ${openNc} 个未关闭的不符合项`);
    if (!lessons && !dto.noLessonsReason) blockers.push('尚未登记经验教训（如确无，请说明原因）');
    if (ctx.project.initiationId) {
      const h = await this.prisma.handover.findUnique({ where: { projectId } });
      if (h?.status !== 'CONFIRMED') blockers.push('售后交接尚未完成（接收人确认后才能关闭项目）');
    }
    if (blockers.length) throw new ConflictException({ code: 'PROJECT_CLOSE_BLOCKED', message: blockers.join('；'), blockers });
    return this.audit.tx(
      actor,
      { action: 'project.close', entity: 'Project', entityId: () => projectId, after: () => ({ lessons, noLessonsReason: dto.noLessonsReason ?? null }) },
      (tx) => tx.project.update({ where: { id: projectId }, data: { status: ProjectStatus.CLOSED } }),
    );
  }
}
