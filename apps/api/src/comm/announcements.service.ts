import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Role } from '../generated/prisma/enums.js';
import { AuditService } from '../audit/audit.service.js';
import { requireTenantId } from '../common/auth.types.js';
import type { AuthUser } from '../common/auth.types.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ProjectAccess, type ProjectCtx } from '../projects/access.service.js';
import { AnnouncementDto } from './dto.js';

const isMgmt = (u: AuthUser) => u.role === Role.TOP_MANAGEMENT || u.role === Role.TENANT_ADMIN;

/**
 * 公告（第 4 步）：只有项目经理和管理层可以发布；发给全项目组或指定人员，可要求已读确认并提醒未读人员。
 * 接收人只看到发给自己的公告；项目经理和管理层看到全部及已读情况。
 */
@Injectable()
export class AnnouncementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: ProjectAccess,
    private readonly notifications: NotificationsService,
  ) {}

  private canPublish(ctx: ProjectCtx) { return ctx.isManager || isMgmt(ctx.actor); }

  async list(actor: AuthUser, projectId: string) {
    const ctx = await this.access.load(actor, projectId);
    const all = this.canPublish(ctx);
    const rows = await this.prisma.announcement.findMany({ where: { projectId, tenantId: ctx.tenantId }, include: { reads: true }, orderBy: { createdAt: 'desc' } });
    const visible = rows.filter((a) => all || (a.recipients as string[]).includes(actor.id) || a.authorId === actor.id);
    const ids = [...new Set(visible.flatMap((a) => [a.authorId, ...(a.recipients as string[])]))];
    const users = await this.prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
    const name = (id: string) => users.find((u) => u.id === id)?.name ?? '—';
    return {
      canPublish: this.canPublish(ctx) && ctx.project.status !== 'CLOSED',
      items: visible.map((a) => {
        const rec = a.recipients as string[];
        const read = a.reads.map((r) => r.userId);
        return {
          id: a.id, title: a.title, body: a.body, author: name(a.authorId), createdAt: a.createdAt, requireRead: a.requireRead, remindedAt: a.remindedAt,
          readByMe: read.includes(actor.id), forMe: rec.includes(actor.id),
          ...(all || a.authorId === actor.id ? { read: rec.filter((u) => read.includes(u)).map(name), unread: rec.filter((u) => !read.includes(u)).map(name) } : {}),
          total: rec.length, readCount: rec.filter((u) => read.includes(u)).length,
        };
      }),
    };
  }

  async create(actor: AuthUser, projectId: string, dto: AnnouncementDto) {
    const ctx = await this.access.load(actor, projectId);
    this.access.requireOpen(ctx);
    if (!this.canPublish(ctx)) throw new ForbiddenException('Only the project manager or management can publish announcements');
    const members = (await this.prisma.projectMember.findMany({ where: { projectId, active: true }, select: { userId: true } })).map((m) => m.userId);
    const recipients = dto.recipients?.length ? [...new Set(dto.recipients)] : members;
    if (recipients.some((r) => !members.includes(r))) throw new BadRequestException('Recipients must be project members');
    const a = await this.audit.tx(actor, { action: 'announcement.create', entity: 'Announcement', entityId: (x) => x.id, after: (x) => ({ title: x.title, recipients: recipients.length, requireRead: x.requireRead }) },
      (tx) => tx.announcement.create({ data: { tenantId: ctx.tenantId, projectId, title: dto.title.trim(), body: dto.body.trim(), authorId: actor.id, requireRead: dto.requireRead ?? false, recipients } }));
    // 发布人自己算已读
    if (recipients.includes(actor.id)) await this.prisma.announcementRead.create({ data: { tenantId: ctx.tenantId, announcementId: a.id, userId: actor.id } });
    await this.notifications.notify(ctx.tenantId, recipients, {
      kind: 'ANNOUNCEMENT', title: `公告：${a.title}`, body: `${ctx.project.code}${a.requireRead ? ' · 请阅读后确认' : ''}`, link: `/projects/${projectId}?g=comm&s=announcements`,
    }, actor.id);
    return a;
  }

  async markRead(actor: AuthUser, projectId: string, id: string) {
    const ctx = await this.access.load(actor, projectId);
    const a = await this.prisma.announcement.findFirst({ where: { id, projectId, tenantId: ctx.tenantId } });
    if (!a) throw new NotFoundException('Announcement not found');
    if (!(a.recipients as string[]).includes(actor.id)) throw new ForbiddenException('Not a recipient');
    await this.prisma.announcementRead.createMany({ data: [{ tenantId: ctx.tenantId, announcementId: id, userId: actor.id }], skipDuplicates: true });
    return { ok: true };
  }

  async remind(actor: AuthUser, projectId: string, id: string) {
    const ctx = await this.access.load(actor, projectId);
    if (!this.canPublish(ctx)) throw new ForbiddenException('Only the project manager or management can remind');
    const a = await this.prisma.announcement.findFirst({ where: { id, projectId, tenantId: ctx.tenantId }, include: { reads: true } });
    if (!a) throw new NotFoundException('Announcement not found');
    if (!a.requireRead) throw new ConflictException('This announcement does not require confirmation');
    const unread = (a.recipients as string[]).filter((u) => !a.reads.some((r) => r.userId === u));
    await this.notifications.notify(ctx.tenantId, unread, { kind: 'ANNOUNCEMENT', title: `请阅读并确认公告：${a.title}`, body: ctx.project.code, link: `/projects/${projectId}?g=comm&s=announcements` }, actor.id);
    await this.prisma.announcement.update({ where: { id }, data: { remindedAt: new Date() } });
    return { reminded: unread.length };
  }

  /** 发给我、要求确认但我还没读的公告（工作台用） */
  async unreadForMe(actor: AuthUser) {
    const tenantId = requireTenantId(actor);
    const rows = await this.prisma.announcement.findMany({ where: { tenantId, requireRead: true, recipients: { array_contains: [actor.id] }, reads: { none: { userId: actor.id } } }, orderBy: { createdAt: 'desc' }, take: 50 });
    const projects = await this.prisma.project.findMany({ where: { id: { in: rows.map((r) => r.projectId) } }, select: { id: true, code: true, name: true } });
    return rows.map((r) => ({ id: r.id, title: r.title, createdAt: r.createdAt, project: projects.find((p) => p.id === r.projectId) }));
  }
}
