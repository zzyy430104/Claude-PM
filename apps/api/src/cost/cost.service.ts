import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthUser } from '../common/auth.types.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ProjectAccess, ProjectCtx } from '../projects/access.service.js';
import { CreateCostAccountDto, CreateCostEntryDto, UpdateCostAccountDto } from './cost.dto.js';

const money = (n: number) => Math.round(n * 100) / 100;

/** 项目成本管理（8.1.3.5）：预算按成本科目分解，定期对比实际成本与完工估算（EAC） */
@Injectable()
export class CostService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: ProjectAccess,
  ) {}

  /** 各科目的预算、实际、完工尚需（ETC）、完工估算（EAC）与偏差 */
  async summary(actor: AuthUser, projectId: string) {
    const ctx = await this.access.load(actor, projectId);
    const [accounts, sums] = await Promise.all([
      this.prisma.costAccount.findMany({ where: { projectId, tenantId: ctx.tenantId }, orderBy: { code: 'asc' } }),
      this.prisma.costEntry.groupBy({ by: ['accountId'], where: { projectId, tenantId: ctx.tenantId }, _sum: { amount: true } }),
    ]);
    const actualBy = new Map(sums.map((s) => [s.accountId, Number(s._sum.amount ?? 0)]));
    const rows = accounts.map((a) => {
      const budget = Number(a.budget);
      const actual = money(actualBy.get(a.id) ?? 0);
      const etc = a.estimateToComplete !== null ? Number(a.estimateToComplete) : Math.max(money(budget - actual), 0);
      const eac = money(actual + etc);
      return {
        id: a.id, code: a.code, name: a.name, budget, actual, etc,
        etcIsManual: a.estimateToComplete !== null,
        eac, variance: money(budget - eac), overrun: eac > budget,
      };
    });
    const projectBudget = ctx.project.budget ? Number(ctx.project.budget) : null;
    const allocated = money(rows.reduce((n, r) => n + r.budget, 0));
    const actual = money(rows.reduce((n, r) => n + r.actual, 0));
    const eac = money(rows.reduce((n, r) => n + r.eac, 0));
    return {
      projectBudget,
      allocated,
      unallocated: projectBudget !== null ? money(projectBudget - allocated) : null,
      actual,
      eac,
      /** 项目预算 − 各科目 EAC 之和；为负说明预计超支 */
      variance: projectBudget !== null ? money(projectBudget - eac) : null,
      overrun: projectBudget !== null && eac > projectBudget,
      accounts: rows,
    };
  }

  async entries(actor: AuthUser, projectId: string) {
    const ctx = await this.access.load(actor, projectId);
    return this.prisma.costEntry.findMany({
      where: { projectId, tenantId: ctx.tenantId },
      orderBy: [{ entryDate: 'desc' }, { createdAt: 'desc' }],
      take: 500,
    });
  }

  async createAccount(actor: AuthUser, projectId: string, dto: CreateCostAccountDto) {
    const ctx = await this.access.load(actor, projectId);
    this.access.requireManager(ctx);
    this.access.requireOpen(ctx);
    await this.checkAllocation(ctx, dto.budget);
    try {
      return await this.audit.tx(
        actor,
        { action: 'costAccount.create', entity: 'CostAccount', entityId: (a) => a.id, after: (a) => ({ code: a.code, budget: a.budget.toString() }) },
        (tx) => tx.costAccount.create({ data: { tenantId: ctx.tenantId, projectId, code: dto.code, name: dto.name, budget: dto.budget } }),
      );
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new ConflictException('Cost account code already exists');
      throw e;
    }
  }

  async updateAccount(actor: AuthUser, projectId: string, id: string, dto: UpdateCostAccountDto) {
    const ctx = await this.access.load(actor, projectId);
    this.access.requireManager(ctx);
    this.access.requireOpen(ctx);
    const a = await this.prisma.costAccount.findFirst({ where: { id, projectId, tenantId: ctx.tenantId } });
    if (!a) throw new NotFoundException('Cost account not found');
    if (dto.budget !== undefined) await this.checkAllocation(ctx, dto.budget, id);
    return this.audit.tx(
      actor,
      {
        action: 'costAccount.update', entity: 'CostAccount', entityId: () => id,
        before: { budget: a.budget.toString(), etc: a.estimateToComplete?.toString() ?? null },
        after: (x) => ({ budget: x.budget.toString(), etc: x.estimateToComplete?.toString() ?? null }),
      },
      (tx) => tx.costAccount.update({ where: { id }, data: { name: dto.name, budget: dto.budget, estimateToComplete: dto.estimateToComplete } }),
    );
  }

  async addEntry(actor: AuthUser, projectId: string, dto: CreateCostEntryDto) {
    const ctx = await this.access.load(actor, projectId);
    this.access.requireManager(ctx);
    this.access.requireOpen(ctx);
    if (dto.amount === 0) throw new BadRequestException('amount must not be zero');
    const account = await this.prisma.costAccount.findFirst({ where: { id: dto.accountId, projectId, tenantId: ctx.tenantId } });
    if (!account) throw new BadRequestException('Cost account not found in this project');
    if (dto.workPackageId && !(await this.prisma.workPackage.findFirst({ where: { id: dto.workPackageId, projectId, tenantId: ctx.tenantId } }))) {
      throw new BadRequestException('Work package not found in this project');
    }
    const current = await this.prisma.costEntry.aggregate({ where: { accountId: account.id }, _sum: { amount: true } });
    if (Number(current._sum.amount ?? 0) + dto.amount < 0) {
      throw new BadRequestException('A reversal cannot make the account total negative');
    }
    return this.audit.tx(
      actor,
      { action: 'costEntry.create', entity: 'CostEntry', entityId: (e) => e.id, after: (e) => ({ account: account.code, amount: e.amount.toString() }) },
      (tx) =>
        tx.costEntry.create({
          data: { tenantId: ctx.tenantId, projectId, accountId: account.id, workPackageId: dto.workPackageId, amount: dto.amount, entryDate: new Date(dto.entryDate), description: dto.description, createdById: actor.id },
        }),
    );
  }

  /** 各科目预算之和不得超过项目预算（预算分配依据投标测算，超出须走预算变更） */
  private async checkAllocation(ctx: ProjectCtx, newBudget: number, excludeId?: string) {
    if (ctx.project.budget === null) throw new BadRequestException('Set the project budget before allocating it to cost accounts');
    const others = await this.prisma.costAccount.aggregate({
      where: { projectId: ctx.project.id, tenantId: ctx.tenantId, ...(excludeId ? { NOT: { id: excludeId } } : {}) },
      _sum: { budget: true },
    });
    const total = Number(others._sum.budget ?? 0) + newBudget;
    if (total > Number(ctx.project.budget)) {
      throw new ConflictException({ code: 'BUDGET_ALLOCATION_EXCEEDED', message: `Cost accounts would total ${money(total)}, exceeding the project budget ${ctx.project.budget}` });
    }
  }
}
