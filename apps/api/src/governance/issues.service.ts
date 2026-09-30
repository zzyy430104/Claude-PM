import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { IssueStatus } from '../generated/prisma/enums.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthUser } from '../common/auth.types.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ProjectAccess } from '../projects/access.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { CreateIssueDto, UpdateIssueDto } from './dto.js';

export interface NewIssue {
  kind: 'ISSUE' | 'ACTION';
  title: string;
  description?: string;
  ownerId?: string;
  dueDate?: string;
  source: string;
  gateReviewId?: string;
  projectReviewId?: string;
  riskId?: string;
  phaseId?: string;
}

@Injectable()
export class IssuesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: ProjectAccess,
    private readonly notifications: NotificationsService,
  ) {}

  async list(actor: AuthUser, projectId: string, status?: IssueStatus) {
    const ctx = await this.access.load(actor, projectId);
    return this.prisma.issue.findMany({
      where: { projectId, tenantId: ctx.tenantId, ...(status ? { status } : {}) },
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    });
  }

  async create(actor: AuthUser, projectId: string, dto: CreateIssueDto) {
    const ctx = await this.access.load(actor, projectId);
    this.access.requireOpen(ctx);
    if (!ctx.member && !ctx.isManager) throw new ForbiddenException('Project members only');
    await this.checkOwner(ctx.tenantId, projectId, dto.ownerId);
    const created = await this.audit.tx(
      actor,
      { action: 'issue.create', entity: 'Issue', entityId: (i) => i.id, after: (i) => ({ title: i.title, kind: i.kind }) },
      (tx) => this.insert(tx, ctx.tenantId, projectId, actor.id, { ...dto, kind: dto.kind ?? 'ISSUE', source: 'MANUAL' }),
    );
    await this.notifications.notify(ctx.tenantId, [dto.ownerId], { kind: 'ISSUE_ASSIGNED', title: `${created.kind === 'ISSUE' ? '问题' : '行动项'}已分配给你：${created.title}`, body: ctx.project.code, link: `/projects/${projectId}` }, actor.id);
    return created;
  }

  async update(actor: AuthUser, projectId: string, id: string, dto: UpdateIssueDto) {
    const ctx = await this.access.load(actor, projectId);
    this.access.requireOpen(ctx);
    const issue = await this.prisma.issue.findFirst({ where: { id, projectId, tenantId: ctx.tenantId } });
    if (!issue) throw new NotFoundException('Issue not found');
    if (!ctx.isManager && !ctx.isQuality && issue.ownerId !== actor.id) {
      throw new ForbiddenException('Only the owner or project management can update this issue');
    }
    if (issue.status === IssueStatus.CLOSED) throw new ConflictException('Issue is closed');
    await this.checkOwner(ctx.tenantId, projectId, dto.ownerId);
    const closing = dto.status === IssueStatus.CLOSED;
    if (closing && !dto.closureNote?.trim()) throw new BadRequestException('closureNote is required to close an issue');
    return this.audit.tx(
      actor,
      {
        action: closing ? 'issue.close' : 'issue.update',
        entity: 'Issue',
        entityId: () => id,
        before: { status: issue.status, ownerId: issue.ownerId },
        after: (i) => ({ status: i.status, ownerId: i.ownerId }),
      },
      (tx) =>
        tx.issue.update({
          where: { id },
          data: {
            title: dto.title,
            ownerId: dto.ownerId,
            dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined,
            ...(closing ? { status: IssueStatus.CLOSED, closedAt: new Date(), closedById: actor.id, closureNote: dto.closureNote } : {}),
          },
        }),
    );
  }

  /** 供评审、风险等模块在同一事务内创建问题 / 行动项 */
  insert(tx: Prisma.TransactionClient, tenantId: string, projectId: string, createdById: string, i: NewIssue) {
    return tx.issue.create({
      data: {
        tenantId,
        projectId,
        kind: i.kind,
        title: i.title,
        description: i.description,
        ownerId: i.ownerId,
        dueDate: i.dueDate ? new Date(i.dueDate) : undefined,
        source: i.source,
        gateReviewId: i.gateReviewId,
        projectReviewId: i.projectReviewId,
        riskId: i.riskId,
        phaseId: i.phaseId,
        createdById,
      },
    });
  }

  async checkOwner(tenantId: string, projectId: string, ownerId?: string) {
    if (!ownerId) return;
    const m = await this.prisma.projectMember.findFirst({ where: { projectId, tenantId, userId: ownerId, active: true } });
    if (!m) throw new BadRequestException('Owner must be an active project member');
  }
}
