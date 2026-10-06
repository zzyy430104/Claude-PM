import { BadRequestException, ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import type { Handover, Prisma } from '../generated/prisma/client.js';
import { HandoverStatus, ProjectRole } from '../generated/prisma/enums.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthUser } from '../common/auth.types.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ProjectAccess } from '../projects/access.service.js';
import { ConfirmHandoverDto, HandoverDto } from './dto.js';

const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
export const DEFAULT_HANDOVER_DOCS = ['质量文件包', '图纸及版本清单', 'FAI 报告', '备件清单', '遗留问题清单', '客户联系人表'];

/**
 * 售后交接（第 3 步）：项目经理填写交接日期、接收人、质保期、移交文档和遗留问题，发起交接；
 * 系统用户由接收人在系统里确认，外部接收人由项目经理登记签字交接单后确认。经立项的项目关闭前须完成交接。
 */
@Injectable()
export class HandoverService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: ProjectAccess,
    private readonly notifications: NotificationsService,
  ) {}

  private async row(tenantId: string, projectId: string) {
    await this.prisma.handover.createMany({ data: [{ tenantId, projectId }], skipDuplicates: true });
    return this.prisma.handover.findUniqueOrThrow({ where: { projectId } });
  }
  private view(h: Handover, users: { id: string; name: string }[]) {
    return {
      ...h, date: day(h.date), warrantyFrom: day(h.warrantyFrom), warrantyTo: day(h.warrantyTo), documents: h.documents as string[],
      from: users.find((u) => u.id === h.fromId)?.name ?? null, receiver: users.find((u) => u.id === h.receiverId)?.name ?? null,
    };
  }

  /** 项目成员可看；接收人即使不是项目成员也能看到并确认 */
  async get(actor: AuthUser, projectId: string) {
    const h0 = await this.prisma.handover.findUnique({ where: { projectId } });
    const isReceiver = !!h0 && h0.receiverId === actor.id;
    const ctx = isReceiver ? null : await this.access.load(actor, projectId);
    const open = !!ctx && ctx.project.status !== 'CLOSED' && ctx.project.status !== 'CANCELLED';
    const h = h0 ?? (await this.row(ctx!.tenantId, projectId));
    const users = await this.prisma.user.findMany({ where: { id: { in: [h.fromId, h.receiverId, h.confirmedById].filter((x): x is string => !!x) } }, select: { id: true, name: true } });
    return {
      handover: this.view(h, users),
      defaultDocuments: DEFAULT_HANDOVER_DOCS,
      required: !!(ctx?.project ?? (await this.prisma.project.findUnique({ where: { id: projectId } })))?.initiationId,
      can: {
        edit: !!ctx?.perms.HANDOVER && h.status === HandoverStatus.DRAFT && open,
        submit: !!ctx?.perms.HANDOVER && h.status === HandoverStatus.DRAFT && open,
        withdraw: !!ctx?.perms.HANDOVER && h.status === HandoverStatus.PENDING,
        confirm: h.status === HandoverStatus.PENDING && (h.receiverId ? h.receiverId === actor.id : !!ctx?.isManager),
      },
    };
  }

  async save(actor: AuthUser, projectId: string, dto: HandoverDto) {
    const ctx = await this.access.load(actor, projectId);
    this.access.requireCan(ctx, 'HANDOVER');
    this.access.requireOpen(ctx);
    const h = await this.row(ctx.tenantId, projectId);
    if (h.status !== HandoverStatus.DRAFT) throw new ConflictException({ code: 'HANDOVER_SUBMITTED', message: 'Withdraw the handover before changing it' });
    if (dto.receiverId && !(await this.prisma.user.findFirst({ where: { id: dto.receiverId, tenantId: ctx.tenantId, active: true } }))) throw new BadRequestException('Unknown user');
    if (dto.warrantyFrom && dto.warrantyTo && dto.warrantyTo < dto.warrantyFrom) throw new BadRequestException('Warranty ends before it starts');
    const date = (v: string | null | undefined) => (v === undefined ? undefined : v ? new Date(v) : null);
    return this.audit.tx(actor, { action: 'handover.save', entity: 'Handover', entityId: () => h.id, after: () => dto as unknown as Prisma.InputJsonValue },
      (tx) => tx.handover.update({
        where: { id: h.id },
        data: {
          date: date(dto.date), receiverId: dto.receiverId === undefined ? undefined : dto.receiverId || null, externalName: dto.externalName?.trim(),
          warrantyFrom: date(dto.warrantyFrom), warrantyTo: date(dto.warrantyTo), documents: dto.documents, openIssues: dto.openIssues, fromId: actor.id,
        },
      }));
  }

  async submit(actor: AuthUser, projectId: string) {
    const ctx = await this.access.load(actor, projectId);
    this.access.requireCan(ctx, 'HANDOVER');
    this.access.requireOpen(ctx);
    const h = await this.row(ctx.tenantId, projectId);
    if (h.status !== HandoverStatus.DRAFT) throw new ConflictException('Already submitted');
    const missing = [!h.date && '交接日期', !h.receiverId && !h.externalName && '接收人', !(h.documents as string[]).length && '移交文档'].filter(Boolean) as string[];
    if (missing.length) throw new BadRequestException({ code: 'HANDOVER_INCOMPLETE', message: `Missing: ${missing.join(', ')}`, missing });
    const x = await this.audit.tx(actor, { action: 'handover.submit', entity: 'Handover', entityId: () => h.id, after: () => ({ receiverId: h.receiverId, externalName: h.externalName }) },
      (tx) => tx.handover.update({ where: { id: h.id }, data: { status: HandoverStatus.PENDING, submittedAt: new Date(), fromId: actor.id } }));
    if (h.receiverId) {
      await this.notifications.notify(ctx.tenantId, [h.receiverId], { kind: 'HANDOVER_PENDING', title: `售后交接待确认：${ctx.project.code} ${ctx.project.name}`, body: `移交文档 ${(h.documents as string[]).length} 项`, link: '/handovers' }, actor.id);
    }
    return x;
  }

  async withdraw(actor: AuthUser, projectId: string) {
    const ctx = await this.access.load(actor, projectId);
    this.access.requireCan(ctx, 'HANDOVER');
    const h = await this.row(ctx.tenantId, projectId);
    if (h.status !== HandoverStatus.PENDING) throw new ConflictException('Not pending');
    return this.audit.tx(actor, { action: 'handover.withdraw', entity: 'Handover', entityId: () => h.id }, (tx) => tx.handover.update({ where: { id: h.id }, data: { status: HandoverStatus.DRAFT, submittedAt: null } }));
  }

  /** 接收人确认；外部接收人由项目经理确认（写明签字交接单） */
  async confirm(actor: AuthUser, projectId: string, dto: ConfirmHandoverDto) {
    const h = await this.prisma.handover.findUnique({ where: { projectId } });
    if (!h || h.status !== HandoverStatus.PENDING) throw new ConflictException('No handover waiting for confirmation');
    if (h.receiverId) {
      if (h.receiverId !== actor.id) throw new ForbiddenException('Only the receiver confirms');
    } else {
      const ctx = await this.access.load(actor, projectId);
      this.access.requireManager(ctx);
      if (!dto.note?.trim()) throw new BadRequestException({ code: 'REASON_REQUIRED', message: 'Record the signed handover form' });
    }
    const x = await this.audit.tx(actor, { action: 'handover.confirm', entity: 'Handover', entityId: () => h.id, after: () => ({ note: dto.note ?? '' }) },
      (tx) => tx.handover.update({ where: { id: h.id }, data: { status: HandoverStatus.CONFIRMED, confirmedAt: new Date(), confirmedById: actor.id, confirmNote: dto.note?.trim() ?? '' } }));
    const pms = await this.prisma.projectMember.findMany({ where: { projectId, active: true, projectRole: ProjectRole.PROJECT_MANAGER }, select: { userId: true } });
    const p = await this.prisma.project.findUniqueOrThrow({ where: { id: projectId } });
    await this.notifications.notify(h.tenantId, pms.map((m) => m.userId), { kind: 'HANDOVER_CONFIRMED', title: `售后交接已确认：${p.code} ${p.name}`, body: '可以关闭项目', link: `/projects/${projectId}?g=close&s=closure` }, actor.id);
    return x;
  }
}
