import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { WpStatus } from '../generated/prisma/enums.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthUser } from '../common/auth.types.js';
import { asRequirements } from '../initiations/requirements.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ProjectAccess } from '../projects/access.service.js';
import { CostControlService, costChecks } from '../projects/cost-control.service.js';
import { CommitmentDto, WpCostDto, WpEtcDto } from './cost.dto.js';

const money = (n: number) => Math.round(n * 100) / 100;

/**
 * 成本策划（「计划 → 成本策划」）与执行控制（「控制 → 成本」里的工作包超支）：
 * 成本上限（项目要求）≥ 目标成本（项目预算）≥ 科目预算合计 ≥ 工作包预算合计。
 */
@Injectable()
export class CostPlanService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: ProjectAccess,
    private readonly cost: CostControlService,
  ) {}

  /** 成本上限、目标成本、科目与工作包预算，以及计划批准时的检查 */
  async summary(actor: AuthUser, projectId: string) {
    const ctx = await this.access.load(actor, projectId);
    const p = ctx.project;
    const ver = p.requirementVersion ? await this.prisma.projectRequirementVersion.findUnique({ where: { projectId_version: { projectId, version: p.requirementVersion } } }) : null;
    const cap = ver ? asRequirements(ver.data).cost.cap || null : null;
    const [accounts, wps] = await Promise.all([
      this.prisma.costAccount.findMany({ where: { projectId, tenantId: ctx.tenantId }, orderBy: { code: 'asc' } }),
      this.cost.wpCosts(ctx.tenantId, projectId),
    ]);
    const labor = accounts.find((a) => a.isLabor);
    const wpTotals = new Map<string, number>();
    for (const w of wps) {
      if (labor) wpTotals.set(labor.id, (wpTotals.get(labor.id) ?? 0) + w.labor);
      for (const l of w.lines) wpTotals.set(l.accountId, (wpTotals.get(l.accountId) ?? 0) + l.amount);
    }
    const rows = accounts.map((a) => ({ id: a.id, code: a.code, name: a.name, isLabor: a.isLabor, budget: Number(a.budget), wpTotal: money(wpTotals.get(a.id) ?? 0) }));
    const accSum = money(rows.reduce((n, a) => n + a.budget, 0));
    const wpSum = money(wps.reduce((n, w) => n + w.budget, 0));
    const target = p.budget !== null ? Number(p.budget) : null;
    return { cap, target, accSum, wpSum, accounts: rows, workPackages: wps, checks: costChecks(cap, target, accSum, wpSum, rows, wps), eac: money(wps.reduce((n, w) => n + w.eac, 0)), alarm: p.costAlert };
  }

  /** 没有科目时建默认科目 */
  async ensureAccounts(actor: AuthUser, projectId: string) {
    const ctx = await this.access.load(actor, projectId);
    this.access.requireCan(ctx, 'COST_PLAN');
    return this.cost.ensureAccounts(this.prisma, ctx.tenantId, projectId);
  }

  /** 把每个科目的预算设为其工作包合计（不超过目标成本） */
  async syncAccounts(actor: AuthUser, projectId: string) {
    const s = await this.summary(actor, projectId);
    const ctx = await this.access.load(actor, projectId);
    this.access.requireCan(ctx, 'COST_PLAN');
    this.access.requireOpen(ctx);
    const total = s.accounts.reduce((n, a) => n + a.wpTotal, 0);
    if (s.target === null) throw new BadRequestException('Set the project budget (target cost) first');
    if (total > s.target) throw new ConflictException({ code: 'BUDGET_ALLOCATION_EXCEEDED', message: `Work package totals ${money(total)} exceed the target cost ${s.target}` });
    await this.audit.tx(
      actor,
      { action: 'costAccount.sync', entity: 'Project', entityId: () => projectId, after: () => ({ accounts: s.accounts.map((a) => ({ code: a.code, budget: a.wpTotal })) }) },
      async (tx) => { for (const a of s.accounts) await tx.costAccount.update({ where: { id: a.id }, data: { budget: a.wpTotal } }); },
    );
    return this.summary(actor, projectId);
  }

  /** 工作包预算：人天、费率（手工改须写原因）、费用行 */
  async setWpCost(actor: AuthUser, projectId: string, wpId: string, dto: WpCostDto) {
    const ctx = await this.access.load(actor, projectId);
    this.access.requireCan(ctx, 'COST_PLAN');
    this.access.requireOpen(ctx);
    const wp = await this.prisma.workPackage.findFirst({ where: { id: wpId, projectId, tenantId: ctx.tenantId }, include: { _count: { select: { children: true } }, costLines: true } });
    if (!wp) throw new NotFoundException('Work package not found');
    if (wp._count.children > 0) throw new BadRequestException('Budgets are set on leaf work packages');
    if (wp.status === WpStatus.VERIFIED) throw new ConflictException('Verified work package is locked');
    const role = wp.functionalRoleId ? await this.prisma.functionalRole.findUnique({ where: { id: wp.functionalRoleId } }) : null;
    const std = Number(role?.rate ?? 0);
    const rate = dto.laborRate === undefined ? (wp.laborRate !== null ? Number(wp.laborRate) : null) : dto.laborRate;
    const overridden = rate !== null && rate !== std;
    const reason = dto.laborRateReason?.trim() ?? wp.laborRateReason ?? '';
    if (overridden && !reason) throw new BadRequestException({ code: 'RATE_REASON_REQUIRED', message: 'A reason is required when the labour rate differs from the standard rate' });
    let accounts = await this.prisma.costAccount.findMany({ where: { projectId, tenantId: ctx.tenantId } });
    if (!accounts.length) accounts = await this.cost.ensureAccounts(this.prisma, ctx.tenantId, projectId);
    const labor = accounts.find((a) => a.isLabor);
    if (dto.lines?.some((l) => !accounts.some((a) => a.id === l.accountId && !a.isLabor))) throw new BadRequestException('Unknown cost account for a cost line');
    await this.audit.tx(
      actor,
      {
        action: 'workPackage.cost', entity: 'WorkPackage', entityId: () => wpId,
        before: { budget: wp.budget?.toString() ?? null, personDays: wp.resourceDays?.toString() ?? null, rate: wp.laborRate?.toString() ?? null, lines: wp.costLines.map((l) => ({ accountId: l.accountId, amount: l.amount.toString() })) },
        after: () => ({ personDays: dto.personDays ?? null, rate, reason: overridden ? reason : null, lines: dto.lines?.map((l) => ({ accountId: l.accountId, amount: l.amount, description: l.description ?? '' })) ?? null }),
      },
      async (tx) => {
        await tx.workPackage.update({
          where: { id: wpId },
          data: {
            resourceDays: dto.personDays, laborRate: overridden ? rate : null, laborRateReason: overridden ? reason : null,
            costAccountId: wp.costAccountId ?? labor?.id ?? null,
          },
        });
        if (dto.lines) {
          await tx.wpCostLine.deleteMany({ where: { workPackageId: wpId } });
          if (dto.lines.length) {
            await tx.wpCostLine.createMany({ data: dto.lines.map((l) => ({ tenantId: ctx.tenantId, projectId, workPackageId: wpId, accountId: l.accountId, description: l.description?.trim() ?? '', amount: l.amount })) });
          }
        }
        await this.cost.recomputeBudget(tx, wpId);
      },
    );
    await this.cost.evaluate(ctx.tenantId, projectId);
    return (await this.cost.wpCosts(ctx.tenantId, projectId)).find((w) => w.id === wpId);
  }

  /** 负责人或项目经理填写“还需多少”（为空恢复按比例推算） */
  async setEtc(actor: AuthUser, projectId: string, wpId: string, dto: WpEtcDto) {
    const ctx = await this.access.load(actor, projectId);
    this.access.requireOpen(ctx);
    const wp = await this.prisma.workPackage.findFirst({ where: { id: wpId, projectId, tenantId: ctx.tenantId } });
    if (!wp) throw new NotFoundException('Work package not found');
    if (!ctx.perms.COST_PLAN && wp.ownerId !== actor.id) throw new ForbiddenException('Manager or owner required');
    await this.audit.tx(
      actor,
      { action: 'workPackage.etc', entity: 'WorkPackage', entityId: () => wpId, before: { etc: wp.estimateToComplete?.toString() ?? null }, after: () => ({ etc: dto.etc }) },
      (tx) => tx.workPackage.update({ where: { id: wpId }, data: { estimateToComplete: dto.etc } }),
    );
    await this.cost.evaluate(ctx.tenantId, projectId);
    return (await this.cost.wpCosts(ctx.tenantId, projectId)).find((w) => w.id === wpId);
  }

  async commitments(actor: AuthUser, projectId: string) {
    const ctx = await this.access.load(actor, projectId);
    return this.prisma.costCommitment.findMany({ where: { projectId, tenantId: ctx.tenantId }, orderBy: [{ entryDate: 'desc' }, { createdAt: 'desc' }], take: 500 });
  }

  /** 承诺成本：已下单未结算；结算后登记负数冲减 */
  async addCommitment(actor: AuthUser, projectId: string, dto: CommitmentDto) {
    const ctx = await this.access.load(actor, projectId);
    this.access.requireCan(ctx, 'COST_ACTUAL');
    this.access.requireOpen(ctx);
    if (dto.amount === 0) throw new BadRequestException('amount must not be zero');
    const account = await this.prisma.costAccount.findFirst({ where: { id: dto.accountId, projectId, tenantId: ctx.tenantId } });
    if (!account) throw new BadRequestException('Cost account not found in this project');
    if (dto.workPackageId && !(await this.prisma.workPackage.findFirst({ where: { id: dto.workPackageId, projectId, tenantId: ctx.tenantId } }))) throw new BadRequestException('Work package not found in this project');
    const row = await this.audit.tx(
      actor,
      { action: 'costCommitment.create', entity: 'CostCommitment', entityId: (c) => c.id, after: (c) => ({ account: account.code, amount: c.amount.toString() }) },
      (tx) => tx.costCommitment.create({ data: { tenantId: ctx.tenantId, projectId, accountId: account.id, workPackageId: dto.workPackageId, amount: dto.amount, entryDate: new Date(dto.entryDate), description: dto.description, createdById: actor.id } }),
    );
    await this.cost.evaluate(ctx.tenantId, projectId);
    return row;
  }
}
