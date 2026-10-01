import { BadRequestException, Body, Controller, Get, Patch } from '@nestjs/common';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsInt, IsNumber, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import { AuditService } from '../audit/audit.service.js';
import { CurrentUser, Roles } from '../common/decorators.js';
import { requireTenantId } from '../common/auth.types.js';
import type { AuthUser } from '../common/auth.types.js';
import { Role } from '../generated/prisma/enums.js';
import { PrismaService } from '../prisma/prisma.service.js';

export class UpdateTenantSettingsDto {
  /** 顶栏和工作台显示的系统名称 */
  @IsOptional() @IsString() @MinLength(1) @MaxLength(40) systemName?: string;
  /** 企业名称 */
  @IsOptional() @IsString() @MinLength(1) @MaxLength(100) companyName?: string;
  /** 立项需要会签 */
  @IsOptional() @IsBoolean() requireCosign?: boolean;
  /** 小项目免立项：项目经理可直接建项目 */
  @IsOptional() @IsBoolean() allowDirectProject?: boolean;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.5) @Max(1) evmAmber?: number;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.5) @Max(1) evmRed?: number;
  /** 每周上班的日子：1 = 周一 … 7 = 周日 */
  @IsOptional() @IsArray() @ArrayMaxSize(7) @IsInt({ each: true }) @Min(1, { each: true }) @Max(7, { each: true }) workWeek?: number[];
  @IsOptional() @IsArray() @ArrayMaxSize(500) @Matches(/^\d{4}-\d{2}-\d{2}$/, { each: true }) holidays?: string[];
  @IsOptional() @IsArray() @ArrayMaxSize(500) @Matches(/^\d{4}-\d{2}-\d{2}$/, { each: true }) extraWorkdays?: string[];
  /** 检验 / 验证项的类别 */
  @IsOptional() @IsArray() @ArrayMinSize(1) @ArrayMaxSize(30) @IsString({ each: true }) @MinLength(1, { each: true }) @MaxLength(30, { each: true }) inspectionCategories?: string[];
}

/** 品牌：企业内所有人都能读，用于顶栏显示 */
@Controller('branding')
export class BrandingController {
  constructor(private readonly prisma: PrismaService) {}
  @Get() async get(@CurrentUser() u: AuthUser) {
    const t = await this.prisma.tenant.findUniqueOrThrow({ where: { id: requireTenantId(u) }, select: { systemName: true, name: true, allowDirectProject: true, inspectionCategories: true } });
    return { systemName: t.systemName, companyName: t.name, allowDirectProject: t.allowDirectProject, inspectionCategories: t.inspectionCategories };
  }
}

/** 企业设置：品牌、挣值预警阈值（SPI / CPI 低于黄线为黄，低于红线为红）与工作日历 */
@Controller('tenant-settings')
export class SettingsController {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  @Get() async get(@CurrentUser() u: AuthUser) {
    const t = await this.prisma.tenant.findUniqueOrThrow({
      where: { id: requireTenantId(u) }, select: { systemName: true, name: true, requireCosign: true, allowDirectProject: true, evmAmber: true, evmRed: true, workWeek: true, holidays: true, extraWorkdays: true, inspectionCategories: true },
    });
    return {
      systemName: t.systemName, companyName: t.name, requireCosign: t.requireCosign, allowDirectProject: t.allowDirectProject,
      evmAmber: Number(t.evmAmber), evmRed: Number(t.evmRed), workWeek: t.workWeek,
      holidays: (t.holidays as string[]) ?? [], extraWorkdays: (t.extraWorkdays as string[]) ?? [],
      inspectionCategories: t.inspectionCategories,
    };
  }

  @Patch() @Roles(Role.TENANT_ADMIN)
  async update(@CurrentUser() u: AuthUser, @Body() dto: UpdateTenantSettingsDto) {
    const id = requireTenantId(u);
    const cur = await this.get(u);
    const uniqSorted = (xs: string[]) => [...new Set(xs)].sort();
    const next = {
      systemName: dto.systemName?.trim() || cur.systemName, companyName: dto.companyName?.trim() || cur.companyName,
      requireCosign: dto.requireCosign ?? cur.requireCosign, allowDirectProject: dto.allowDirectProject ?? cur.allowDirectProject,
      evmAmber: dto.evmAmber ?? cur.evmAmber, evmRed: dto.evmRed ?? cur.evmRed,
      workWeek: dto.workWeek ? [...new Set(dto.workWeek)].sort() : cur.workWeek,
      holidays: dto.holidays ? uniqSorted(dto.holidays) : cur.holidays,
      extraWorkdays: dto.extraWorkdays ? uniqSorted(dto.extraWorkdays) : cur.extraWorkdays,
      inspectionCategories: dto.inspectionCategories ? [...new Set(dto.inspectionCategories.map((c) => c.trim()).filter(Boolean))] : cur.inspectionCategories,
    };
    if (next.evmRed >= next.evmAmber) throw new BadRequestException('The red threshold must be below the amber threshold');
    if (next.workWeek.length === 0) throw new BadRequestException('At least one working day per week is required');
    await this.audit.tx(
      u,
      { action: 'tenant.settings', entity: 'Tenant', entityId: () => id, before: cur, after: () => next },
      (tx) => { const { companyName, ...rest } = next; return tx.tenant.update({ where: { id }, data: { ...rest, name: companyName } }); },
    );
    return next;
  }
}
