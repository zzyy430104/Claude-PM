import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { ApprovalRoleKind, ProjectRole, RequirementChangeStatus, Role } from '../generated/prisma/enums.js';
import { AuditService } from '../audit/audit.service.js';
import { requireTenantId } from '../common/auth.types.js';
import type { AuthUser } from '../common/auth.types.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ProjectAccess } from '../projects/access.service.js';
import { ApprovalRolesService } from './approval-roles.service.js';
import type { DecisionDto, SaveRequirementChangeDto } from './dto.js';
import { PlanBuilderService } from './plan-builder.service.js';
import { asRequirements, effectiveDeliveryDate, requirementProblems, TYPE_LABEL } from './requirements.js';

const EDITABLE: RequirementChangeStatus[] = [RequirementChangeStatus.DRAFT, RequirementChangeStatus.REJECTED];

/**
 * 项目要求变更：改“要达成什么”（时间、交付物、质量、成本、项目类型），与项目内变更分开，
 * 由立项批准人审批；批准后生成新一版项目要求，计划须重新批准。
 */
@Injectable()
export class RequirementChangesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: ProjectAccess,
    private readonly roles: ApprovalRolesService,
    private readonly builder: PlanBuilderService,
    private readonly notifications: NotificationsService,
  ) {}

  /** 项目成员按项目权限看；立项申请人、批准人即使不是成员也能看 */
  private async project(actor: AuthUser, projectId: string) {
    try {
      const ctx = await this.access.load(actor, projectId);
      return { project: ctx.project, isManager: ctx.isManager };
    } catch (e) {
      if (!(e instanceof NotFoundException)) throw e;
      const m = await this.roles.mine(actor);
      if (!m.initiator && !m.approver) throw e;
      const project = await this.prisma.project.findFirst({ where: { id: projectId, tenantId: requireTenantId(actor) } });
      if (!project) throw e;
      return { project, isManager: false };
    }
  }

  async versions(actor: AuthUser, projectId: string) {
    const { project } = await this.project(actor, projectId);
    return this.prisma.projectRequirementVersion.findMany({ where: { projectId: project.id, tenantId: project.tenantId }, orderBy: { version: 'desc' } });
  }

  async listForProject(actor: AuthUser, projectId: string) {
    const { project } = await this.project(actor, projectId);
    return this.prisma.requirementChange.findMany({ where: { projectId: project.id, tenantId: project.tenantId }, orderBy: { createdAt: 'desc' } });
  }

  /** 立项管理里的“项目要求变更”页签 */
  async listAll(actor: AuthUser) {
    const tenantId = requireTenantId(actor);
    const m = await this.roles.mine(actor);
    if (!m.initiator && !m.approver && actor.role !== Role.TENANT_ADMIN && actor.role !== Role.TOP_MANAGEMENT) throw new ForbiddenException('Not allowed');
    const rows = await this.prisma.requirementChange.findMany({ where: { tenantId }, orderBy: { createdAt: 'desc' } });
    const projects = await this.prisma.project.findMany({ where: { tenantId, id: { in: rows.map((r) => r.projectId) } }, select: { id: true, code: true, name: true } });
    return rows.map((r) => ({ ...r, project: projects.find((p) => p.id === r.projectId) ?? null }));
  }

  async get(actor: AuthUser, id: string) {
    const tenantId = requireTenantId(actor);
    const c = await this.prisma.requirementChange.findFirst({ where: { id, tenantId } });
    if (!c) throw new NotFoundException('Requirement change not found');
    const { project } = await this.project(actor, c.projectId);
    const current = await this.prisma.projectRequirementVersion.findUnique({ where: { projectId_version: { projectId: project.id, version: project.requirementVersion } } });
    const approver = await this.roles.has(actor, ApprovalRoleKind.APPROVER);
    return {
      ...c, project: { id: project.id, code: project.code, name: project.name, type: project.type, requirementVersion: project.requirementVersion },
      current: current?.data ?? null,
      can: { edit: c.applicantId === actor.id && EDITABLE.includes(c.status), decide: c.status === RequirementChangeStatus.PENDING && c.applicantId !== actor.id && approver },
    };
  }

  async create(actor: AuthUser, projectId: string, dto: SaveRequirementChangeDto) {
    const { project, isManager } = await this.project(actor, projectId);
    if (!isManager && !(await this.roles.has(actor, ApprovalRoleKind.INITIATOR))) throw new ForbiddenException('Only the project manager or an initiator can request a change');
    if (!project.requirementVersion) throw new ConflictException('This project has no project requirements (created without initiation)');
    if (!dto.reason?.trim()) throw new BadRequestException('reason is required');
    const current = await this.prisma.projectRequirementVersion.findUniqueOrThrow({ where: { projectId_version: { projectId, version: project.requirementVersion } } });
    const base = current.data as Record<string, unknown>;
    const data = { ...base, ...defined(dto.requirements), type: dto.type ?? (base.type as string) ?? project.type };
    for (let attempt = 0; ; attempt++) {
      const year = new Date().getFullYear();
      const like = `RC-${year}-`;
      const n = Math.max(0, ...(await this.prisma.requirementChange.findMany({ where: { tenantId: project.tenantId, code: { startsWith: like } }, select: { code: true } })).map((r) => Number(r.code.slice(like.length)) || 0)) + 1;
      try {
        return await this.audit.tx(
          actor,
          { action: 'requirementChange.create', entity: 'RequirementChange', entityId: (r) => r.id, after: (r) => ({ code: r.code, projectId, reason: r.reason }) },
          (tx) => tx.requirementChange.create({
            data: { tenantId: project.tenantId, projectId, code: `${like}${String(n).padStart(3, '0')}`, reason: dto.reason!.trim(), data: data as unknown as Prisma.InputJsonValue, fromVersion: project.requirementVersion, applicantId: actor.id },
          }),
        );
      } catch (e) {
        if (attempt < 3 && e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') continue;
        throw e;
      }
    }
  }

  private async own(actor: AuthUser, id: string) {
    const c = await this.prisma.requirementChange.findFirst({ where: { id, tenantId: requireTenantId(actor) } });
    if (!c) throw new NotFoundException('Requirement change not found');
    if (c.applicantId !== actor.id) throw new ForbiddenException('Only the applicant can change this request');
    return c;
  }

  async update(actor: AuthUser, id: string, dto: SaveRequirementChangeDto) {
    const c = await this.own(actor, id);
    if (!EDITABLE.includes(c.status)) throw new ConflictException('Only drafts or rejected requests can be edited');
    const base = c.data as Record<string, unknown>;
    const data = { ...base, ...defined(dto.requirements), ...(dto.type ? { type: dto.type } : {}) };
    return this.audit.tx(
      actor,
      { action: 'requirementChange.update', entity: 'RequirementChange', entityId: () => id, after: () => ({ ...dto }) as unknown as Prisma.InputJsonValue },
      (tx) => tx.requirementChange.update({ where: { id }, data: { reason: dto.reason?.trim(), data: data as Prisma.InputJsonValue } }),
    );
  }

  async submit(actor: AuthUser, id: string) {
    const c = await this.own(actor, id);
    if (!EDITABLE.includes(c.status)) throw new ConflictException('Already submitted');
    const project = await this.prisma.project.findUniqueOrThrow({ where: { id: c.projectId } });
    const data = c.data as Record<string, unknown>;
    const type = (data.type as typeof project.type) ?? project.type;
    const problems = requirementProblems(
      { type, name: project.name, projectCode: project.code, customer: type === 'C' ? '' : 'x', proposedPmId: 'x', startDate: project.startDate },
      asRequirements(data),
    );
    if (problems.length) throw new BadRequestException({ code: 'REQUIREMENTS_INCOMPLETE', message: `缺少：${problems.join('、')}`, problems });
    const r = await this.audit.tx(
      actor,
      { action: 'requirementChange.submit', entity: 'RequirementChange', entityId: () => id },
      (tx) => tx.requirementChange.update({ where: { id }, data: { status: RequirementChangeStatus.PENDING, submittedAt: new Date(), decidedAt: null, decidedById: null, decisionNote: null } }),
    );
    await this.notifications.notify(c.tenantId, await this.roles.usersFor(c.tenantId, ApprovalRoleKind.APPROVER), {
      kind: 'REQUIREMENT_CHANGE_SUBMITTED', title: `项目要求变更待审批：${project.name}`, body: `${c.code} ${c.reason}`, link: `/initiations?tab=rc&id=${id}`,
    }, actor.id);
    return r;
  }

  private async decidable(actor: AuthUser, id: string) {
    const c = await this.prisma.requirementChange.findFirst({ where: { id, tenantId: requireTenantId(actor) } });
    if (!c) throw new NotFoundException('Requirement change not found');
    if (c.status !== RequirementChangeStatus.PENDING) throw new ConflictException('Not waiting for approval');
    if (c.applicantId === actor.id) throw new ForbiddenException('The applicant cannot approve their own request');
    if (!(await this.roles.has(actor, ApprovalRoleKind.APPROVER))) throw new ForbiddenException('Not an approver');
    return c;
  }

  async approve(actor: AuthUser, id: string, dto: DecisionDto) {
    const c = await this.decidable(actor, id);
    const project = await this.prisma.project.findUniqueOrThrow({ where: { id: c.projectId } });
    if (project.requirementVersion !== c.fromVersion) throw new ConflictException('Project requirements changed since this request was made; please resubmit against the latest version');
    const data = c.data as Record<string, unknown>;
    const req = asRequirements(data);
    const type = (data.type as typeof project.type) ?? project.type;
    const due = effectiveDeliveryDate(type, req);
    const version = project.requirementVersion + 1;
    const result = await this.audit.tx(
      actor,
      { action: 'requirementChange.approve', entity: 'RequirementChange', entityId: () => id, after: (r) => ({ version, addedPhases: r.added, note: dto.note ?? '' }) },
      async (tx) => {
        await tx.projectRequirementVersion.create({
          data: { tenantId: c.tenantId, projectId: project.id, version, data: { ...req, type } as unknown as Prisma.InputJsonValue, reason: `${c.code}：${c.reason}`, approvedById: actor.id, changeId: c.id },
        });
        await tx.project.update({
          where: { id: project.id },
          data: { requirementVersion: version, type, customerDeliveryDate: due ? new Date(due) : project.customerDeliveryDate, planOutdated: project.baselined, planSubmittedAt: null },
        });
        const added = type !== project.type ? await this.builder.addMissingPhases(tx, c.tenantId, project.id, type, req) : [];
        await tx.requirementChange.update({ where: { id }, data: { status: RequirementChangeStatus.APPROVED, decidedById: actor.id, decidedAt: new Date(), decisionNote: dto.note ?? null } });
        return { added };
      },
    );
    const pms = await this.prisma.projectMember.findMany({ where: { projectId: project.id, projectRole: ProjectRole.PROJECT_MANAGER, active: true }, select: { userId: true } });
    await this.notifications.notify(c.tenantId, [c.applicantId, ...pms.map((p) => p.userId)], {
      kind: 'REQUIREMENT_CHANGE_DECIDED', title: `项目要求已变更为 v${version}：${project.name}`,
      body: project.baselined ? '请据此修订计划并重新提交计划批准' : `${c.code} 已批准${type !== project.type ? `，项目类型改为 ${TYPE_LABEL[type]}` : ''}`,
      link: `/projects/${project.id}?g=plan&s=requirements`,
    }, actor.id);
    return { version, addedPhases: result.added };
  }

  async reject(actor: AuthUser, id: string, dto: DecisionDto) {
    const c = await this.decidable(actor, id);
    if (!dto.note?.trim()) throw new BadRequestException('A reason is required to reject');
    const r = await this.audit.tx(
      actor,
      { action: 'requirementChange.reject', entity: 'RequirementChange', entityId: () => id, after: () => ({ note: dto.note }) },
      (tx) => tx.requirementChange.update({ where: { id }, data: { status: RequirementChangeStatus.REJECTED, decidedById: actor.id, decidedAt: new Date(), decisionNote: dto.note!.trim() } }),
    );
    await this.notifications.notify(c.tenantId, [c.applicantId], { kind: 'REQUIREMENT_CHANGE_DECIDED', title: `项目要求变更被驳回：${c.code}`, body: dto.note!, link: `/initiations?tab=rc&id=${id}` }, actor.id);
    return r;
  }
}

/** DTO 实例里未提交的字段是 undefined，合并时不能覆盖当前版本 */
function defined<T extends object>(v: T | undefined): Partial<T> {
  return Object.fromEntries(Object.entries(v ?? {}).filter(([, x]) => x !== undefined)) as Partial<T>;
}
