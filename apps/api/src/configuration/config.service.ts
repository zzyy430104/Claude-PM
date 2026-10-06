import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthUser } from '../common/auth.types.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ProjectAccess, ProjectCtx } from '../projects/access.service.js';
import { CreateBaselineDto, CreateConfigItemDto, UpdateConfigItemDto } from './config.dto.js';

interface SnapItem { id: string; code: string; name: string; kind: string; parentId: string | null; revision: string; safetyRelated: boolean; serialNumber: string | null; batchNumber: string | null }

/** 配置管理（8.1.4.1）：产品分解结构（PBS）到最低可更换单元、配置项、基线、状态记录、可追溯标识 */
@Injectable()
export class ConfigService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: ProjectAccess,
  ) {}

  async items(actor: AuthUser, projectId: string) {
    const ctx = await this.access.load(actor, projectId);
    return this.prisma.configItem.findMany({ where: { projectId, tenantId: ctx.tenantId }, orderBy: { code: 'asc' } });
  }

  async create(actor: AuthUser, projectId: string, dto: CreateConfigItemDto) {
    const ctx = await this.access.load(actor, projectId);
    this.access.requireCan(ctx, 'DELIVERABLES');
    this.access.requireOpen(ctx);
    if (dto.parentId) {
      const parent = await this.prisma.configItem.findFirst({ where: { id: dto.parentId, projectId, tenantId: ctx.tenantId } });
      if (!parent) throw new BadRequestException('Parent item not found in this project');
      if (parent.lowestLevel) throw new BadRequestException('A lowest replaceable unit cannot have children');
    }
    try {
      return await this.audit.tx(
        actor,
        { action: 'configItem.create', entity: 'ConfigItem', entityId: (i) => i.id, after: (i) => ({ code: i.code, revision: i.revision, safetyRelated: i.safetyRelated }) },
        (tx) => tx.configItem.create({ data: { ...dto, tenantId: ctx.tenantId, projectId } }),
      );
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new ConflictException('Configuration item code already exists');
      throw e;
    }
  }

  async update(actor: AuthUser, projectId: string, id: string, dto: UpdateConfigItemDto) {
    const ctx = await this.access.load(actor, projectId);
    this.access.requireCan(ctx, 'DELIVERABLES');
    this.access.requireOpen(ctx);
    const item = await this.prisma.configItem.findFirst({ where: { id, projectId, tenantId: ctx.tenantId } });
    if (!item) throw new NotFoundException('Configuration item not found');
    const { changeRequestId, ...fields } = dto;

    const controlled =
      (fields.revision !== undefined && fields.revision !== item.revision) ||
      (fields.safetyRelated !== undefined && fields.safetyRelated !== item.safetyRelated) ||
      (fields.obsolete !== undefined && fields.obsolete !== item.obsolete);
    if (controlled && (await this.hasBaseline(ctx))) {
      const cr = changeRequestId
        ? await this.prisma.changeRequest.findFirst({ where: { id: changeRequestId, projectId, tenantId: ctx.tenantId, status: { in: ['APPROVED', 'IMPLEMENTED', 'VERIFIED'] } } })
        : null;
      if (!cr) {
        throw new ConflictException({ code: 'CHANGE_REQUEST_REQUIRED', message: 'A baseline exists: changing revision, safety relevance or status needs an approved change request' });
      }
    }
    return this.audit.tx(
      actor,
      {
        action: 'configItem.update', entity: 'ConfigItem', entityId: () => id,
        before: { revision: item.revision, safetyRelated: item.safetyRelated, obsolete: item.obsolete },
        after: (i) => ({ revision: i.revision, safetyRelated: i.safetyRelated, obsolete: i.obsolete, changeRequestId: changeRequestId ?? null }),
      },
      (tx) => tx.configItem.update({ where: { id }, data: fields }),
    );
  }

  async baselines(actor: AuthUser, projectId: string) {
    const ctx = await this.access.load(actor, projectId);
    const rows = await this.prisma.baseline.findMany({ where: { projectId, tenantId: ctx.tenantId }, orderBy: { createdAt: 'desc' } });
    return rows.map((b) => ({ ...b, itemCount: (b.snapshot as unknown as SnapItem[]).length }));
  }

  /** 建立基线：PBS 必须分解到最低可更换单元，即所有末级项都标记为 LLRU */
  async createBaseline(actor: AuthUser, projectId: string, dto: CreateBaselineDto) {
    const ctx = await this.access.load(actor, projectId);
    this.access.requireManager(ctx);
    this.access.requireOpen(ctx);
    const items = await this.prisma.configItem.findMany({ where: { projectId, tenantId: ctx.tenantId, obsolete: false }, orderBy: { code: 'asc' } });
    if (items.length === 0) throw new BadRequestException('Define configuration items before creating a baseline');
    const parents = new Set(items.map((i) => i.parentId).filter(Boolean));
    const leavesNotLlru = items.filter((i) => !parents.has(i.id) && !i.lowestLevel).map((i) => i.code);
    if (leavesNotLlru.length) {
      throw new ConflictException({ code: 'PBS_INCOMPLETE', message: 'The product breakdown must reach the lowest replaceable unit (LLRU)', items: leavesNotLlru });
    }
    const snapshot: SnapItem[] = items.map((i) => ({
      id: i.id, code: i.code, name: i.name, kind: i.kind, parentId: i.parentId, revision: i.revision,
      safetyRelated: i.safetyRelated, serialNumber: i.serialNumber, batchNumber: i.batchNumber,
    }));
    return this.audit.tx(
      actor,
      { action: 'baseline.create', entity: 'Baseline', entityId: (b) => b.id, after: (b) => ({ type: b.type, name: b.name, items: snapshot.length }) },
      (tx) => tx.baseline.create({ data: { tenantId: ctx.tenantId, projectId, type: dto.type, name: dto.name, snapshot: snapshot as unknown as Prisma.InputJsonValue, createdById: actor.id } }),
    );
  }

  /** 配置状态记录：当前配置与最近一次基线的差异 */
  async status(actor: AuthUser, projectId: string) {
    const ctx = await this.access.load(actor, projectId);
    const [items, latest] = await Promise.all([
      this.prisma.configItem.findMany({ where: { projectId, tenantId: ctx.tenantId, obsolete: false } }),
      this.prisma.baseline.findFirst({ where: { projectId, tenantId: ctx.tenantId }, orderBy: { createdAt: 'desc' } }),
    ]);
    if (!latest) return { baseline: null, added: items.map((i) => i.code), removed: [], changed: [], safetyRelatedItems: items.filter((i) => i.safetyRelated).length };
    const snap = new Map((latest.snapshot as unknown as SnapItem[]).map((s) => [s.code, s]));
    const cur = new Map(items.map((i) => [i.code, i]));
    return {
      baseline: { id: latest.id, name: latest.name, type: latest.type, createdAt: latest.createdAt },
      added: items.filter((i) => !snap.has(i.code)).map((i) => i.code),
      removed: [...snap.keys()].filter((c) => !cur.has(c)),
      changed: items.filter((i) => snap.has(i.code) && snap.get(i.code)!.revision !== i.revision).map((i) => ({ code: i.code, from: snap.get(i.code)!.revision, to: i.revision })),
      safetyRelatedItems: items.filter((i) => i.safetyRelated).length,
    };
  }

  private async hasBaseline(ctx: ProjectCtx) {
    return (await this.prisma.baseline.count({ where: { projectId: ctx.project.id, tenantId: ctx.tenantId } })) > 0;
  }
}
