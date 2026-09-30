import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { PhaseStatus, ProjectRole, ProjectStatus, Role } from '../generated/prisma/enums.js';
import { AuditService } from '../audit/audit.service.js';
import { requireTenantId } from '../common/auth.types.js';
import type { AuthUser } from '../common/auth.types.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ProjectAccess } from './access.service.js';
import { ChangeGuard } from './change-guard.service.js';
import {
  AddMemberDto,
  CreateProjectDto,
  UpdateMemberDto,
  UpdatePhaseDto,
  UpdatePlanDto,
  UpdateProjectDto,
} from './dto.js';
import { DEFAULT_PHASES } from './templates.service.js';

const REVIEW_INTERVAL = { LOW: 60, MEDIUM: 30, HIGH: 14 } as const;
const day = (s: string) => new Date(s);

@Injectable()
export class ProjectsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: ProjectAccess,
    private readonly guard: ChangeGuard,
  ) {}

  // ───── 项目 ─────

  list(actor: AuthUser) {
    const tenantId = requireTenantId(actor);
    const seesAll = actor.role === Role.TENANT_ADMIN || actor.role === Role.TOP_MANAGEMENT;
    return this.prisma.project.findMany({
      where: {
        tenantId,
        ...(seesAll ? {} : { members: { some: { userId: actor.id, active: true } } }),
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async get(actor: AuthUser, id: string) {
    const ctx = await this.access.load(actor, id);
    return {
      ...ctx.project,
      permissions: {
        manage: ctx.isManager,
        quality: ctx.isQuality,
        ccb: ctx.isCcb,
        topManagement: ctx.isTopManagement,
      },
    };
  }

  async create(actor: AuthUser, dto: CreateProjectDto) {
    const tenantId = requireTenantId(actor);
    if (actor.role !== Role.TENANT_ADMIN && actor.role !== Role.PROJECT_MANAGER) {
      throw new ForbiddenException('Only tenant admin or project manager can create projects');
    }
    if (day(dto.endDate) < day(dto.startDate)) {
      throw new BadRequestException('endDate must not be before startDate');
    }
    const managerId = dto.managerId ?? (actor.role === Role.PROJECT_MANAGER ? actor.id : undefined);
    if (managerId) await this.requireTenantUser(tenantId, managerId);

    let phases: readonly { name: string; checklist: readonly string[]; mandatoryRoles: readonly string[] }[] = DEFAULT_PHASES;
    if (dto.templateId) {
      const tpl = await this.prisma.phaseTemplate.findFirst({
        where: { id: dto.templateId, tenantId, active: true },
      });
      if (!tpl) throw new BadRequestException('Unknown phase template');
      phases = tpl.phases as unknown as typeof phases;
    }

    try {
      return await this.audit.tx(
        actor,
        {
          action: 'project.create',
          entity: 'Project',
          entityId: (p) => p.id,
          after: (p) => ({ code: p.code, name: p.name, riskLevel: p.riskLevel }),
        },
        async (tx) => {
          const project = await tx.project.create({
            data: {
              tenantId,
              code: dto.code,
              name: dto.name,
              description: dto.description,
              riskLevel: dto.riskLevel,
              startDate: day(dto.startDate),
              endDate: day(dto.endDate),
              customerDeliveryDate: dto.customerDeliveryDate ? day(dto.customerDeliveryDate) : undefined,
              budget: dto.budget,
              reviewIntervalDays: REVIEW_INTERVAL[dto.riskLevel],
              createdById: actor.id,
            },
          });
          await tx.phase.createMany({
            data: phases.map((p, i) => ({
              tenantId,
              projectId: project.id,
              name: p.name,
              order: i + 1,
              checklist: [...p.checklist],
              mandatoryRoles: [...p.mandatoryRoles],
            })),
          });
          if (managerId) {
            await tx.projectMember.create({
              data: { tenantId, projectId: project.id, userId: managerId, projectRole: ProjectRole.PROJECT_MANAGER, isCcb: true },
            });
          }
          return project;
        },
      );
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('Project code already exists');
      }
      throw e;
    }
  }

  async update(actor: AuthUser, id: string, dto: UpdateProjectDto) {
    const ctx = await this.access.load(actor, id);
    this.access.requireManager(ctx);
    this.access.requireOpen(ctx);
    const p = ctx.project;
    const controlled =
      dto.budget !== undefined ||
      dto.customerDeliveryDate !== undefined ||
      dto.startDate !== undefined ||
      dto.endDate !== undefined;
    if (controlled) await this.guard.assertAllowed(ctx);
    const start = dto.startDate ? day(dto.startDate) : p.startDate;
    const end = dto.endDate ? day(dto.endDate) : p.endDate;
    if (end < start) throw new BadRequestException('endDate must not be before startDate');

    return this.audit.tx(
      actor,
      {
        action: 'project.update',
        entity: 'Project',
        entityId: () => id,
        before: { name: p.name, riskLevel: p.riskLevel, budget: p.budget?.toString() ?? null },
        after: () => ({ ...dto }),
      },
      (tx) =>
        tx.project.update({
          where: { id },
          data: {
            name: dto.name,
            description: dto.description,
            riskLevel: dto.riskLevel,
            reviewIntervalDays:
              dto.reviewIntervalDays ??
              (dto.riskLevel ? REVIEW_INTERVAL[dto.riskLevel] : undefined),
            startDate: dto.startDate ? day(dto.startDate) : undefined,
            endDate: dto.endDate ? day(dto.endDate) : undefined,
            customerDeliveryDate: dto.customerDeliveryDate ? day(dto.customerDeliveryDate) : undefined,
            budget: dto.budget,
          },
        }),
    );
  }

  /** 建立基线：此后范围、预算、客户交期变更必须走变更控制 */
  async baseline(actor: AuthUser, id: string) {
    const ctx = await this.access.load(actor, id);
    this.access.requireManager(ctx);
    if (ctx.project.baselined) throw new ConflictException('Already baselined');
    const pm = await this.prisma.projectMember.count({
      where: { projectId: id, projectRole: ProjectRole.PROJECT_MANAGER, active: true },
    });
    if (pm === 0) throw new BadRequestException('Assign a project manager before baselining');
    return this.audit.tx(
      actor,
      { action: 'project.baseline', entity: 'Project', entityId: () => id },
      async (tx) => {
        const first = await tx.phase.findFirst({ where: { projectId: id }, orderBy: { order: 'asc' } });
        if (first) {
          await tx.phase.update({ where: { id: first.id }, data: { status: PhaseStatus.ACTIVE, startedAt: new Date() } });
        }
        return tx.project.update({
          where: { id },
          data: { baselined: true, status: ProjectStatus.ACTIVE },
        });
      },
    );
  }

  // ───── 成员 ─────

  async listMembers(actor: AuthUser, id: string) {
    const ctx = await this.access.load(actor, id);
    const members = await this.prisma.projectMember.findMany({
      where: { projectId: id, tenantId: ctx.tenantId },
      orderBy: { createdAt: 'asc' },
    });
    const users = await this.prisma.user.findMany({
      where: { id: { in: members.map((m) => m.userId) }, tenantId: ctx.tenantId },
      select: { id: true, name: true, email: true },
    });
    const byId = new Map(users.map((u) => [u.id, u]));
    return members.map((m) => ({ ...m, user: byId.get(m.userId) ?? null }));
  }

  async addMember(actor: AuthUser, id: string, dto: AddMemberDto) {
    const ctx = await this.access.load(actor, id);
    this.access.requireManager(ctx);
    this.access.requireOpen(ctx);
    await this.requireTenantUser(ctx.tenantId, dto.userId);
    const existing = await this.prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId: id, userId: dto.userId } },
    });
    return this.audit.tx(
      actor,
      {
        action: existing ? 'projectMember.reactivate' : 'projectMember.add',
        entity: 'ProjectMember',
        entityId: (m) => m.id,
        after: (m) => ({ userId: m.userId, projectRole: m.projectRole, isCcb: m.isCcb }),
      },
      (tx) =>
        existing
          ? tx.projectMember.update({
              where: { id: existing.id },
              data: { active: true, projectRole: dto.projectRole, isCcb: dto.isCcb ?? false, appointment: dto.appointment, competencies: dto.competencies },
            })
          : tx.projectMember.create({
              data: { tenantId: ctx.tenantId, projectId: id, userId: dto.userId, projectRole: dto.projectRole, isCcb: dto.isCcb ?? false, appointment: dto.appointment, competencies: dto.competencies },
            }),
    );
  }

  async updateMember(actor: AuthUser, id: string, userId: string, dto: UpdateMemberDto) {
    const ctx = await this.access.load(actor, id);
    this.access.requireManager(ctx);
    this.access.requireOpen(ctx);
    const m = await this.prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId: id, userId } },
    });
    if (!m || m.tenantId !== ctx.tenantId) throw new NotFoundException('Member not found');
    const losesPm =
      m.projectRole === ProjectRole.PROJECT_MANAGER &&
      m.active &&
      (dto.active === false || (dto.projectRole && dto.projectRole !== ProjectRole.PROJECT_MANAGER));
    if (losesPm && ctx.project.baselined) {
      const others = await this.prisma.projectMember.count({
        where: { projectId: id, projectRole: ProjectRole.PROJECT_MANAGER, active: true, NOT: { userId } },
      });
      if (others === 0) throw new ConflictException('A baselined project needs at least one project manager');
    }
    return this.audit.tx(
      actor,
      {
        action: 'projectMember.update',
        entity: 'ProjectMember',
        entityId: (x) => x.id,
        before: { projectRole: m.projectRole, isCcb: m.isCcb, active: m.active },
        after: (x) => ({ projectRole: x.projectRole, isCcb: x.isCcb, active: x.active }),
      },
      (tx) => tx.projectMember.update({ where: { id: m.id }, data: { ...dto } }),
    );
  }

  // ───── 项目管理计划 ─────

  async getPlan(actor: AuthUser, id: string) {
    const ctx = await this.access.load(actor, id);
    const plan = await this.prisma.projectPlan.findUnique({ where: { projectId: id } });
    return (
      plan ?? {
        projectId: id,
        tenantId: ctx.tenantId,
        objectives: '',
        frameConditions: '',
        exclusions: '',
        responsibilities: '',
        executionRules: '',
        orgChart: [],
        interfaces: {},
        version: 0,
      }
    );
  }

  async updatePlan(actor: AuthUser, id: string, dto: UpdatePlanDto) {
    const ctx = await this.access.load(actor, id);
    this.access.requireManager(ctx);
    this.access.requireOpen(ctx);
    const data = {
      ...dto,
      orgChart: dto.orgChart as Prisma.InputJsonValue | undefined,
      interfaces: dto.interfaces as Prisma.InputJsonValue | undefined,
    };
    return this.audit.tx(
      actor,
      {
        action: 'projectPlan.update',
        entity: 'ProjectPlan',
        entityId: () => id,
        after: (p) => ({ version: p.version }),
      },
      (tx) =>
        tx.projectPlan.upsert({
          where: { projectId: id },
          create: { ...data, projectId: id, tenantId: ctx.tenantId, updatedById: actor.id },
          update: { ...data, version: { increment: 1 }, updatedById: actor.id },
        }),
    );
  }

  // ───── 阶段 ─────

  async listPhases(actor: AuthUser, id: string) {
    const ctx = await this.access.load(actor, id);
    return this.prisma.phase.findMany({
      where: { projectId: id, tenantId: ctx.tenantId },
      orderBy: { order: 'asc' },
    });
  }

  async updatePhase(actor: AuthUser, id: string, phaseId: string, dto: UpdatePhaseDto) {
    const ctx = await this.access.load(actor, id);
    this.access.requireManager(ctx);
    this.access.requireOpen(ctx);
    const phase = await this.prisma.phase.findFirst({
      where: { id: phaseId, projectId: id, tenantId: ctx.tenantId },
    });
    if (!phase) throw new NotFoundException('Phase not found');
    if (phase.status === PhaseStatus.CLOSED) throw new ConflictException('Phase is closed');
    return this.audit.tx(
      actor,
      {
        action: 'phase.update',
        entity: 'Phase',
        entityId: () => phaseId,
        before: { name: phase.name },
        after: () => ({ ...dto }),
      },
      (tx) =>
        tx.phase.update({
          where: { id: phaseId },
          data: {
            name: dto.name,
            checklist: dto.checklist as Prisma.InputJsonValue | undefined,
            mandatoryRoles: dto.mandatoryRoles as Prisma.InputJsonValue | undefined,
          },
        }),
    );
  }

  private async requireTenantUser(tenantId: string, userId: string) {
    const u = await this.prisma.user.findFirst({ where: { id: userId, tenantId, active: true } });
    if (!u) throw new BadRequestException('User not found in this tenant');
  }
}
