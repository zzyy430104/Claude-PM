import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import { Prisma } from '../generated/prisma/client.js';
import { Role } from '../generated/prisma/enums.js';
import { AuditService } from '../audit/audit.service.js';
import { requireTenantId } from '../common/auth.types.js';
import type { AuthUser } from '../common/auth.types.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ProjectAccess } from './access.service.js';
import { ChangeGuard } from './change-guard.service.js';

const CODE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/;

export class WbsTemplateItemDto {
  @Matches(CODE) code: string;
  @IsString() @MinLength(1) @MaxLength(200) name: string;
  @IsOptional() @Matches(CODE) parentCode?: string;
  @IsInt() @Min(0) @Max(3650) durationDays: number;
  @IsOptional() @IsBoolean() isMilestone?: boolean;
}
export class CreateWbsTemplateDto {
  @IsString() @MinLength(2) @MaxLength(100) name: string;
  @IsArray() @ArrayMaxSize(500) @ValidateNested({ each: true }) @Type(() => WbsTemplateItemDto) items: WbsTemplateItemDto[];
}
export class SaveAsTemplateDto {
  @IsString() @MinLength(2) @MaxLength(100) name: string;
}
export class ApplyTemplateDto {
  @IsUUID() templateId: string;
  @IsOptional() @IsUUID() changeRequestId?: string;
}

type Item = { code: string; name: string; parentCode?: string; durationDays: number; isMilestone?: boolean };

/** 标准 WBS 模板（8.1.3.3 should）：企业维护常用的工作包结构，项目中一键带出 */
@Injectable()
export class WbsTemplatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: ProjectAccess,
    private readonly guard: ChangeGuard,
  ) {}

  list(actor: AuthUser) {
    return this.prisma.wbsTemplate.findMany({ where: { tenantId: requireTenantId(actor), active: true }, orderBy: { name: 'asc' } });
  }

  async create(actor: AuthUser, dto: CreateWbsTemplateDto) {
    if (actor.role !== Role.TENANT_ADMIN && actor.role !== Role.PROJECT_MANAGER) throw new ForbiddenException('Tenant admin or project manager required');
    this.check(dto.items);
    return this.save(actor, dto.name, dto.items);
  }

  /** 把项目当前的 WBS 另存为模板（只保存结构、名称和工期） */
  async saveFromProject(actor: AuthUser, projectId: string, dto: SaveAsTemplateDto) {
    const ctx = await this.access.load(actor, projectId);
    this.access.requireManager(ctx);
    const wps = await this.prisma.workPackage.findMany({ where: { projectId, tenantId: ctx.tenantId }, orderBy: { code: 'asc' } });
    if (!wps.length) throw new BadRequestException('The project has no work packages');
    const codeOf = new Map(wps.map((w) => [w.id, w.code]));
    return this.save(actor, dto.name, wps.map((w) => ({
      code: w.code, name: w.name, durationDays: w.durationDays, isMilestone: w.isMilestone,
      ...(w.parentId ? { parentCode: codeOf.get(w.parentId) } : {}),
    })));
  }

  async deactivate(actor: AuthUser, id: string) {
    const tenantId = requireTenantId(actor);
    const t = await this.prisma.wbsTemplate.findFirst({ where: { id, tenantId } });
    if (!t) throw new NotFoundException('Template not found');
    await this.audit.tx(actor, { action: 'wbsTemplate.deactivate', entity: 'WbsTemplate', entityId: () => id }, (tx) =>
      tx.wbsTemplate.update({ where: { id }, data: { active: false, name: `${t.name}（已停用 ${id.slice(0, 8)}）` } }));
  }

  /** 把模板里的工作包加入项目；编号与已有工作包重复时整体拒绝 */
  async apply(actor: AuthUser, projectId: string, dto: ApplyTemplateDto) {
    const ctx = await this.access.load(actor, projectId);
    this.access.requireManager(ctx);
    this.access.requireOpen(ctx);
    await this.guard.assertAllowed(ctx, dto.changeRequestId);
    const t = await this.prisma.wbsTemplate.findFirst({ where: { id: dto.templateId, tenantId: ctx.tenantId, active: true } });
    if (!t) throw new NotFoundException('Template not found');
    const items = t.items as unknown as Item[];
    const existing = await this.prisma.workPackage.findMany({ where: { projectId, tenantId: ctx.tenantId }, select: { code: true } });
    const clash = items.filter((i) => existing.some((w) => w.code === i.code)).map((i) => i.code);
    if (clash.length) throw new ConflictException({ code: 'WBS_CODE_CLASH', message: `Codes already exist: ${clash.join(', ')}`, codes: clash });
    const depth = (i: Item): number => (i.parentCode ? depth(items.find((x) => x.code === i.parentCode)!) + 1 : 0);
    const ids = new Map<string, string>();
    await this.audit.tx(
      actor,
      { action: 'wbsTemplate.apply', entity: 'Project', entityId: () => projectId, after: () => ({ template: t.name, items: items.length }) },
      async (tx) => {
        for (const i of [...items].sort((a, b) => depth(a) - depth(b))) {
          const w = await tx.workPackage.create({
            data: {
              tenantId: ctx.tenantId, projectId, code: i.code, name: i.name, isMilestone: !!i.isMilestone,
              durationDays: i.isMilestone ? 0 : Math.max(i.durationDays, 1), parentId: i.parentCode ? ids.get(i.parentCode) : null,
            },
          });
          ids.set(i.code, w.id);
        }
      },
    );
    return { created: items.length };
  }

  private check(items: Item[]) {
    const codes = new Set<string>();
    for (const i of items) {
      if (codes.has(i.code)) throw new BadRequestException(`Duplicate code ${i.code}`);
      codes.add(i.code);
    }
    for (const i of items) if (i.parentCode && !codes.has(i.parentCode)) throw new BadRequestException(`Unknown parent ${i.parentCode}`);
  }

  private async save(actor: AuthUser, name: string, items: Item[]) {
    const tenantId = requireTenantId(actor);
    try {
      return await this.audit.tx(
        actor,
        { action: 'wbsTemplate.create', entity: 'WbsTemplate', entityId: (t) => t.id, after: () => ({ name, items: items.length }) },
        (tx) => tx.wbsTemplate.create({ data: { tenantId, name, items: items as unknown as Prisma.InputJsonValue } }),
      );
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new ConflictException('Template name already exists');
      throw e;
    }
  }
}
