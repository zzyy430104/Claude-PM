import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { CommentEntity } from '../generated/prisma/enums.js';
import { requireTenantId } from '../common/auth.types.js';
import type { AuthUser } from '../common/auth.types.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ProjectAccess } from '../projects/access.service.js';
import { CommentDto } from './dto.js';

const LINK: Record<CommentEntity, string> = {
  WORK_PACKAGE: 'g=plan&s=wbs', RISK: 'g=ctrl&s=risks', CHANGE: 'g=ctrl&s=changes', NONCONFORMITY: 'g=qual&s=quality', DELIVERABLE: 'g=exec&s=deliverables',
};

/**
 * 讨论（第 4 步）：项目成员在工作包、风险、变更、不符合项、交付物上讨论，可以 @ 项目成员。
 * 被 @ 的人收到“提到了你”的通知；对象的负责人和此前参与讨论的人收到新回复通知。
 */
@Injectable()
export class CommentsService {
  constructor(private readonly prisma: PrismaService, private readonly access: ProjectAccess, private readonly notifications: NotificationsService) {}

  /** 讨论对象：须属于本项目；返回名称和负责人 */
  private async entity(projectId: string, type: CommentEntity, id: string): Promise<{ label: string; ownerId: string | null }> {
    const p = { id, projectId };
    switch (type) {
      case CommentEntity.WORK_PACKAGE: { const x = await this.prisma.workPackage.findFirst({ where: p }); if (x) return { label: `工作包 ${x.code} ${x.name}`, ownerId: x.ownerId }; break; }
      case CommentEntity.RISK: { const x = await this.prisma.risk.findFirst({ where: p }); if (x) return { label: `风险 ${x.title}`, ownerId: x.ownerId }; break; }
      case CommentEntity.CHANGE: { const x = await this.prisma.changeRequest.findFirst({ where: p }); if (x) return { label: `变更 ${x.code} ${x.title}`, ownerId: x.requestedById }; break; }
      case CommentEntity.NONCONFORMITY: { const x = await this.prisma.nonconformity.findFirst({ where: p }); if (x) return { label: `不符合项 ${x.code} ${x.title}`, ownerId: x.actionOwnerId }; break; }
      case CommentEntity.DELIVERABLE: { const x = await this.prisma.deliverable.findFirst({ where: p }); if (x) return { label: `交付物 ${x.name}`, ownerId: null }; break; }
    }
    throw new NotFoundException('Discussion target not found in this project');
  }

  async list(actor: AuthUser, projectId: string, type: CommentEntity, entityId: string) {
    const ctx = await this.access.load(actor, projectId);
    const rows = await this.prisma.comment.findMany({ where: { tenantId: ctx.tenantId, projectId, entityType: type, entityId }, orderBy: { createdAt: 'asc' } });
    const users = await this.prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.authorId))] } }, select: { id: true, name: true } });
    return rows.map((r) => ({
      id: r.id, body: r.deletedAt ? '' : r.body, deleted: !!r.deletedAt, createdAt: r.createdAt, authorId: r.authorId,
      author: users.find((u) => u.id === r.authorId)?.name ?? '—', mine: r.authorId === actor.id,
    }));
  }

  /** 各对象的讨论条数（列表上显示） */
  async counts(actor: AuthUser, projectId: string, type: CommentEntity) {
    const ctx = await this.access.load(actor, projectId);
    const g = await this.prisma.comment.groupBy({ by: ['entityId'], where: { tenantId: ctx.tenantId, projectId, entityType: type, deletedAt: null }, _count: true });
    return Object.fromEntries(g.map((x) => [x.entityId, x._count]));
  }

  async create(actor: AuthUser, projectId: string, dto: CommentDto) {
    const ctx = await this.access.load(actor, projectId);
    this.access.requireOpen(ctx);
    if (!ctx.member && !ctx.isManager) throw new ForbiddenException('Project members only');
    const target = await this.entity(projectId, dto.entityType, dto.entityId);
    const members = (await this.prisma.projectMember.findMany({ where: { projectId, active: true }, select: { userId: true } })).map((m) => m.userId);
    const mentions = [...new Set(dto.mentions ?? [])];
    if (mentions.some((m) => !members.includes(m))) throw new BadRequestException('Only project members can be mentioned');
    const c = await this.prisma.comment.create({ data: { tenantId: ctx.tenantId, projectId, entityType: dto.entityType, entityId: dto.entityId, authorId: actor.id, body: dto.body.trim(), mentions } });
    const link = `/projects/${projectId}?${LINK[dto.entityType]}`;
    const snippet = dto.body.trim().slice(0, 80);
    await this.notifications.notify(ctx.tenantId, mentions, { kind: 'MENTION', title: `${actor.name ?? ''} 在${target.label}中提到了你`, body: snippet, link }, actor.id);
    const earlier = (await this.prisma.comment.findMany({ where: { projectId, entityType: dto.entityType, entityId: dto.entityId, id: { not: c.id } }, select: { authorId: true } })).map((x) => x.authorId);
    const others = [...new Set([target.ownerId, ...earlier])].filter((u): u is string => !!u && !mentions.includes(u));
    await this.notifications.notify(ctx.tenantId, others, { kind: 'COMMENT', title: `${target.label} 有新讨论`, body: snippet, link }, actor.id);
    return c;
  }

  async remove(actor: AuthUser, projectId: string, id: string) {
    const ctx = await this.access.load(actor, projectId);
    const c = await this.prisma.comment.findFirst({ where: { id, projectId, tenantId: ctx.tenantId } });
    if (!c) throw new NotFoundException('Comment not found');
    if (c.authorId !== actor.id && !ctx.isManager) throw new ForbiddenException('Only the author or the project manager can delete');
    await this.prisma.comment.update({ where: { id }, data: { deletedAt: new Date() } });
    return { ok: true };
  }

  /** 最近 30 天 @ 我的讨论（工作台用） */
  async mentions(actor: AuthUser) {
    const tenantId = requireTenantId(actor);
    const since = new Date(Date.now() - 30 * 86_400_000);
    const rows = await this.prisma.comment.findMany({ where: { tenantId, deletedAt: null, createdAt: { gte: since }, mentions: { array_contains: [actor.id] } }, orderBy: { createdAt: 'desc' }, take: 30 });
    const [users, projects] = await Promise.all([
      this.prisma.user.findMany({ where: { id: { in: rows.map((r) => r.authorId) } }, select: { id: true, name: true } }),
      this.prisma.project.findMany({ where: { id: { in: rows.map((r) => r.projectId) } }, select: { id: true, code: true } }),
    ]);
    return rows.map((r) => ({
      id: r.id, body: r.body.slice(0, 120), createdAt: r.createdAt, author: users.find((u) => u.id === r.authorId)?.name ?? '—',
      project: projects.find((p) => p.id === r.projectId)?.code ?? '', entityType: r.entityType, link: `/projects/${r.projectId}?${LINK[r.entityType]}`,
    }));
  }
}
