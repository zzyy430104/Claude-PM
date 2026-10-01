import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.js';
import { PurchaseStatus } from '../generated/prisma/enums.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthUser } from '../common/auth.types.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ProjectAccess, type ProjectCtx } from '../projects/access.service.js';
import { CostControlService } from '../projects/cost-control.service.js';
import { isOverdue, LIVE, purchaseChecks } from './checks.js';
import { OrderDto, PurchaseItemDto, ReceiveDto, SettleDto, UpdatePurchaseItemDto } from './dto.js';

type Tx = Prisma.TransactionClient | PrismaService;
const day = (d: Date) => d.toISOString().slice(0, 10);

/**
 * 采购计划（第 3 步）：物料清单、长周期标记、下单 / 到货 / 结算。
 * 下单生成承诺成本（已下单未结算），结算时转为实际成本；批准后修订计划内容需重新批准。
 * 项目经理和项目里职能角色为“采购”的成员可以编辑；项目经理批准。
 */
@Injectable()
export class PurchaseService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: ProjectAccess,
    private readonly cost: CostControlService,
  ) {}

  private async canEdit(ctx: ProjectCtx) {
    if (ctx.isManager) return true;
    if (!ctx.member) return false;
    const u = await this.prisma.user.findUnique({ where: { id: ctx.actor.id }, select: { functionalRoleId: true } });
    const role = u?.functionalRoleId ? await this.prisma.functionalRole.findUnique({ where: { id: u.functionalRoleId } }) : null;
    return !!role?.name.includes('采购');
  }
  private async editable(actor: AuthUser, projectId: string) {
    const ctx = await this.access.load(actor, projectId);
    this.access.requireOpen(ctx);
    if (!(await this.canEdit(ctx))) throw new ForbiddenException('Project manager or purchasing required');
    return ctx;
  }
  private async item(ctx: ProjectCtx, id: string) {
    const i = await this.prisma.purchaseItem.findFirst({ where: { id, projectId: ctx.project.id, tenantId: ctx.tenantId } });
    if (!i) throw new NotFoundException('Purchase item not found');
    return i;
  }
  private async plan(tx: Tx, tenantId: string, projectId: string) {
    await tx.purchasePlan.createMany({ data: [{ tenantId, projectId }], skipDuplicates: true });
    return tx.purchasePlan.findUniqueOrThrow({ where: { projectId } });
  }
  /** 计划内容有变化：已批准的计划变为待重新批准 */
  private async touch(tx: Tx, tenantId: string, projectId: string) {
    const p = await this.plan(tx, tenantId, projectId);
    if (p.version && !p.dirty) await tx.purchasePlan.update({ where: { id: p.id }, data: { dirty: true } });
  }
  private async refs(ctx: ProjectCtx, dto: { workPackageId?: string | null; accountId?: string | null }) {
    if (dto.workPackageId && !(await this.prisma.workPackage.findFirst({ where: { id: dto.workPackageId, projectId: ctx.project.id } }))) throw new BadRequestException('Work package not found in this project');
    if (dto.accountId && !(await this.prisma.costAccount.findFirst({ where: { id: dto.accountId, projectId: ctx.project.id } }))) throw new BadRequestException('Cost account not found in this project');
  }

  async get(actor: AuthUser, projectId: string) {
    const ctx = await this.access.load(actor, projectId);
    const [plan, items, wps, accounts, checks] = await Promise.all([
      this.prisma.purchasePlan.findUnique({ where: { projectId } }),
      this.prisma.purchaseItem.findMany({ where: { projectId, tenantId: ctx.tenantId }, orderBy: { code: 'asc' } }),
      this.prisma.workPackage.findMany({ where: { projectId, tenantId: ctx.tenantId }, select: { id: true, code: true, name: true, isPurchase: true }, orderBy: { code: 'asc' } }),
      this.prisma.costAccount.findMany({ where: { projectId, tenantId: ctx.tenantId }, select: { id: true, code: true, name: true }, orderBy: { code: 'asc' } }),
      purchaseChecks(this.prisma, ctx.tenantId, projectId),
    ]);
    const today = day(new Date());
    const live = items.filter((i) => LIVE.includes(i.status));
    const approver = plan?.approvedById ? await this.prisma.user.findUnique({ where: { id: plan.approvedById }, select: { name: true } }) : null;
    return {
      plan: { version: plan?.version ?? 0, approvedAt: plan?.approvedAt ?? null, approvedBy: approver?.name ?? null, dirty: plan?.dirty ?? false },
      items: items.map((i) => ({ ...i, amount: Number(i.amount), overdue: isOverdue(i, today), wp: wps.find((w) => w.id === i.workPackageId) ?? null })),
      stats: {
        items: live.length,
        workPackages: new Set(live.map((i) => i.workPackageId).filter(Boolean)).size,
        longLead: live.filter((i) => i.longLead).length,
        longLeadOrdered: live.filter((i) => i.longLead && i.status !== PurchaseStatus.PLANNED).length,
        receivedPct: live.length ? Math.round(live.reduce((n, i) => n + i.receivedPct, 0) / live.length) : 0,
        overdue: live.filter((i) => isOverdue(i, today)).map((i) => i.code),
        committed: live.filter((i) => (i.status === PurchaseStatus.ORDERED || i.status === PurchaseStatus.PARTIAL || i.status === PurchaseStatus.RECEIVED) && !i.settledAt).reduce((n, i) => n + Number(i.amount), 0),
      },
      checks: Object.values(checks),
      workPackages: wps,
      accounts,
      canEdit: ctx.project.status !== 'CLOSED' && (await this.canEdit(ctx)),
      canApprove: ctx.isManager,
    };
  }

  async create(actor: AuthUser, projectId: string, dto: PurchaseItemDto) {
    const ctx = await this.editable(actor, projectId);
    await this.refs(ctx, dto);
    const n = (await this.prisma.purchaseItem.findMany({ where: { projectId }, select: { code: true } })).map((i) => Number(i.code.replace(/\D/g, '')) || 0);
    const code = `M-${String((n.length ? Math.max(...n) : 0) + 1).padStart(2, '0')}`;
    return this.audit.tx(actor, { action: 'purchase.create', entity: 'PurchaseItem', entityId: (x) => x.id, after: (x) => ({ code: x.code, name: x.name, longLead: x.longLead }) }, async (tx) => {
      const x = await tx.purchaseItem.create({
        data: {
          tenantId: ctx.tenantId, projectId, code, name: dto.name.trim(), supplier: dto.supplier?.trim() ?? '', quantity: dto.quantity?.trim() ?? '',
          needDate: dto.needDate ? new Date(dto.needDate) : null, orderBy: dto.orderBy ? new Date(dto.orderBy) : null, longLead: dto.longLead ?? false,
          workPackageId: dto.workPackageId ?? null, accountId: dto.accountId ?? null, amount: dto.amount ?? 0, notes: dto.notes ?? '',
        },
      });
      await this.touch(tx, ctx.tenantId, projectId);
      return x;
    });
  }

  async update(actor: AuthUser, projectId: string, id: string, dto: UpdatePurchaseItemDto) {
    const ctx = await this.editable(actor, projectId);
    const i = await this.item(ctx, id);
    if (i.settledAt || i.status === PurchaseStatus.CANCELLED) throw new ConflictException('Settled or cancelled items are locked');
    await this.refs(ctx, dto);
    if (i.status !== PurchaseStatus.PLANNED && (dto.amount !== undefined || dto.accountId !== undefined)) throw new ConflictException({ code: 'PURCHASE_ORDERED', message: 'Amount and account are fixed once ordered' });
    const date = (v: string | null | undefined) => (v === undefined ? undefined : v ? new Date(v) : null);
    return this.audit.tx(actor, { action: 'purchase.update', entity: 'PurchaseItem', entityId: () => id, before: { name: i.name, supplier: i.supplier, needDate: i.needDate ? day(i.needDate) : null, longLead: i.longLead }, after: () => dto as unknown as Prisma.InputJsonValue }, async (tx) => {
      const x = await tx.purchaseItem.update({
        where: { id },
        data: {
          name: dto.name?.trim(), supplier: dto.supplier?.trim(), quantity: dto.quantity?.trim(), needDate: date(dto.needDate), orderBy: date(dto.orderBy),
          longLead: dto.longLead, workPackageId: dto.workPackageId, accountId: dto.accountId, amount: dto.amount, notes: dto.notes,
        },
      });
      await this.touch(tx, ctx.tenantId, projectId);
      return x;
    });
  }

  async remove(actor: AuthUser, projectId: string, id: string) {
    const ctx = await this.editable(actor, projectId);
    const i = await this.item(ctx, id);
    if (i.status !== PurchaseStatus.PLANNED) throw new ConflictException({ code: 'PURCHASE_ORDERED', message: 'Ordered items cannot be deleted; cancel instead' });
    await this.audit.tx(actor, { action: 'purchase.delete', entity: 'PurchaseItem', entityId: () => id, before: { code: i.code, name: i.name } }, async (tx) => {
      await tx.purchaseItem.delete({ where: { id } });
      await this.touch(tx, ctx.tenantId, projectId);
    });
    return { ok: true };
  }

  async approve(actor: AuthUser, projectId: string) {
    const ctx = await this.access.load(actor, projectId);
    this.access.requireManager(ctx);
    this.access.requireOpen(ctx);
    const items = await this.prisma.purchaseItem.count({ where: { projectId, status: { not: PurchaseStatus.CANCELLED } } });
    if (!items) throw new ConflictException({ code: 'PURCHASE_EMPTY', message: 'The purchasing plan has no items' });
    const p = await this.plan(this.prisma, ctx.tenantId, projectId);
    if (p.version && !p.dirty) throw new ConflictException('Already approved');
    return this.audit.tx(actor, { action: 'purchase.approve', entity: 'Project', entityId: () => projectId, after: () => ({ version: p.version + 1, items }) },
      (tx) => tx.purchasePlan.update({ where: { id: p.id }, data: { version: p.version + 1, approvedAt: new Date(), approvedById: actor.id, dirty: false } }));
  }

  /** 下单：金额大于 0 时生成承诺成本 */
  async order(actor: AuthUser, projectId: string, id: string, dto: OrderDto) {
    const ctx = await this.editable(actor, projectId);
    const i = await this.item(ctx, id);
    if (i.status !== PurchaseStatus.PLANNED) throw new ConflictException('Already ordered');
    const amount = dto.amount ?? Number(i.amount);
    const accountId = dto.accountId ?? i.accountId ?? (await this.prisma.costAccount.findFirst({ where: { projectId, name: '材料' } }))?.id ?? null;
    if (amount > 0 && !accountId) throw new BadRequestException({ code: 'ACCOUNT_REQUIRED', message: 'Choose the cost account for the commitment' });
    await this.refs(ctx, { accountId });
    const x = await this.audit.tx(actor, { action: 'purchase.order', entity: 'PurchaseItem', entityId: () => id, after: () => ({ orderNo: dto.orderNo, amount }) }, async (tx) => {
      const r = await tx.purchaseItem.update({ where: { id }, data: { status: PurchaseStatus.ORDERED, orderNo: dto.orderNo?.trim() || null, orderedAt: dto.orderedAt ? new Date(dto.orderedAt) : new Date(day(new Date())), amount, accountId } });
      if (amount > 0) {
        await tx.costCommitment.create({ data: { tenantId: ctx.tenantId, projectId, accountId: accountId!, workPackageId: i.workPackageId, amount, entryDate: r.orderedAt!, description: `${i.code} ${i.name}${dto.orderNo ? `（订单 ${dto.orderNo}）` : ''}`, createdById: actor.id, purchaseItemId: id } });
      }
      return r;
    });
    await this.cost.evaluate(ctx.tenantId, projectId);
    return x;
  }

  async receive(actor: AuthUser, projectId: string, id: string, dto: ReceiveDto) {
    const ctx = await this.editable(actor, projectId);
    const i = await this.item(ctx, id);
    if (i.status !== PurchaseStatus.ORDERED && i.status !== PurchaseStatus.PARTIAL && i.status !== PurchaseStatus.RECEIVED) throw new ConflictException('Not ordered');
    const status = dto.receivedPct >= 100 ? PurchaseStatus.RECEIVED : dto.receivedPct > 0 ? PurchaseStatus.PARTIAL : PurchaseStatus.ORDERED;
    return this.audit.tx(actor, { action: 'purchase.receive', entity: 'PurchaseItem', entityId: () => id, before: { receivedPct: i.receivedPct }, after: () => ({ receivedPct: dto.receivedPct }) },
      (tx) => tx.purchaseItem.update({ where: { id }, data: { receivedPct: dto.receivedPct, status, receivedAt: status === PurchaseStatus.RECEIVED ? (dto.date ? new Date(dto.date) : new Date(day(new Date()))) : null } }));
  }

  /** 结算：承诺成本转为实际成本 */
  async settle(actor: AuthUser, projectId: string, id: string, dto: SettleDto) {
    const ctx = await this.editable(actor, projectId);
    const i = await this.item(ctx, id);
    if (i.status === PurchaseStatus.PLANNED || i.status === PurchaseStatus.CANCELLED) throw new ConflictException('Not ordered');
    if (i.settledAt) throw new ConflictException('Already settled');
    const amount = dto.amount ?? Number(i.amount);
    if (amount > 0 && !i.accountId) throw new BadRequestException({ code: 'ACCOUNT_REQUIRED', message: 'Choose the cost account' });
    const x = await this.audit.tx(actor, { action: 'purchase.settle', entity: 'PurchaseItem', entityId: () => id, after: () => ({ amount }) }, async (tx) => {
      await tx.costCommitment.deleteMany({ where: { purchaseItemId: id } });
      if (amount > 0) await tx.costEntry.create({ data: { tenantId: ctx.tenantId, projectId, accountId: i.accountId!, workPackageId: i.workPackageId, amount, entryDate: dto.date ? new Date(dto.date) : new Date(day(new Date())), description: `${i.code} ${i.name} 结算`, createdById: actor.id } });
      return tx.purchaseItem.update({ where: { id }, data: { settledAt: new Date() } });
    });
    await this.cost.evaluate(ctx.tenantId, projectId);
    return x;
  }

  async cancel(actor: AuthUser, projectId: string, id: string) {
    const ctx = await this.editable(actor, projectId);
    const i = await this.item(ctx, id);
    if (i.settledAt) throw new ConflictException('Settled items cannot be cancelled');
    if (i.status === PurchaseStatus.CANCELLED) throw new ConflictException('Already cancelled');
    const x = await this.audit.tx(actor, { action: 'purchase.cancel', entity: 'PurchaseItem', entityId: () => id, before: { status: i.status } }, async (tx) => {
      await tx.costCommitment.deleteMany({ where: { purchaseItemId: id } });
      const r = await tx.purchaseItem.update({ where: { id }, data: { status: PurchaseStatus.CANCELLED } });
      await this.touch(tx, ctx.tenantId, projectId);
      return r;
    });
    await this.cost.evaluate(ctx.tenantId, projectId);
    return x;
  }
}
