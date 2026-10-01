import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { ApprovalRoleKind, InitiationStatus, Role } from '../generated/prisma/enums.js';
import { AuditService } from '../audit/audit.service.js';
import { requireTenantId } from '../common/auth.types.js';
import type { AuthUser } from '../common/auth.types.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ApprovalRolesService } from './approval-roles.service.js';
import type { DecisionDto, OpinionDto, SaveInitiationDto } from './dto.js';
import { PlanBuilderService } from './plan-builder.service.js';
import { asRequirements, requirementProblems, TYPE_LABEL } from './requirements.js';

const EDITABLE: InitiationStatus[] = [InitiationStatus.DRAFT, InitiationStatus.REJECTED];
const day = (s: string) => new Date(s);

/**
 * 立项：申请人提交（合同或库存计划 → 项目要求），可选会签，立项批准人批准后生成项目。
 * 申请人不能批准、也不能会签自己的申请；批准不能撤销，之后改项目要求走“项目要求变更”。
 */
@Injectable()
export class InitiationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly roles: ApprovalRolesService,
    private readonly builder: PlanBuilderService,
    private readonly notifications: NotificationsService,
  ) {}

  /** 能看到立项管理的人：申请人、批准人、会签人、企业管理员、高层 */
  private async canView(actor: AuthUser) {
    if (actor.role === Role.TENANT_ADMIN || actor.role === Role.TOP_MANAGEMENT) return true;
    const m = await this.roles.mine(actor);
    return m.initiator || m.approver || m.cosigner;
  }

  async list(actor: AuthUser) {
    const tenantId = requireTenantId(actor);
    if (!(await this.canView(actor))) throw new ForbiddenException('Not allowed to view initiations');
    return this.prisma.initiation.findMany({ where: { tenantId }, orderBy: { createdAt: 'desc' }, include: { opinions: true } });
  }

  async get(actor: AuthUser, id: string) {
    const tenantId = requireTenantId(actor);
    const i = await this.prisma.initiation.findFirst({ where: { id, tenantId }, include: { opinions: { orderBy: { createdAt: 'asc' } } } });
    if (!i) throw new NotFoundException('Initiation not found');
    if (i.applicantId !== actor.id && !(await this.canView(actor))) throw new NotFoundException('Initiation not found');
    const [mine, cosigners] = await Promise.all([this.roles.mine(actor), this.cosigners(tenantId)]);
    return {
      ...i,
      problems: requirementProblems(i, asRequirements(i.requirements)),
      cosigners,
      can: {
        edit: i.applicantId === actor.id && EDITABLE.includes(i.status),
        submit: i.applicantId === actor.id && EDITABLE.includes(i.status),
        withdraw: i.applicantId === actor.id && !([InitiationStatus.APPROVED, InitiationStatus.WITHDRAWN] as InitiationStatus[]).includes(i.status),
        cosign: i.status === InitiationStatus.COSIGN && i.applicantId !== actor.id && cosigners.includes(actor.id) && !i.opinions.some((o) => o.userId === actor.id),
        decide: i.status === InitiationStatus.PENDING && i.applicantId !== actor.id && mine.approver,
      },
    };
  }

  private async cosigners(tenantId: string): Promise<string[]> {
    const t = await this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { requireCosign: true } });
    return t.requireCosign ? this.roles.usersFor(tenantId, ApprovalRoleKind.COSIGNER) : [];
  }

  private async nextCode(tenantId: string, prefix: string, table: 'initiation' | 'requirementChange') {
    const year = new Date().getFullYear();
    const like = `${prefix}-${year}-`;
    const rows = table === 'initiation'
      ? await this.prisma.initiation.findMany({ where: { tenantId, code: { startsWith: like } }, select: { code: true } })
      : await this.prisma.requirementChange.findMany({ where: { tenantId, code: { startsWith: like } }, select: { code: true } });
    const n = Math.max(0, ...rows.map((r) => Number(r.code.slice(like.length)) || 0)) + 1;
    return `${like}${String(n).padStart(3, '0')}`;
  }

  private async checkPm(tenantId: string, id: string | null | undefined) {
    if (!id) return;
    const u = await this.prisma.user.findFirst({ where: { id, tenantId, active: true } });
    if (!u) throw new BadRequestException('Unknown project manager');
  }

  private data(dto: SaveInitiationDto) {
    return {
      name: dto.name, projectCode: dto.projectCode, type: dto.type, riskLevel: dto.riskLevel, productFamily: dto.productFamily,
      proposedPmId: dto.proposedPmId, customer: dto.customer, contractNo: dto.contractNo, contractAmount: dto.contractAmount,
      startDate: dto.startDate === undefined ? undefined : dto.startDate ? day(dto.startDate) : null,
      requirements: dto.requirements ? (dto.requirements as unknown as Prisma.InputJsonValue) : undefined,
    };
  }

  async create(actor: AuthUser, dto: SaveInitiationDto) {
    const tenantId = requireTenantId(actor);
    if (!(await this.roles.has(actor, ApprovalRoleKind.INITIATOR))) throw new ForbiddenException('Not an initiator');
    if (!dto.name?.trim()) throw new BadRequestException('name is required');
    await this.checkPm(tenantId, dto.proposedPmId);
    for (let attempt = 0; ; attempt++) {
      const code = await this.nextCode(tenantId, 'LX', 'initiation');
      try {
        return await this.audit.tx(
          actor,
          { action: 'initiation.create', entity: 'Initiation', entityId: (r) => r.id, after: (r) => ({ code: r.code, name: r.name, type: r.type }) },
          (tx) => tx.initiation.create({ data: { ...this.data(dto), name: dto.name!.trim(), tenantId, code, applicantId: actor.id } }),
        );
      } catch (e) {
        if (attempt < 3 && e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') continue;
        throw e;
      }
    }
  }

  private async own(actor: AuthUser, id: string) {
    const tenantId = requireTenantId(actor);
    const i = await this.prisma.initiation.findFirst({ where: { id, tenantId } });
    if (!i) throw new NotFoundException('Initiation not found');
    if (i.applicantId !== actor.id) throw new ForbiddenException('Only the applicant can change this initiation');
    return i;
  }

  async update(actor: AuthUser, id: string, dto: SaveInitiationDto) {
    const i = await this.own(actor, id);
    if (!EDITABLE.includes(i.status)) throw new ConflictException('Only drafts or rejected initiations can be edited');
    await this.checkPm(i.tenantId, dto.proposedPmId);
    return this.audit.tx(
      actor,
      { action: 'initiation.update', entity: 'Initiation', entityId: () => id, after: () => ({ ...dto }) as unknown as Prisma.InputJsonValue },
      (tx) => tx.initiation.update({ where: { id }, data: this.data(dto) }),
    );
  }

  async submit(actor: AuthUser, id: string) {
    const i = await this.own(actor, id);
    if (!EDITABLE.includes(i.status)) throw new ConflictException('Already submitted');
    const problems = requirementProblems(i, asRequirements(i.requirements));
    if (problems.length) throw new BadRequestException({ code: 'INITIATION_INCOMPLETE', message: `缺少：${problems.join('、')}`, problems });
    const dup = await this.prisma.project.findFirst({ where: { tenantId: i.tenantId, code: i.projectCode } });
    if (dup) throw new ConflictException('Project code already exists');
    const cosigners = (await this.cosigners(i.tenantId)).filter((u) => u !== actor.id);
    const status = cosigners.length ? InitiationStatus.COSIGN : InitiationStatus.PENDING;
    const r = await this.audit.tx(
      actor,
      { action: 'initiation.submit', entity: 'Initiation', entityId: () => id, after: () => ({ status }) },
      async (tx) => {
        await tx.initiationOpinion.deleteMany({ where: { initiationId: id } });
        return tx.initiation.update({ where: { id }, data: { status, submittedAt: new Date(), decidedAt: null, decidedById: null, decisionNote: null } });
      },
    );
    const to = cosigners.length ? cosigners : await this.roles.usersFor(i.tenantId, ApprovalRoleKind.APPROVER);
    await this.notifications.notify(i.tenantId, to, {
      kind: cosigners.length ? 'INITIATION_COSIGN' : 'INITIATION_SUBMITTED',
      title: `${cosigners.length ? '立项待会签' : '立项待审批'}：${i.name}（${TYPE_LABEL[i.type]}）`, body: i.code, link: `/initiations/${id}`,
    }, actor.id);
    return r;
  }

  async opinion(actor: AuthUser, id: string, dto: OpinionDto) {
    const tenantId = requireTenantId(actor);
    const i = await this.prisma.initiation.findFirst({ where: { id, tenantId }, include: { opinions: true } });
    if (!i) throw new NotFoundException('Initiation not found');
    if (i.status !== InitiationStatus.COSIGN) throw new ConflictException('Not waiting for co-signature');
    if (i.applicantId === actor.id) throw new ForbiddenException('The applicant cannot co-sign');
    const cosigners = (await this.cosigners(tenantId)).filter((u) => u !== i.applicantId);
    if (!cosigners.includes(actor.id)) throw new ForbiddenException('Not a co-signer');
    if (i.opinions.some((o) => o.userId === actor.id)) throw new ConflictException('Already co-signed');
    const done = cosigners.every((u) => u === actor.id || i.opinions.some((o) => o.userId === u));
    await this.audit.tx(
      actor,
      { action: 'initiation.cosign', entity: 'Initiation', entityId: () => id, after: () => ({ agree: dto.agree, opinion: dto.opinion, allDone: done }) },
      async (tx) => {
        await tx.initiationOpinion.create({ data: { tenantId, initiationId: id, userId: actor.id, agree: dto.agree, opinion: dto.opinion.trim() } });
        if (done) await tx.initiation.update({ where: { id }, data: { status: InitiationStatus.PENDING } });
      },
    );
    if (done) {
      await this.notifications.notify(tenantId, await this.roles.usersFor(tenantId, ApprovalRoleKind.APPROVER), {
        kind: 'INITIATION_SUBMITTED', title: `立项待审批：${i.name}（会签已完成）`, body: i.code, link: `/initiations/${id}`,
      }, actor.id);
    }
    return this.get(actor, id);
  }

  private async decidable(actor: AuthUser, id: string) {
    const tenantId = requireTenantId(actor);
    const i = await this.prisma.initiation.findFirst({ where: { id, tenantId } });
    if (!i) throw new NotFoundException('Initiation not found');
    if (i.status !== InitiationStatus.PENDING) throw new ConflictException('Not waiting for approval');
    if (i.applicantId === actor.id) throw new ForbiddenException('The applicant cannot approve their own initiation');
    if (!(await this.roles.has(actor, ApprovalRoleKind.APPROVER))) throw new ForbiddenException('Not an approver');
    return i;
  }

  async approve(actor: AuthUser, id: string, dto: DecisionDto) {
    const i = await this.decidable(actor, id);
    const req = asRequirements(i.requirements);
    const problems = requirementProblems(i, req);
    if (problems.length) throw new BadRequestException({ code: 'INITIATION_INCOMPLETE', message: `缺少：${problems.join('、')}`, problems });
    try {
      const result = await this.audit.tx(
        actor,
        { action: 'initiation.approve', entity: 'Initiation', entityId: () => id, after: (r) => ({ projectId: r.project.id, note: dto.note ?? '', removedFromTemplate: r.removed }) },
        async (tx) => {
          const built = await this.builder.createProject(tx, {
            tenantId: i.tenantId, actorId: actor.id, initiationId: i.id, code: i.projectCode, name: i.name, type: i.type,
            riskLevel: i.riskLevel, description: [i.customer && `客户：${i.customer}`, i.contractNo && `合同号：${i.contractNo}`].filter(Boolean).join('；'),
            startDate: i.startDate!, managerId: i.proposedPmId!, requirements: req,
          });
          await tx.initiation.update({ where: { id }, data: { status: InitiationStatus.APPROVED, decidedById: actor.id, decidedAt: new Date(), decisionNote: dto.note ?? null, projectId: built.project.id } });
          return built;
        },
      );
      await this.notifications.notify(i.tenantId, [i.applicantId, i.proposedPmId], {
        kind: 'INITIATION_DECIDED', title: `立项已批准：${i.name}`, body: '已生成项目和计划草稿，请项目经理开始策划', link: `/projects/${result.project.id}?g=plan&s=wbs`,
      }, actor.id);
      return { projectId: result.project.id, removed: result.removed };
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new ConflictException('Project code already exists');
      throw e;
    }
  }

  async reject(actor: AuthUser, id: string, dto: DecisionDto) {
    const i = await this.decidable(actor, id);
    if (!dto.note?.trim()) throw new BadRequestException('A reason is required to reject');
    const r = await this.audit.tx(
      actor,
      { action: 'initiation.reject', entity: 'Initiation', entityId: () => id, after: () => ({ note: dto.note }) },
      (tx) => tx.initiation.update({ where: { id }, data: { status: InitiationStatus.REJECTED, decidedById: actor.id, decidedAt: new Date(), decisionNote: dto.note!.trim() } }),
    );
    await this.notifications.notify(i.tenantId, [i.applicantId], { kind: 'INITIATION_DECIDED', title: `立项被驳回：${i.name}`, body: dto.note!, link: `/initiations/${id}` }, actor.id);
    return r;
  }

  async withdraw(actor: AuthUser, id: string) {
    const i = await this.own(actor, id);
    if (i.status === InitiationStatus.APPROVED || i.status === InitiationStatus.WITHDRAWN) throw new ConflictException('Cannot withdraw');
    return this.audit.tx(
      actor,
      { action: 'initiation.withdraw', entity: 'Initiation', entityId: () => id },
      (tx) => tx.initiation.update({ where: { id }, data: { status: InitiationStatus.WITHDRAWN } }),
    );
  }
}

