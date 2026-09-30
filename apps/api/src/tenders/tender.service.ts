import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { ProjectRole, Role, TenderStatus } from '../generated/prisma/enums.js';
import { AuditService } from '../audit/audit.service.js';
import { requireTenantId } from '../common/auth.types.js';
import type { AuthUser } from '../common/auth.types.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ConvertTenderDto, CreateTenderDto, TenderDecisionDto, UpdateTenderDto } from './tender.dto.js';
import { DEFAULT_PHASES } from '../projects/templates.service.js';

const READERS: Role[] = [Role.TENANT_ADMIN, Role.TOP_MANAGEMENT, Role.PROJECT_MANAGER, Role.FUNCTION_MANAGER];
const WRITERS: Role[] = [Role.TENANT_ADMIN, Role.PROJECT_MANAGER];

/** 投标管理（8.1.2）：需求、风险与机会（含金额评估）、组织知识输入、交付物与成本策划、资源计划、报价审批 */
@Injectable()
export class TenderService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(actor: AuthUser) {
    this.requireRole(actor, READERS);
    return this.prisma.tender.findMany({ where: { tenantId: requireTenantId(actor) }, orderBy: { createdAt: 'desc' } });
  }

  async get(actor: AuthUser, id: string) {
    this.requireRole(actor, READERS);
    return this.find(actor, id);
  }

  async create(actor: AuthUser, dto: CreateTenderDto) {
    this.requireRole(actor, WRITERS);
    const tenantId = requireTenantId(actor);
    try {
      return await this.audit.tx(
        actor,
        { action: 'tender.create', entity: 'Tender', entityId: (t) => t.id, after: (t) => ({ code: t.code, customer: t.customer }) },
        (tx) => tx.tender.create({ data: { ...dto, tenantId, createdById: actor.id } }),
      );
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new ConflictException('Tender code already exists');
      throw e;
    }
  }

  async update(actor: AuthUser, id: string, dto: UpdateTenderDto) {
    this.requireRole(actor, WRITERS);
    const t = await this.find(actor, id);
    if (t.status !== TenderStatus.DRAFT) throw new ConflictException('Only drafts can be edited');
    return this.audit.tx(actor, { action: 'tender.update', entity: 'Tender', entityId: () => id }, (tx) => tx.tender.update({ where: { id }, data: dto }));
  }

  /** 提交评审：8.1.2 要求的各项内容必须齐全 */
  async submit(actor: AuthUser, id: string) {
    this.requireRole(actor, WRITERS);
    const t = await this.find(actor, id);
    if (t.status !== TenderStatus.DRAFT) throw new ConflictException('Only drafts can be submitted');
    const problems: string[] = [];
    if (!t.requirements.trim()) problems.push('需求管理：客户需求必须记录');
    if (!t.riskAssessment.trim() || Number(t.riskExposure) <= 0) problems.push('风险与机会管理：必须有评估，并给出金额评估');
    if (!t.knowledgeInputs.trim()) problems.push('组织知识输入：必须说明参考了哪些经验教训');
    if (!t.deliverablesPlan.trim() || Number(t.estimatedCost) <= 0) problems.push('交付物策划：必须包含成本');
    if (!t.resourcePlan.trim()) problems.push('合同执行资源计划必填');
    if (Number(t.offerPrice) <= 0) problems.push('报价必填');
    if (problems.length) throw new BadRequestException({ code: 'TENDER_INCOMPLETE', message: problems.join('；'), problems });
    return this.transition(actor, id, 'tender.submit', { status: TenderStatus.IN_REVIEW });
  }

  /** 报价审批：只有最高管理层可批准（投标由项目经理或企业管理员编制，二者都无权审批） */
  async approve(actor: AuthUser, id: string, dto: TenderDecisionDto) {
    await this.decisionGuard(actor, id);
    return this.transition(actor, id, 'tender.approve', { status: TenderStatus.APPROVED, decidedById: actor.id, decidedAt: new Date(), decisionNote: dto.note });
  }

  async reject(actor: AuthUser, id: string, dto: TenderDecisionDto) {
    await this.decisionGuard(actor, id);
    return this.transition(actor, id, 'tender.reject', { status: TenderStatus.REJECTED, decidedById: actor.id, decidedAt: new Date(), decisionNote: dto.note });
  }

  async outcome(actor: AuthUser, id: string, won: boolean) {
    this.requireRole(actor, WRITERS);
    const t = await this.find(actor, id);
    if (t.status !== TenderStatus.APPROVED) throw new ConflictException('Only approved offers can be marked won or lost');
    return this.transition(actor, id, won ? 'tender.won' : 'tender.lost', { status: won ? TenderStatus.WON : TenderStatus.LOST });
  }

  /** 中标后转为项目：项目预算取自投标成本测算（8.1.3.5 a），并带出客户交期 */
  async convert(actor: AuthUser, id: string, dto: ConvertTenderDto) {
    this.requireRole(actor, WRITERS);
    const tenantId = requireTenantId(actor);
    const t = await this.find(actor, id);
    if (t.status !== TenderStatus.WON) throw new ConflictException('Only won tenders can be converted to a project');
    if (t.convertedProjectId) throw new ConflictException('Already converted');
    if (new Date(dto.endDate) < new Date(dto.startDate)) throw new BadRequestException('endDate must not be before startDate');
    const interval = { LOW: 60, MEDIUM: 30, HIGH: 14 }[dto.riskLevel];
    try {
      return await this.audit.tx(
        actor,
        { action: 'tender.convert', entity: 'Tender', entityId: () => id, after: (p) => ({ projectId: p.id, code: p.code }) },
        async (tx) => {
          const project = await tx.project.create({
            data: {
              tenantId, code: dto.code, name: t.title, description: `由投标 ${t.code}（${t.customer}）转入`, riskLevel: dto.riskLevel,
              startDate: new Date(dto.startDate), endDate: new Date(dto.endDate),
              customerDeliveryDate: dto.customerDeliveryDate ? new Date(dto.customerDeliveryDate) : undefined,
              budget: t.estimatedCost, reviewIntervalDays: interval, createdById: actor.id, tenderId: t.id,
            },
          });
          await tx.phase.createMany({
            data: DEFAULT_PHASES.map((p, i) => ({ tenantId, projectId: project.id, name: p.name, order: i + 1, checklist: [...p.checklist], mandatoryRoles: [...p.mandatoryRoles] })),
          });
          // 投标阶段已由本次投标完成，从投标转入的项目默认由创建者担任项目经理
          await tx.projectMember.create({ data: { tenantId, projectId: project.id, userId: actor.id, projectRole: ProjectRole.PROJECT_MANAGER, isCcb: true } });
          await tx.tender.update({ where: { id }, data: { convertedProjectId: project.id } });
          return project;
        },
      );
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new ConflictException('Project code already exists');
      throw e;
    }
  }

  private async decisionGuard(actor: AuthUser, id: string) {
    if (actor.role !== Role.TOP_MANAGEMENT) throw new ForbiddenException('Top management required');
    const t = await this.find(actor, id);
    if (t.status !== TenderStatus.IN_REVIEW) throw new ConflictException('Only offers in review can be decided');
    return t;
  }

  private transition(actor: AuthUser, id: string, action: string, data: Prisma.TenderUpdateInput) {
    return this.audit.tx(actor, { action, entity: 'Tender', entityId: () => id, after: (t) => ({ status: t.status }) }, (tx) => tx.tender.update({ where: { id }, data }));
  }

  private requireRole(actor: AuthUser, roles: Role[]) {
    requireTenantId(actor);
    if (!roles.includes(actor.role)) throw new ForbiddenException('Insufficient role');
  }

  private async find(actor: AuthUser, id: string) {
    const t = await this.prisma.tender.findFirst({ where: { id, tenantId: requireTenantId(actor) } });
    if (!t) throw new NotFoundException('Tender not found');
    return t;
  }
}
