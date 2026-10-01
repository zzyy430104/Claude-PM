import { BadRequestException, Body, ConflictException, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query, Res, StreamableFile } from '@nestjs/common';
import type { Response } from 'express';
import { Prisma } from '../generated/prisma/client.js';
import { Role } from '../generated/prisma/enums.js';
import { AuditService } from '../audit/audit.service.js';
import { CurrentUser, Roles } from '../common/decorators.js';
import { requireTenantId } from '../common/auth.types.js';
import type { AuthUser } from '../common/auth.types.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AspectsDto, DepartmentDto, MemberEvaluationDto, PmEvaluationDto, ReasonDto, SheetQuery, UpdateDepartmentDto } from './dto.js';
import { EvaluationService } from './evaluation.service.js';
import { checkAspects, DEFAULT_PERF, loadPerfConfig, type PerfConfig } from './perf-settings.js';

const P = () => Param('id', ParseUUIDPipe);
const U = (name: string) => Param(name, ParseUUIDPipe);

/** 项目绩效评价（第 5C 章） */
@Controller()
export class PerformanceController {
  constructor(private readonly ev: EvaluationService) {}

  @Get('projects/:id/evaluation') get(@CurrentUser() u: AuthUser, @P() id: string) { return this.ev.get(u, id); }
  @Put('projects/:id/evaluation/aspects') aspects(@CurrentUser() u: AuthUser, @P() id: string, @Body() dto: AspectsDto) { return this.ev.setAspects(u, id, dto.aspects, dto.reason); }
  @Put('projects/:id/evaluation/pm') pm(@CurrentUser() u: AuthUser, @P() id: string, @Body() dto: PmEvaluationDto) { return this.ev.updatePm(u, id, dto); }
  @Post('projects/:id/evaluation/pm/confirm') @HttpCode(200) confirm(@CurrentUser() u: AuthUser, @P() id: string) { return this.ev.confirmPm(u, id); }
  @Put('projects/:id/evaluation/members/:uid') member(@CurrentUser() u: AuthUser, @P() id: string, @U('uid') uid: string, @Body() dto: MemberEvaluationDto) { return this.ev.saveMember(u, id, uid, dto); }
  @Post('projects/:id/evaluation/members/:uid/submit') @HttpCode(200) submit(@CurrentUser() u: AuthUser, @P() id: string, @U('uid') uid: string) { return this.ev.submitMember(u, id, uid); }
  @Post('projects/:id/evaluation/members/:uid/reopen') @HttpCode(200) reopen(@CurrentUser() u: AuthUser, @P() id: string, @U('uid') uid: string, @Body() dto: ReasonDto) { return this.ev.reopenMember(u, id, uid, dto.reason); }

  @Get('evaluations') sheets(@CurrentUser() u: AuthUser, @Query() q: SheetQuery) { return this.ev.sheets(u, q); }
  @Get('evaluations/export')
  async export(@CurrentUser() u: AuthUser, @Query() q: SheetQuery, @Res({ passthrough: true }) res: Response) {
    const buf = await this.ev.exportSheets(u, q);
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="evaluations-${new Date().toISOString().slice(0, 10)}.xlsx"`, 'X-Content-Type-Options': 'nosniff',
    });
    return new StreamableFile(buf);
  }
  /** 当前用户能否进入“绩效评价单”页面 */
  @Get('evaluations/access') async access(@CurrentUser() u: AuthUser) {
    const tenantId = requireTenantId(u);
    const [hr, head] = await Promise.all([this.ev.hrUsers(tenantId), this.ev.headedDepartments(tenantId, u.id)]);
    return { hr: hr.includes(u.id), deptHead: head > 0, management: u.role === Role.TOP_MANAGEMENT || u.role === Role.TENANT_ADMIN };
  }
}

/** 部门及负责人 */
@Controller('departments')
export class DepartmentsController {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}
  @Get() list(@CurrentUser() u: AuthUser) { return this.prisma.department.findMany({ where: { tenantId: requireTenantId(u) }, orderBy: [{ active: 'desc' }, { name: 'asc' }] }); }
  private async head(tenantId: string, id?: string | null) {
    if (id && !(await this.prisma.user.findFirst({ where: { id, tenantId, active: true } }))) throw new BadRequestException('Unknown user');
  }
  @Post() @Roles(Role.TENANT_ADMIN)
  async create(@CurrentUser() u: AuthUser, @Body() dto: DepartmentDto) {
    const tenantId = requireTenantId(u);
    await this.head(tenantId, dto.headId);
    if (await this.prisma.department.findFirst({ where: { tenantId, name: dto.name.trim() } })) throw new ConflictException({ code: 'DUPLICATE_NAME', message: 'Department exists' });
    return this.audit.tx(u, { action: 'department.create', entity: 'Department', entityId: (d) => d.id, after: (d) => ({ name: d.name, headId: d.headId }) },
      (tx) => tx.department.create({ data: { tenantId, name: dto.name.trim(), headId: dto.headId ?? null } }));
  }
  @Patch(':did') @Roles(Role.TENANT_ADMIN)
  async update(@CurrentUser() u: AuthUser, @U('did') did: string, @Body() dto: UpdateDepartmentDto) {
    const tenantId = requireTenantId(u);
    const d = await this.prisma.department.findFirst({ where: { id: did, tenantId } });
    if (!d) throw new BadRequestException('Unknown department');
    await this.head(tenantId, dto.headId);
    if (dto.name && dto.name.trim() !== d.name && (await this.prisma.department.findFirst({ where: { tenantId, name: dto.name.trim() } }))) throw new ConflictException({ code: 'DUPLICATE_NAME', message: 'Department exists' });
    return this.audit.tx(u, { action: 'department.update', entity: 'Department', entityId: () => did, before: { name: d.name, headId: d.headId, active: d.active }, after: (x) => ({ name: x.name, headId: x.headId, active: x.active }) },
      (tx) => tx.department.update({ where: { id: did }, data: { name: dto.name?.trim(), headId: dto.headId, active: dto.active } }));
  }
}

/** 企业设置 → 项目绩效评价 */
@Controller('perf-settings')
export class PerfSettingsController {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}
  @Get() get(@CurrentUser() u: AuthUser) { return loadPerfConfig(this.prisma, requireTenantId(u)); }
  @Get('defaults') defaults() { return DEFAULT_PERF; }
  @Put() @Roles(Role.TENANT_ADMIN)
  async put(@CurrentUser() u: AuthUser, @Body() body: Partial<PerfConfig>) {
    const tenantId = requireTenantId(u);
    const cur = await loadPerfConfig(this.prisma, tenantId);
    const next: PerfConfig = {
      aspects: body.aspects ?? cur.aspects, rules: { ...cur.rules, ...body.rules }, memberDims: body.memberDims ?? cur.memberDims,
      grades: { ...cur.grades, ...body.grades }, visibility: { ...cur.visibility, ...body.visibility },
    };
    const err = checkAspects(next.aspects);
    if (err) throw new BadRequestException(err);
    if (!['TIME', 'QUALITY', 'COST'].every((k) => next.aspects.some((a) => a.key === k))) throw new BadRequestException('Time, quality and cost aspects cannot be removed (set the weight to 0 instead)');
    for (const v of Object.values(next.rules)) if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 100) throw new BadRequestException('Rule values are 0–100');
    if (!Array.isArray(next.memberDims) || !next.memberDims.length || next.memberDims.length > 10 || next.memberDims.some((d) => typeof d !== 'string' || !d.trim() || d.length > 20) || new Set(next.memberDims).size !== next.memberDims.length) throw new BadRequestException('invalid member dimensions');
    const g = next.grades;
    if (![g.excellent, g.good, g.pass].every((x) => Number.isInteger(x) && x >= 0 && x <= 100) || !(g.excellent > g.good && g.good > g.pass)) throw new BadRequestException('Grades must be excellent > good > pass');
    for (const v of Object.values(next.visibility)) if (typeof v !== 'boolean') throw new BadRequestException('invalid visibility');
    next.memberDims = next.memberDims.map((d) => d.trim());
    await this.audit.tx(u, { action: 'tenant.perfSettings', entity: 'Tenant', entityId: () => tenantId, before: cur as unknown as Prisma.InputJsonValue, after: () => next as unknown as Prisma.InputJsonValue },
      (tx) => tx.tenant.update({ where: { id: tenantId }, data: { perfConfig: next as unknown as Prisma.InputJsonValue } }));
    return next;
  }
}
