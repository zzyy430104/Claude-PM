import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { Meeting, MeetingAttendee, Prisma } from '../generated/prisma/client.js';
import { IssueKind, IssueStatus, MeetingRecurrence, MeetingStatus, MeetingType, RsvpStatus } from '../generated/prisma/enums.js';
import { AuditService } from '../audit/audit.service.js';
import { requireTenantId } from '../common/auth.types.js';
import type { AuthUser } from '../common/auth.types.js';
import { IssuesService } from '../governance/issues.service.js';
import { EmailService } from '../notifications/email.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ProjectAccess, type ProjectCtx } from '../projects/access.service.js';
import { AttendeeDto, ExternalRsvpDto, MeetingDto, MinutesDto, RsvpDto, UpdateMeetingDto } from './dto.js';
import { buildIcs } from './ics.js';

const TYPE_LABEL: Record<MeetingType, string> = { GENERAL: '会议', REGULAR: '例会', PHASE_REVIEW: '阶段评审会', PROJECT_REVIEW: '项目评审会', SUMMARY: '项目总结会' };
const STEP_DAYS: Record<MeetingRecurrence, number> = { NONE: 0, WEEKLY: 7, BIWEEKLY: 14, MONTHLY: 0 };
const fmt = (d: Date) => d.toLocaleString('zh-CN', { timeZone: process.env.TZ_DISPLAY ?? 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });

type Full = Meeting & { attendees: MeetingAttendee[] };

/**
 * 会议（第 4 步）：通知（站内 + 邮件日历邀请）→ 参会确认（外部人员由组织者登记确认方式）→ 纪要（要点、决定、行动项）
 * → 发布纪要后行动项进入「问题与行动」；例会可一键生成下一次，并自动带出上次未关闭的行动项。
 * 任何项目成员可以发起会议；组织者和项目经理可以编辑、发通知、写纪要。
 */
@Injectable()
export class MeetingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: ProjectAccess,
    private readonly issues: IssuesService,
    private readonly notifications: NotificationsService,
    private readonly email: EmailService,
  ) {}

  private async load(actor: AuthUser, projectId: string, id: string) {
    const ctx = await this.access.load(actor, projectId);
    const m = await this.prisma.meeting.findFirst({ where: { id, projectId, tenantId: ctx.tenantId }, include: { attendees: { orderBy: [{ external: 'asc' }, { name: 'asc' }] } } });
    if (!m) throw new NotFoundException('Meeting not found');
    return { ctx, m };
  }
  private canManage(ctx: ProjectCtx, m: Meeting) { return ctx.perms.COMM || m.organizerId === ctx.actor.id; }
  private requireManage(ctx: ProjectCtx, m: Meeting) {
    this.access.requireOpen(ctx);
    if (!this.canManage(ctx, m)) throw new ForbiddenException('Organizer or project manager required');
  }
  private requireEditable(m: Meeting) {
    if (m.status === MeetingStatus.PUBLISHED || m.status === MeetingStatus.CANCELLED) throw new ConflictException({ code: 'MEETING_CLOSED', message: 'Minutes are published or the meeting is cancelled' });
  }

  /** 参会人：系统用户须是本企业的有效用户；外部人员要有姓名 */
  private async attendeeRows(tenantId: string, list: AttendeeDto[], keep: MeetingAttendee[] = []) {
    const ids = [...new Set(list.filter((a) => a.userId).map((a) => a.userId!))];
    const users = await this.prisma.user.findMany({ where: { tenantId, active: true, id: { in: ids } }, select: { id: true, name: true, email: true } });
    if (users.length !== ids.length) throw new BadRequestException('Unknown attendee');
    const rows: Omit<Prisma.MeetingAttendeeCreateManyInput, 'meetingId'>[] = [];
    for (const u of users) {
      const old = keep.find((k) => k.userId === u.id);
      rows.push({ tenantId, userId: u.id, name: u.name, email: u.email, external: false, response: old?.response ?? RsvpStatus.PENDING, confirmMethod: old?.confirmMethod ?? '', respondedAt: old?.respondedAt ?? null });
    }
    for (const a of list.filter((x) => !x.userId)) {
      if (!a.name?.trim()) throw new BadRequestException('External attendees need a name');
      const old = keep.find((k) => k.external && k.name === a.name!.trim() && k.org === (a.org ?? '').trim());
      rows.push({ tenantId, userId: null, name: a.name.trim(), org: a.org?.trim() ?? '', email: a.email?.trim() ?? '', external: true, response: old?.response ?? RsvpStatus.PENDING, confirmMethod: old?.confirmMethod ?? '', respondedAt: old?.respondedAt ?? null });
    }
    return rows;
  }

  private view(m: Full, actorId: string, extra: object = {}) {
    const sys = m.attendees.filter((a) => !a.external);
    return {
      ...m,
      typeLabel: TYPE_LABEL[m.type],
      stats: { total: m.attendees.length, accepted: m.attendees.filter((a) => a.response === RsvpStatus.ACCEPTED).length, declined: m.attendees.filter((a) => a.response === RsvpStatus.DECLINED).length, pending: m.attendees.filter((a) => a.response === RsvpStatus.PENDING).length },
      myResponse: sys.find((a) => a.userId === actorId)?.response ?? null,
      ...extra,
    };
  }

  async list(actor: AuthUser, projectId: string) {
    const ctx = await this.access.load(actor, projectId);
    const ms = await this.prisma.meeting.findMany({ where: { projectId, tenantId: ctx.tenantId }, include: { attendees: true }, orderBy: { startAt: 'desc' } });
    const open = await this.prisma.issue.groupBy({ by: ['meetingId'], where: { projectId, meetingId: { in: ms.map((m) => m.id) }, status: { not: IssueStatus.CLOSED } }, _count: true });
    return ms.map((m) => this.view(m, actor.id, { openActions: open.find((o) => o.meetingId === m.id)?._count ?? 0, canManage: this.canManage(ctx, m) }));
  }

  async get(actor: AuthUser, projectId: string, id: string) {
    const { ctx, m } = await this.load(actor, projectId, id);
    // 例会：同系列之前会议上未关闭的行动项
    const earlier = m.seriesId ? await this.prisma.meeting.findMany({ where: { seriesId: m.seriesId, startAt: { lt: m.startAt }, id: { not: m.id } }, select: { id: true, title: true, seq: true } }) : [];
    const [carry, created, organizer] = await Promise.all([
      earlier.length ? this.prisma.issue.findMany({ where: { projectId, meetingId: { in: earlier.map((e) => e.id) }, status: { not: IssueStatus.CLOSED } }, orderBy: { dueDate: 'asc' } }) : [],
      this.prisma.issue.findMany({ where: { projectId, meetingId: m.id }, orderBy: { createdAt: 'asc' } }),
      this.prisma.user.findUnique({ where: { id: m.organizerId }, select: { name: true } }),
    ]);
    const owners = await this.prisma.user.findMany({ where: { id: { in: [...carry, ...created].map((i) => i.ownerId).filter((x): x is string => !!x) } }, select: { id: true, name: true } });
    const today = new Date().toISOString().slice(0, 10);
    const act = (i: (typeof carry)[number]) => ({
      id: i.id, title: i.title, status: i.status, owner: owners.find((o) => o.id === i.ownerId)?.name ?? null, dueDate: i.dueDate?.toISOString().slice(0, 10) ?? null,
      overdueDays: i.dueDate && i.status !== IssueStatus.CLOSED && i.dueDate.toISOString().slice(0, 10) < today ? Math.round((Date.parse(today) - i.dueDate.getTime()) / 86_400_000) : 0,
      from: earlier.find((e) => e.id === i.meetingId)?.title ?? null,
    });
    return this.view(m, actor.id, { organizer: organizer?.name ?? '', carryOver: carry.map(act), createdActions: created.map(act), canManage: this.canManage(ctx, m) && ctx.project.status !== 'CLOSED' });
  }

  async create(actor: AuthUser, projectId: string, dto: MeetingDto) {
    const ctx = await this.access.load(actor, projectId);
    this.access.requireOpen(ctx);
    if (!ctx.member && !ctx.isManager) throw new ForbiddenException('Project members only');
    const start = new Date(dto.startAt), end = new Date(dto.endAt);
    if (!(end > start)) throw new BadRequestException('The meeting must end after it starts');
    const rows = await this.attendeeRows(ctx.tenantId, [{ userId: actor.id }, ...(dto.attendees ?? []).filter((a) => a.userId !== actor.id)]);
    const regular = dto.type === MeetingType.REGULAR;
    return this.audit.tx(actor, { action: 'meeting.create', entity: 'Meeting', entityId: (x) => x.id, after: (x) => ({ title: x.title, type: x.type, startAt: x.startAt }) }, async (tx) => {
      const m = await tx.meeting.create({
        data: {
          tenantId: ctx.tenantId, projectId, type: dto.type ?? MeetingType.GENERAL, title: dto.title.trim(), startAt: start, endAt: end,
          location: dto.location?.trim() ?? '', link: dto.link?.trim() ?? '', agenda: (dto.agenda ?? []).map((x) => x.trim()).filter(Boolean), materials: dto.materials ?? '',
          recurrence: regular ? (dto.recurrence ?? MeetingRecurrence.WEEKLY) : MeetingRecurrence.NONE, seq: regular ? 1 : null, organizerId: actor.id,
        },
      });
      if (regular) await tx.meeting.update({ where: { id: m.id }, data: { seriesId: m.id } });
      // 组织者默认参加
      await tx.meetingAttendee.createMany({ data: rows.map((r) => ({ ...r, meetingId: m.id, ...(r.userId === actor.id ? { response: RsvpStatus.ACCEPTED, confirmMethod: 'SYSTEM', respondedAt: new Date() } : {}) })) });
      return m;
    });
  }

  async update(actor: AuthUser, projectId: string, id: string, dto: UpdateMeetingDto) {
    const { ctx, m } = await this.load(actor, projectId, id);
    this.requireManage(ctx, m);
    this.requireEditable(m);
    const start = dto.startAt ? new Date(dto.startAt) : m.startAt, end = dto.endAt ? new Date(dto.endAt) : m.endAt;
    if (!(end > start)) throw new BadRequestException('The meeting must end after it starts');
    const rows = dto.attendees ? await this.attendeeRows(ctx.tenantId, [{ userId: m.organizerId }, ...dto.attendees.filter((a) => a.userId !== m.organizerId)], m.attendees) : null;
    return this.audit.tx(actor, { action: 'meeting.update', entity: 'Meeting', entityId: () => id, before: { title: m.title, startAt: m.startAt.toISOString(), location: m.location }, after: () => ({ ...dto, attendees: dto.attendees?.length }) as unknown as Prisma.InputJsonValue }, async (tx) => {
      if (rows) {
        await tx.meetingAttendee.deleteMany({ where: { meetingId: id } });
        await tx.meetingAttendee.createMany({ data: rows.map((r) => ({ ...r, meetingId: id })) });
      }
      return tx.meeting.update({
        where: { id },
        data: {
          title: dto.title?.trim(), startAt: dto.startAt ? start : undefined, endAt: dto.endAt ? end : undefined, location: dto.location?.trim(), link: dto.link?.trim(),
          agenda: dto.agenda ? dto.agenda.map((x) => x.trim()).filter(Boolean) : undefined, materials: dto.materials,
          recurrence: dto.recurrence && m.type === MeetingType.REGULAR ? dto.recurrence : undefined,
        },
      });
    });
  }

  /** 发通知：站内通知系统参会人，邮件附日历邀请（有邮箱的外部人员也发）；再次发送时日历邀请按修订处理 */
  async notify(actor: AuthUser, projectId: string, id: string) {
    const { ctx, m } = await this.load(actor, projectId, id);
    this.requireManage(ctx, m);
    this.requireEditable(m);
    const sequence = m.notifiedAt ? m.icsSequence + 1 : 0;
    await this.audit.tx(actor, { action: 'meeting.notify', entity: 'Meeting', entityId: () => id, after: () => ({ attendees: m.attendees.length, sequence }) },
      (tx) => tx.meeting.update({ where: { id }, data: { status: MeetingStatus.NOTIFIED, notifiedAt: new Date(), icsSequence: sequence } }));
    const when = `${fmt(m.startAt)}–${fmt(m.endAt).slice(-5)}`;
    await this.notifications.notify(ctx.tenantId, m.attendees.filter((a) => a.userId).map((a) => a.userId), {
      kind: 'MEETING_INVITE', title: `${m.notifiedAt ? '会议变更' : '会议通知'}：${m.title}`, body: `${when} · ${m.location || m.link || '地点待定'}，请确认是否参加`, link: `/projects/${projectId}?g=comm&s=meetings&m=${id}`, email: false,
    }, actor.id);
    await this.sendIcs(ctx, m, 'REQUEST', sequence);
    return { ok: true, sequence };
  }

  private async sendIcs(ctx: ProjectCtx, m: Full, method: 'REQUEST' | 'CANCEL', sequence: number) {
    if (!this.email.enabled) return;
    const org = await this.prisma.user.findUniqueOrThrow({ where: { id: m.organizerId }, select: { name: true, email: true } });
    const agenda = (m.agenda as string[]).map((a, i) => `${i + 1}. ${a}`).join('\n');
    const description = [`项目：${ctx.project.code} ${ctx.project.name}`, m.link ? `线上链接：${m.link}` : '', agenda ? `议程：\n${agenda}` : '', m.materials ? `会前资料：${m.materials}` : ''].filter(Boolean).join('\n');
    const content = buildIcs({ uid: `${m.id}@claude-pm`, sequence, method, start: m.startAt, end: m.endAt, title: m.title, location: m.location || m.link, description, organizer: org, attendees: m.attendees.filter((a) => a.email) });
    for (const a of m.attendees.filter((x) => x.email && x.userId !== m.organizerId)) {
      void this.email.send({
        to: a.email, subject: `[Claude-PM] ${method === 'CANCEL' ? '会议取消' : sequence ? '会议变更' : '会议通知'}：${m.title}`,
        text: `${m.title}\n${fmt(m.startAt)}–${fmt(m.endAt).slice(-5)}\n${m.location}\n\n${description}`, icalEvent: { method, filename: 'meeting.ics', content },
      });
    }
  }

  async ics(actor: AuthUser, projectId: string, id: string) {
    const { ctx, m } = await this.load(actor, projectId, id);
    const org = await this.prisma.user.findUniqueOrThrow({ where: { id: m.organizerId }, select: { name: true, email: true } });
    return buildIcs({ uid: `${m.id}@claude-pm`, sequence: m.icsSequence, method: m.status === MeetingStatus.CANCELLED ? 'CANCEL' : 'REQUEST', start: m.startAt, end: m.endAt, title: m.title, location: m.location || m.link, description: `${ctx.project.code} ${ctx.project.name}`, organizer: org, attendees: m.attendees.filter((a) => a.email) });
  }

  /** 本人确认参加 / 不参加 */
  async respond(actor: AuthUser, projectId: string, id: string, dto: RsvpDto) {
    const { m } = await this.load(actor, projectId, id);
    const a = m.attendees.find((x) => x.userId === actor.id);
    if (!a) throw new ForbiddenException('You are not invited to this meeting');
    if (m.status === MeetingStatus.CANCELLED) throw new ConflictException('Meeting cancelled');
    await this.prisma.meetingAttendee.update({ where: { id: a.id }, data: { response: dto.response, confirmMethod: 'SYSTEM', respondedAt: new Date() } });
    if (dto.response === RsvpStatus.DECLINED) {
      await this.notifications.notify(m.tenantId, [m.organizerId], { kind: 'MEETING_DECLINED', title: `${a.name} 不参加：${m.title}`, body: dto.note ?? '', link: `/projects/${projectId}?g=comm&s=meetings&m=${id}` }, actor.id);
    }
    return { ok: true };
  }

  /** 外部人员：组织者登记确认方式（邮件、微信、电话） */
  async registerExternal(actor: AuthUser, projectId: string, id: string, attendeeId: string, dto: ExternalRsvpDto) {
    const { ctx, m } = await this.load(actor, projectId, id);
    this.requireManage(ctx, m);
    const a = m.attendees.find((x) => x.id === attendeeId && x.external);
    if (!a) throw new NotFoundException('External attendee not found');
    return this.audit.tx(actor, { action: 'meeting.externalRsvp', entity: 'Meeting', entityId: () => id, after: () => ({ name: a.name, response: dto.response, method: dto.method }) },
      (tx) => tx.meetingAttendee.update({ where: { id: a.id }, data: { response: dto.response, confirmMethod: dto.method, respondedAt: new Date() } }));
  }

  async remind(actor: AuthUser, projectId: string, id: string) {
    const { ctx, m } = await this.load(actor, projectId, id);
    this.requireManage(ctx, m);
    const pending = m.attendees.filter((a) => a.userId && a.response === RsvpStatus.PENDING).map((a) => a.userId);
    await this.notifications.notify(ctx.tenantId, pending, { kind: 'MEETING_INVITE', title: `请确认是否参加：${m.title}`, body: fmt(m.startAt), link: `/projects/${projectId}?g=comm&s=meetings&m=${id}` }, actor.id);
    return { reminded: pending.length };
  }

  async saveMinutes(actor: AuthUser, projectId: string, id: string, dto: MinutesDto) {
    const { ctx, m } = await this.load(actor, projectId, id);
    this.requireManage(ctx, m);
    this.requireEditable(m);
    for (const a of dto.actions ?? []) await this.issues.checkOwner(ctx.tenantId, projectId, a.ownerId || undefined);
    return this.prisma.meeting.update({ where: { id }, data: { points: dto.points, decisions: dto.decisions, actions: dto.actions as unknown as Prisma.InputJsonValue } });
  }

  /** 发布纪要：行动项进入「问题与行动」，通知参会人和行动项责任人 */
  async publish(actor: AuthUser, projectId: string, id: string) {
    const { ctx, m } = await this.load(actor, projectId, id);
    this.requireManage(ctx, m);
    this.requireEditable(m);
    if (!m.points.trim() && !m.decisions.trim()) throw new BadRequestException({ code: 'MINUTES_EMPTY', message: 'Write the discussion points or decisions first' });
    if (m.startAt > new Date()) throw new ConflictException({ code: 'MEETING_NOT_HELD', message: 'The meeting has not started yet' });
    const actions = ((m.actions as { title: string; ownerId?: string; dueDate?: string }[]) ?? []).filter((a) => a.title?.trim());
    const done = await this.audit.tx(actor, { action: 'meeting.publish', entity: 'Meeting', entityId: () => id, after: () => ({ actions: actions.length }) }, async (tx) => {
      for (const a of actions) await this.issues.insert(tx, ctx.tenantId, projectId, actor.id, { kind: IssueKind.ACTION, title: a.title.trim(), ownerId: a.ownerId || undefined, dueDate: a.dueDate || undefined, source: 'MEETING', meetingId: id, description: `会议：${m.title}` });
      return tx.meeting.update({ where: { id }, data: { status: MeetingStatus.PUBLISHED, publishedAt: new Date(), publishedById: actor.id } });
    });
    await this.notifications.notify(ctx.tenantId, m.attendees.map((a) => a.userId), { kind: 'MEETING_MINUTES', title: `会议纪要已发布：${m.title}`, body: actions.length ? `${actions.length} 个行动项` : '', link: `/projects/${projectId}?g=comm&s=meetings&m=${id}` }, actor.id);
    for (const a of actions.filter((x) => x.ownerId)) {
      await this.notifications.notify(ctx.tenantId, [a.ownerId], { kind: 'ACTION_ASSIGNED', title: `行动项已分配给你：${a.title}`, body: `会议：${m.title}`, link: `/projects/${projectId}?g=ctrl&s=issues` }, actor.id);
    }
    return done;
  }

  /** 例会：按周期生成下一次，带上参会人（确认状态重置）、地点、议程 */
  async next(actor: AuthUser, projectId: string, id: string) {
    const { ctx, m } = await this.load(actor, projectId, id);
    this.requireManage(ctx, m);
    if (m.type !== MeetingType.REGULAR || !m.seriesId) throw new BadRequestException('Only regular meetings repeat');
    const last = await this.prisma.meeting.findFirst({ where: { seriesId: m.seriesId }, orderBy: { startAt: 'desc' } });
    const base = last!;
    const shift = (d: Date) => {
      const x = new Date(d);
      if (m.recurrence === MeetingRecurrence.MONTHLY) x.setUTCMonth(x.getUTCMonth() + 1); else x.setUTCDate(x.getUTCDate() + (STEP_DAYS[m.recurrence] || 7));
      return x;
    };
    const seq = (base.seq ?? 1) + 1;
    const title = base.title.replace(/\s*#\d+$/, '') + ` #${seq}`;
    return this.audit.tx(actor, { action: 'meeting.next', entity: 'Meeting', entityId: (x) => x.id, after: (x) => ({ title: x.title, startAt: x.startAt }) }, async (tx) => {
      const n = await tx.meeting.create({
        data: {
          tenantId: ctx.tenantId, projectId, type: MeetingType.REGULAR, title, seq, seriesId: m.seriesId, recurrence: m.recurrence, startAt: shift(base.startAt), endAt: shift(base.endAt),
          location: base.location, link: base.link, agenda: base.agenda as Prisma.InputJsonValue, organizerId: actor.id,
        },
      });
      const att = await tx.meetingAttendee.findMany({ where: { meetingId: base.id } });
      await tx.meetingAttendee.createMany({ data: att.map((a) => ({ tenantId: a.tenantId, meetingId: n.id, userId: a.userId, name: a.name, org: a.org, email: a.email, external: a.external, ...(a.userId === actor.id ? { response: RsvpStatus.ACCEPTED, confirmMethod: 'SYSTEM', respondedAt: new Date() } : {}) })) });
      return n;
    });
  }

  async cancel(actor: AuthUser, projectId: string, id: string) {
    const { ctx, m } = await this.load(actor, projectId, id);
    this.requireManage(ctx, m);
    this.requireEditable(m);
    await this.audit.tx(actor, { action: 'meeting.cancel', entity: 'Meeting', entityId: () => id }, (tx) => tx.meeting.update({ where: { id }, data: { status: MeetingStatus.CANCELLED, icsSequence: m.icsSequence + 1 } }));
    if (m.notifiedAt) {
      await this.notifications.notify(ctx.tenantId, m.attendees.map((a) => a.userId), { kind: 'MEETING_CANCELLED', title: `会议取消：${m.title}`, body: fmt(m.startAt), link: `/projects/${projectId}?g=comm&s=meetings&m=${id}`, email: false }, actor.id);
      await this.sendIcs(ctx, m, 'CANCEL', m.icsSequence + 1);
    }
    return { ok: true };
  }

  /** 我的会议：未来 14 天内邀请我的会议（工作台用） */
  async mine(actor: AuthUser) {
    const tenantId = requireTenantId(actor);
    const now = new Date();
    const to = new Date(now.getTime() + 14 * 86_400_000);
    const rows = await this.prisma.meetingAttendee.findMany({
      where: { tenantId, userId: actor.id, meeting: { status: { in: [MeetingStatus.NOTIFIED] }, endAt: { gte: now }, startAt: { lte: to } } },
      include: { meeting: { include: { attendees: true } } },
    });
    const projects = await this.prisma.project.findMany({ where: { id: { in: rows.map((r) => r.meeting.projectId) } }, select: { id: true, code: true, name: true } });
    return rows.sort((a, b) => a.meeting.startAt.getTime() - b.meeting.startAt.getTime()).map((r) => ({
      ...this.view(r.meeting, actor.id), project: projects.find((p) => p.id === r.meeting.projectId),
    }));
  }
}
