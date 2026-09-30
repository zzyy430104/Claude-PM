import { BadRequestException, Injectable } from '@nestjs/common';
import { IssueStatus, ProjectRole, RiskStatus, Role } from '../generated/prisma/enums.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthUser } from '../common/auth.types.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ProjectAccess } from '../projects/access.service.js';
import { CreateProjectReviewDto } from './dto.js';
import { IssuesService } from './issues.service.js';
import { MetricsService } from './metrics.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';

/** 定期项目评审（8.1.3.11）：对比计划与实际，跟踪此前遗留的问题，并上报更高层 */
@Injectable()
export class ReviewsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: ProjectAccess,
    private readonly issues: IssuesService,
    private readonly metrics: MetricsService,
    private readonly notifications: NotificationsService,
  ) {}

  async list(actor: AuthUser, projectId: string) {
    const ctx = await this.access.load(actor, projectId);
    return this.prisma.projectReview.findMany({
      where: { projectId, tenantId: ctx.tenantId },
      orderBy: { reviewDate: 'desc' },
    });
  }

  /** 评审准备材料：当前绩效、未关闭问题、风险 */
  async prepare(actor: AuthUser, projectId: string) {
    const ctx = await this.access.load(actor, projectId);
    return this.snapshot(ctx);
  }

  async create(actor: AuthUser, projectId: string, dto: CreateProjectReviewDto) {
    const ctx = await this.access.load(actor, projectId);
    this.access.requireManager(ctx);
    this.access.requireOpen(ctx);

    const attending = await this.prisma.projectMember.findMany({
      where: { projectId, tenantId: ctx.tenantId, active: true, userId: { in: dto.attendees } },
    });
    if (attending.length !== new Set(dto.attendees).size) {
      throw new BadRequestException('Attendees must be active project members');
    }
    // 核心团队（至少项目经理）必须出席
    if (!attending.some((m) => m.projectRole === ProjectRole.PROJECT_MANAGER)) {
      throw new BadRequestException('The project manager must attend the project review');
    }
    if (dto.reportedToId) {
      const top = await this.prisma.user.findFirst({
        where: { id: dto.reportedToId, tenantId: ctx.tenantId, active: true, role: { in: [Role.TOP_MANAGEMENT, Role.TENANT_ADMIN] } },
      });
      if (!top) throw new BadRequestException('reportedToId must be a management user in this tenant');
    }
    for (const a of dto.actions ?? []) await this.issues.checkOwner(ctx.tenantId, projectId, a.ownerId);

    const performance = await this.snapshot(ctx);
    const created = await this.audit.tx(
      actor,
      {
        action: 'projectReview.create',
        entity: 'ProjectReview',
        entityId: (r) => r.id,
        after: () => ({ reviewDate: dto.reviewDate, attendees: dto.attendees.length, actions: dto.actions?.length ?? 0 }),
      },
      async (tx) => {
        const review = await tx.projectReview.create({
          data: {
            tenantId: ctx.tenantId,
            projectId,
            reviewDate: new Date(dto.reviewDate),
            attendees: dto.attendees,
            performance: performance as never,
            notes: dto.notes,
            escalations: dto.escalations,
            reportedToId: dto.reportedToId,
            reportedAt: dto.reportedToId ? new Date() : undefined,
            createdById: actor.id,
          },
        });
        for (const a of dto.actions ?? []) {
          await this.issues.insert(tx, ctx.tenantId, projectId, actor.id, {
            kind: 'ACTION', title: a.title, ownerId: a.ownerId, dueDate: a.dueDate,
            source: 'PROJECT_REVIEW', projectReviewId: review.id,
          });
        }
        return review;
      },
    );
    for (const a of dto.actions ?? []) {
      await this.notifications.notify(ctx.tenantId, [a.ownerId], { kind: 'ACTION_ASSIGNED', title: `新行动项：${a.title}`, body: `${ctx.project.code} 项目评审`, link: `/projects/${projectId}` }, actor.id);
    }
    await this.notifications.notify(ctx.tenantId, [dto.reportedToId], { kind: 'REVIEW_REPORTED', title: `项目评审报告：${ctx.project.code} ${ctx.project.name}`, body: dto.escalations ?? '', link: `/projects/${projectId}` }, actor.id);
    return created;
  }

  private async snapshot(ctx: Awaited<ReturnType<ProjectAccess['load']>>) {
    const { project, tenantId } = ctx;
    const [progress, openIssues, openRisks] = await Promise.all([
      this.metrics.progress(ctx),
      this.prisma.issue.findMany({
        where: { projectId: project.id, tenantId, status: IssueStatus.OPEN },
        select: { id: true, kind: true, title: true, ownerId: true, dueDate: true, source: true },
      }),
      this.prisma.risk.findMany({
        where: { projectId: project.id, tenantId, status: { not: RiskStatus.CLOSED } },
        select: { id: true, kind: true, title: true, probability: true, impact: true, status: true },
      }),
    ]);
    const today = new Date().toISOString().slice(0, 10);
    return {
      progress,
      openIssues,
      overdueActions: openIssues.filter((i) => i.dueDate && i.dueDate.toISOString().slice(0, 10) < today).length,
      openRisks: openRisks.map((r) => ({ ...r, score: r.probability * r.impact })),
      budget: project.budget?.toString() ?? null,
    };
  }
}
