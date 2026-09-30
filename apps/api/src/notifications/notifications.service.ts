import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { requireTenantId } from '../common/auth.types.js';
import type { AuthUser } from '../common/auth.types.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { EmailService } from './email.service.js';

export interface NotifyInput {
  kind: string;
  title: string;
  body?: string;
  /** 前端路由，如 /projects/xxx */
  link?: string;
}

/** 站内通知，同时按需发邮件。通知失败不能影响业务操作，所以这里吞掉异常只记日志。 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
  ) {}

  async notify(tenantId: string, userIds: (string | null | undefined)[], input: NotifyInput, exceptUserId?: string) {
    try {
      const ids = [...new Set(userIds.filter((u): u is string => !!u && u !== exceptUserId))];
      if (ids.length === 0) return;
      const users = await this.prisma.user.findMany({ where: { id: { in: ids }, tenantId, active: true }, select: { id: true, email: true } });
      if (users.length === 0) return;
      await this.prisma.notification.createMany({
        data: users.map((u) => ({ tenantId, userId: u.id, kind: input.kind, title: input.title, body: input.body ?? '', link: input.link })),
      });
      if (this.email.enabled) {
        const base = process.env.APP_URL ?? '';
        for (const u of users) {
          void this.email.send({ to: u.email, subject: `[Claude-PM] ${input.title}`, text: `${input.title}\n\n${input.body ?? ''}\n\n${input.link ? base + input.link : ''}`.trim() });
        }
      }
    } catch (e) {
      this.logger.warn(`notify failed: ${(e as Error).message}`);
    }
  }

  /** 通知项目内某类人员：CCB 成员、项目经理等 */
  async projectUsers(tenantId: string, projectId: string, where: { isCcb?: boolean; projectRole?: string } = {}): Promise<string[]> {
    const ms = await this.prisma.projectMember.findMany({ where: { tenantId, projectId, active: true, ...(where as object) }, select: { userId: true } });
    return ms.map((m) => m.userId);
  }

  async tenantUsersWithRole(tenantId: string, role: string): Promise<string[]> {
    const us = await this.prisma.user.findMany({ where: { tenantId, active: true, role: role as never }, select: { id: true } });
    return us.map((u) => u.id);
  }

  list(actor: AuthUser, unreadOnly: boolean) {
    return this.prisma.notification.findMany({
      where: { tenantId: requireTenantId(actor), userId: actor.id, ...(unreadOnly ? { readAt: null } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  async unreadCount(actor: AuthUser) {
    return { count: await this.prisma.notification.count({ where: { tenantId: requireTenantId(actor), userId: actor.id, readAt: null } }) };
  }

  async markRead(actor: AuthUser, id: string) {
    const r = await this.prisma.notification.updateMany({ where: { id, tenantId: requireTenantId(actor), userId: actor.id, readAt: null }, data: { readAt: new Date() } });
    if (r.count === 0) {
      const exists = await this.prisma.notification.findFirst({ where: { id, tenantId: requireTenantId(actor), userId: actor.id } });
      if (!exists) throw new NotFoundException('Notification not found');
    }
  }

  async markAllRead(actor: AuthUser) {
    await this.prisma.notification.updateMany({ where: { tenantId: requireTenantId(actor), userId: actor.id, readAt: null }, data: { readAt: new Date() } });
  }
}
