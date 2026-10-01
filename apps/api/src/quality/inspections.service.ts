import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { InspectionResult, NcSeverity, NcSource, WpStatus } from '../generated/prisma/enums.js';
import { AuditService } from '../audit/audit.service.js';
import { requireTenantId } from '../common/auth.types.js';
import type { AuthUser } from '../common/auth.types.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ProjectAccess, type ProjectCtx } from '../projects/access.service.js';
import { InspectionItemDto, InspectionResultDto, InspectionTemplateDto, UpdateInspectionItemDto, UpdateInspectionTemplateDto } from './quality.dto.js';
import { QualityService } from './quality.service.js';

/**
 * 工作包上的检验 / 验证项（第 5A 章质量）：
 * 策划时由项目经理或项目质量经理定义（类别可自定义，不限于产品检验），执行时由验证人逐条记录结果；
 * 不合格的一条可一键开不符合项。工作包核验前要求全部有结果、没有不合格、关联不符合项已关闭。
 */
@Injectable()
export class InspectionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: ProjectAccess,
    private readonly quality: QualityService,
    private readonly notifications: NotificationsService,
  ) {}

  async list(actor: AuthUser, projectId: string) {
    const ctx = await this.access.load(actor, projectId);
    const rows = await this.prisma.inspectionItem.findMany({
      where: { projectId, tenantId: ctx.tenantId },
      include: { workPackage: { select: { code: true, name: true, ownerId: true, status: true } } },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
    return rows.sort((a, b) => a.workPackage.code.localeCompare(b.workPackage.code, undefined, { numeric: true }) || a.sortOrder - b.sortOrder);
  }

  /** 统计：数量、关键项、已有结果、一次合格率、不合格 */
  async stats(actor: AuthUser, projectId: string) {
    const rows = await this.list(actor, projectId);
    const first = rows.filter((r) => r.firstResult === InspectionResult.PASS || r.firstResult === InspectionResult.FAIL);
    const wps = await this.prisma.workPackage.findMany({ where: { projectId, children: { none: {} } }, select: { id: true, code: true, name: true, deliverableId: true, description: true } });
    const withItems = new Set(rows.map((r) => r.workPackageId));
    const needItems = wps.filter((w) => (w.deliverableId || w.description?.startsWith('交付物')) && !withItems.has(w.id));
    return {
      total: rows.length,
      key: rows.filter((r) => r.isKey).length,
      keyWithoutVerifier: rows.filter((r) => r.isKey && !r.verifierId).length,
      done: rows.filter((r) => r.result !== InspectionResult.PENDING).length,
      pending: rows.filter((r) => r.result === InspectionResult.PENDING).length,
      failed: rows.filter((r) => r.result === InspectionResult.FAIL).length,
      firstPassYield: first.length ? Math.round((first.filter((r) => r.firstResult === InspectionResult.PASS).length / first.length) * 1000) / 10 : null,
      workPackages: withItems.size,
      missing: needItems.map((w) => ({ id: w.id, code: w.code, name: w.name })),
    };
  }

  private async wpOf(ctx: ProjectCtx, wpId: string) {
    const wp = await this.prisma.workPackage.findFirst({ where: { id: wpId, projectId: ctx.project.id, tenantId: ctx.tenantId }, include: { _count: { select: { children: true } } } });
    if (!wp) throw new NotFoundException('Work package not found');
    return wp;
  }
  private async itemOf(ctx: ProjectCtx, id: string) {
    const it = await this.prisma.inspectionItem.findFirst({ where: { id, projectId: ctx.project.id, tenantId: ctx.tenantId }, include: { workPackage: true } });
    if (!it) throw new NotFoundException('Inspection item not found');
    return it;
  }
  private async checkVerifier(ctx: ProjectCtx, userId: string | null | undefined) {
    if (!userId) return;
    const u = await this.prisma.user.findFirst({ where: { id: userId, tenantId: ctx.tenantId, active: true } });
    if (!u) throw new BadRequestException('Unknown verifier');
  }
  private async category(ctx: ProjectCtx, cat: string) {
    const t = await this.prisma.tenant.findUnique({ where: { id: ctx.tenantId }, select: { inspectionCategories: true } });
    if (!t?.inspectionCategories.includes(cat)) throw new BadRequestException({ code: 'UNKNOWN_CATEGORY', message: `Unknown inspection category: ${cat}` });
  }

  async create(actor: AuthUser, projectId: string, wpId: string, dto: InspectionItemDto) {
    const ctx = await this.access.load(actor, projectId);
    this.access.requireManagerOrQuality(ctx);
    this.access.requireOpen(ctx);
    const wp = await this.wpOf(ctx, wpId);
    if (wp._count.children > 0) throw new BadRequestException('Inspection items belong to leaf work packages');
    if (wp.status === WpStatus.VERIFIED) throw new ConflictException('Verified work package is locked');
    await this.category(ctx, dto.category);
    await this.checkVerifier(ctx, dto.verifierId);
    const max = await this.prisma.inspectionItem.aggregate({ where: { workPackageId: wpId }, _max: { sortOrder: true } });
    return this.audit.tx(
      actor,
      { action: 'inspection.create', entity: 'InspectionItem', entityId: (i) => i.id, after: (i) => ({ wp: wp.code, name: i.name, category: i.category }) },
      (tx) => tx.inspectionItem.create({
        data: {
          tenantId: ctx.tenantId, projectId, workPackageId: wpId, name: dto.name.trim(), category: dto.category, requirement: dto.requirement ?? '',
          method: dto.method ?? '', record: dto.record ?? '', verifierId: dto.verifierId ?? null, isKey: dto.isKey ?? false, sortOrder: (max._max.sortOrder ?? 0) + 1,
        },
      }),
    );
  }

  async update(actor: AuthUser, projectId: string, id: string, dto: UpdateInspectionItemDto) {
    const ctx = await this.access.load(actor, projectId);
    this.access.requireManagerOrQuality(ctx);
    this.access.requireOpen(ctx);
    const it = await this.itemOf(ctx, id);
    if (it.workPackage.status === WpStatus.VERIFIED) throw new ConflictException('Verified work package is locked');
    if (dto.category !== undefined) await this.category(ctx, dto.category);
    if (dto.verifierId !== undefined) await this.checkVerifier(ctx, dto.verifierId);
    return this.audit.tx(
      actor,
      { action: 'inspection.update', entity: 'InspectionItem', entityId: () => id, before: { name: it.name, requirement: it.requirement, isKey: it.isKey }, after: (i) => ({ name: i.name, requirement: i.requirement, isKey: i.isKey }) },
      (tx) => tx.inspectionItem.update({
        where: { id },
        data: { name: dto.name?.trim(), category: dto.category, requirement: dto.requirement, method: dto.method, record: dto.record, verifierId: dto.verifierId, isKey: dto.isKey },
      }),
    );
  }

  async remove(actor: AuthUser, projectId: string, id: string) {
    const ctx = await this.access.load(actor, projectId);
    this.access.requireManagerOrQuality(ctx);
    this.access.requireOpen(ctx);
    const it = await this.itemOf(ctx, id);
    if (it.result !== InspectionResult.PENDING) throw new ConflictException('An inspection item with a result cannot be deleted');
    await this.audit.tx(actor, { action: 'inspection.delete', entity: 'InspectionItem', entityId: () => id, before: { name: it.name, wp: it.workPackage.code } }, (tx) => tx.inspectionItem.delete({ where: { id } }));
    return { ok: true };
  }

  /** 从企业检验项库加入工作包 */
  async addFromTemplate(actor: AuthUser, projectId: string, wpId: string, templateId: string) {
    const ctx = await this.access.load(actor, projectId);
    const t = await this.prisma.inspectionTemplate.findFirst({ where: { id: templateId, tenantId: ctx.tenantId, active: true } });
    if (!t) throw new NotFoundException('Inspection template not found');
    const cats = (await this.prisma.tenant.findUnique({ where: { id: ctx.tenantId }, select: { inspectionCategories: true } }))?.inspectionCategories ?? [];
    return this.create(actor, projectId, wpId, { name: t.name, category: cats.includes(t.category) ? t.category : cats[0], requirement: t.requirement, method: t.method, record: t.record });
  }

  /** 记录结果：验证人、项目质量经理或项目经理；不适用必须写理由 */
  async record(actor: AuthUser, projectId: string, id: string, dto: InspectionResultDto) {
    const ctx = await this.access.load(actor, projectId);
    this.access.requireOpen(ctx);
    const it = await this.itemOf(ctx, id);
    if (!ctx.isManager && !ctx.isQuality && it.verifierId !== actor.id) throw new ForbiddenException('Only the verifier, the project quality manager or the project manager can record a result');
    if (it.workPackage.status === WpStatus.VERIFIED) throw new ConflictException('Verified work package is locked');
    if (dto.result === InspectionResult.NA && !dto.note?.trim()) throw new BadRequestException({ code: 'NA_REASON_REQUIRED', message: 'A reason is required for “not applicable”' });
    const first = it.firstResult ?? (dto.result === InspectionResult.PASS || dto.result === InspectionResult.FAIL ? dto.result : null);
    const done = dto.result !== InspectionResult.PENDING;
    return this.audit.tx(
      actor,
      { action: 'inspection.result', entity: 'InspectionItem', entityId: () => id, before: { result: it.result, recordNo: it.recordNo }, after: (i) => ({ result: i.result, recordNo: i.recordNo, note: i.resultNote }) },
      (tx) => tx.inspectionItem.update({
        where: { id },
        data: {
          result: dto.result, firstResult: first, recordNo: dto.recordNo?.trim() ?? it.recordNo, resultNote: dto.note?.trim() ?? '',
          resultAt: done ? new Date() : null, resultById: done ? actor.id : null,
        },
      }),
    );
  }

  /** 不合格的检验项一键开不符合项，关联工作包和检验项 */
  async openNc(actor: AuthUser, projectId: string, id: string) {
    const ctx = await this.access.load(actor, projectId);
    const it = await this.itemOf(ctx, id);
    if (it.result !== InspectionResult.FAIL) throw new ConflictException('Only a failed inspection item can raise a nonconformity');
    if (it.ncId) throw new ConflictException('A nonconformity has already been raised for this item');
    const nc = await this.quality.createNc(actor, projectId, {
      title: `${it.workPackage.code} ${it.name} 不合格`,
      description: [`检验项：${it.name}（${it.category}）`, it.requirement && `要求：${it.requirement}`, it.recordNo && `记录：${it.recordNo}`, it.resultNote && `说明：${it.resultNote}`].filter(Boolean).join('\n'),
      severity: it.isKey ? NcSeverity.MAJOR : NcSeverity.MINOR,
      source: NcSource.INSPECTION,
      workPackageId: it.workPackageId,
    });
    await this.prisma.inspectionItem.update({ where: { id }, data: { ncId: nc.id } });
    return nc;
  }

  // ───── 企业检验项库与类别 ─────

  templates(actor: AuthUser) {
    return this.prisma.inspectionTemplate.findMany({ where: { tenantId: requireTenantId(actor) }, orderBy: { createdAt: 'asc' } });
  }
  async createTemplate(actor: AuthUser, dto: InspectionTemplateDto) {
    const tenantId = requireTenantId(actor);
    return this.unique(() => this.audit.tx(
      actor,
      { action: 'inspectionTemplate.create', entity: 'InspectionTemplate', entityId: (t) => t.id, after: (t) => ({ name: t.name }) },
      (tx) => tx.inspectionTemplate.create({ data: { tenantId, name: dto.name.trim(), category: dto.category, requirement: dto.requirement ?? '', method: dto.method ?? '', record: dto.record ?? '' } }),
    ));
  }
  async updateTemplate(actor: AuthUser, id: string, dto: UpdateInspectionTemplateDto) {
    const tenantId = requireTenantId(actor);
    const cur = await this.prisma.inspectionTemplate.findFirst({ where: { id, tenantId } });
    if (!cur) throw new NotFoundException('Inspection template not found');
    return this.unique(() => this.audit.tx(
      actor,
      { action: 'inspectionTemplate.update', entity: 'InspectionTemplate', entityId: () => id, before: { name: cur.name, active: cur.active }, after: (t) => ({ name: t.name, active: t.active }) },
      (tx) => tx.inspectionTemplate.update({ where: { id }, data: { name: dto.name?.trim(), category: dto.category, requirement: dto.requirement, method: dto.method, record: dto.record, active: dto.active } }),
    ));
  }
  private async unique<T>(fn: () => Promise<T>) {
    try { return await fn(); } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new ConflictException('An inspection template with this name already exists');
      throw e;
    }
  }
}
