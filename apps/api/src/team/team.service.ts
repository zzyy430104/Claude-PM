import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { TrainingStatus } from '../generated/prisma/enums.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthUser } from '../common/auth.types.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ProjectAccess } from '../projects/access.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { CreateCommLogDto, CreateTrainingDto, UpdateCommPlanDto, UpdateTrainingDto } from './team.dto.js';

/** 项目沟通管理（8.1.3.8）与项目人力资源管理中的培训（8.1.3.7 f） */
@Injectable()
export class TeamService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: ProjectAccess,
    private readonly notifications: NotificationsService,
  ) {}

  async getCommPlan(actor: AuthUser, projectId: string) {
    const ctx = await this.access.load(actor, projectId);
    return (await this.prisma.communicationPlan.findUnique({ where: { projectId } })) ?? { projectId, tenantId: ctx.tenantId, channels: [], notes: '', version: 0 };
  }

  async updateCommPlan(actor: AuthUser, projectId: string, dto: UpdateCommPlanDto) {
    const ctx = await this.access.load(actor, projectId);
    this.access.requireManager(ctx);
    this.access.requireOpen(ctx);
    const data = { channels: dto.channels as unknown as Prisma.InputJsonValue | undefined, notes: dto.notes };
    return this.audit.tx(
      actor,
      { action: 'communicationPlan.update', entity: 'CommunicationPlan', entityId: () => projectId, after: (p) => ({ version: p.version }) },
      (tx) =>
        tx.communicationPlan.upsert({
          where: { projectId },
          create: { ...data, projectId, tenantId: ctx.tenantId, updatedById: actor.id },
          update: { ...data, version: { increment: 1 }, updatedById: actor.id },
        }),
    );
  }

  async listLogs(actor: AuthUser, projectId: string) {
    const ctx = await this.access.load(actor, projectId);
    return this.prisma.communicationLog.findMany({ where: { projectId, tenantId: ctx.tenantId }, orderBy: [{ logDate: 'desc' }, { createdAt: 'desc' }] });
  }

  async addLog(actor: AuthUser, projectId: string, dto: CreateCommLogDto) {
    const ctx = await this.access.load(actor, projectId);
    this.access.requireOpen(ctx);
    if (!ctx.member && !ctx.isManager) throw new ForbiddenException('Project members only');
    return this.audit.tx(
      actor,
      { action: 'communicationLog.create', entity: 'CommunicationLog', entityId: (l) => l.id, after: (l) => ({ kind: l.kind, subject: l.subject }) },
      (tx) => tx.communicationLog.create({ data: { ...dto, logDate: new Date(dto.logDate), tenantId: ctx.tenantId, projectId, createdById: actor.id } }),
    );
  }

  async listTrainings(actor: AuthUser, projectId: string) {
    const ctx = await this.access.load(actor, projectId);
    return this.prisma.training.findMany({ where: { projectId, tenantId: ctx.tenantId }, orderBy: { createdAt: 'desc' } });
  }

  async addTraining(actor: AuthUser, projectId: string, dto: CreateTrainingDto) {
    const ctx = await this.access.load(actor, projectId);
    this.access.requireManager(ctx);
    this.access.requireOpen(ctx);
    const m = await this.prisma.projectMember.findFirst({ where: { projectId, tenantId: ctx.tenantId, userId: dto.userId, active: true } });
    if (!m) throw new BadRequestException('Trainee must be an active project member');
    const created = await this.audit.tx(
      actor,
      { action: 'training.create', entity: 'Training', entityId: (t) => t.id, after: (t) => ({ userId: t.userId, title: t.title }) },
      (tx) => tx.training.create({ data: { tenantId: ctx.tenantId, projectId, userId: dto.userId, title: dto.title, dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined, createdById: actor.id } }),
    );
    await this.notifications.notify(ctx.tenantId, [dto.userId], { kind: 'TRAINING', title: `培训安排：${dto.title}`, body: ctx.project.code, link: `/projects/${projectId}` }, actor.id);
    return created;
  }

  async updateTraining(actor: AuthUser, projectId: string, id: string, dto: UpdateTrainingDto) {
    const ctx = await this.access.load(actor, projectId);
    this.access.requireOpen(ctx);
    const t = await this.prisma.training.findFirst({ where: { id, projectId, tenantId: ctx.tenantId } });
    if (!t) throw new NotFoundException('Training not found');
    if (!ctx.isManager && t.userId !== actor.id) throw new ForbiddenException('Only the trainee or project manager can update this record');
    return this.audit.tx(
      actor,
      { action: 'training.update', entity: 'Training', entityId: () => id, before: { status: t.status }, after: (x) => ({ status: x.status }) },
      (tx) =>
        tx.training.update({
          where: { id },
          data: {
            status: dto.status,
            dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined,
            ...(dto.status === TrainingStatus.DONE ? { completedAt: new Date() } : dto.status === TrainingStatus.PLANNED ? { completedAt: null } : {}),
          },
        }),
    );
  }
}
