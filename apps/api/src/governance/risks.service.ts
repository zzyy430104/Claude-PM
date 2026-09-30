import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { IssueStatus, RiskStatus } from '../generated/prisma/enums.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthUser } from '../common/auth.types.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ProjectAccess } from '../projects/access.service.js';
import { ActionInputDto, CreateRiskDto, UpdateRiskDto } from './dto.js';
import { IssuesService } from './issues.service.js';

const PROBABILITY_PERCENT = [0, 10, 30, 50, 70, 90];

/** 风险与机会登记册（8.1.3.9）：每条都带成本收益分析 */
@Injectable()
export class RisksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: ProjectAccess,
    private readonly issues: IssuesService,
  ) {}

  async list(actor: AuthUser, projectId: string) {
    const ctx = await this.access.load(actor, projectId);
    const risks = await this.prisma.risk.findMany({
      where: { projectId, tenantId: ctx.tenantId },
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    });
    const actions = await this.prisma.issue.groupBy({
      by: ['riskId', 'status'],
      where: { projectId, tenantId: ctx.tenantId, riskId: { not: null } },
      _count: true,
    });
    return risks.map((r) => {
      const exposure = Number(r.exposureAmount);
      const expected = (exposure * PROBABILITY_PERCENT[r.probability]) / 100;
      return {
        ...r,
        score: r.probability * r.impact,
        expectedValue: expected,
        /** 期望价值减应对成本：为正说明应对措施划算 */
        netBenefitOfResponse: expected - Number(r.responseCost),
        openActions: actions.filter((a) => a.riskId === r.id && a.status === IssueStatus.OPEN).reduce((n, a) => n + a._count, 0),
        closedActions: actions.filter((a) => a.riskId === r.id && a.status === IssueStatus.CLOSED).reduce((n, a) => n + a._count, 0),
      };
    });
  }

  async create(actor: AuthUser, projectId: string, dto: CreateRiskDto) {
    const ctx = await this.access.load(actor, projectId);
    this.access.requireOpen(ctx);
    if (!ctx.member && !ctx.isManager) throw new ForbiddenException('Project members only');
    await this.issues.checkOwner(ctx.tenantId, projectId, dto.ownerId);
    return this.audit.tx(
      actor,
      { action: 'risk.create', entity: 'Risk', entityId: (r) => r.id, after: (r) => ({ kind: r.kind, title: r.title, score: r.probability * r.impact }) },
      (tx) => tx.risk.create({ data: { ...dto, tenantId: ctx.tenantId, projectId, createdById: actor.id } }),
    );
  }

  async update(actor: AuthUser, projectId: string, id: string, dto: UpdateRiskDto) {
    const ctx = await this.access.load(actor, projectId);
    this.access.requireOpen(ctx);
    const risk = await this.prisma.risk.findFirst({ where: { id, projectId, tenantId: ctx.tenantId } });
    if (!risk) throw new NotFoundException('Risk not found');
    if (!ctx.isManager && !ctx.isQuality && risk.ownerId !== actor.id) {
      throw new ForbiddenException('Only the owner or project management can update this entry');
    }
    await this.issues.checkOwner(ctx.tenantId, projectId, dto.ownerId);
    if (dto.status === RiskStatus.CLOSED && !dto.closureNote?.trim()) {
      throw new BadRequestException('closureNote is required to close an entry');
    }
    const { reviewed, ...rest } = dto;
    return this.audit.tx(
      actor,
      {
        action: 'risk.update',
        entity: 'Risk',
        entityId: () => id,
        before: { status: risk.status, probability: risk.probability, impact: risk.impact },
        after: (r) => ({ status: r.status, probability: r.probability, impact: r.impact }),
      },
      (tx) => tx.risk.update({ where: { id }, data: { ...rest, ...(reviewed ? { lastReviewedAt: new Date() } : {}) } }),
    );
  }

  /** 为风险 / 机会登记应对行动，其状态会出现在项目评审中 */
  async addAction(actor: AuthUser, projectId: string, id: string, dto: ActionInputDto) {
    const ctx = await this.access.load(actor, projectId);
    this.access.requireOpen(ctx);
    const risk = await this.prisma.risk.findFirst({ where: { id, projectId, tenantId: ctx.tenantId } });
    if (!risk) throw new NotFoundException('Risk not found');
    if (!ctx.isManager && !ctx.isQuality && risk.ownerId !== actor.id) throw new ForbiddenException('Owner or project management required');
    await this.issues.checkOwner(ctx.tenantId, projectId, dto.ownerId);
    return this.audit.tx(
      actor,
      { action: 'risk.addAction', entity: 'Risk', entityId: () => id, after: () => ({ title: dto.title }) },
      (tx) => this.issues.insert(tx, ctx.tenantId, projectId, actor.id, { kind: 'ACTION', title: dto.title, ownerId: dto.ownerId, dueDate: dto.dueDate, source: 'RISK', riskId: id }),
    );
  }
}
