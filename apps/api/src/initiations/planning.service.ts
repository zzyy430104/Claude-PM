import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type Project } from '../generated/prisma/client.js';
import { ApprovalRoleKind, PhaseStatus, ProjectRole, ProjectStatus, ProjectType } from '../generated/prisma/enums.js';
import { AuditService } from '../audit/audit.service.js';
import { requireTenantId } from '../common/auth.types.js';
import type { AuthUser } from '../common/auth.types.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ProjectAccess } from '../projects/access.service.js';
import { ChangeGuard } from '../projects/change-guard.service.js';
import { PlanVersionsService } from '../projects/plan-versions.service.js';
import { WbsService } from '../projects/wbs.service.js';
import { ApprovalRolesService } from './approval-roles.service.js';
import type { AddFromLibraryDto, AssignByRoleDto, DecisionDto, OptionalWpDto, UpdateOptionalWpDto } from './dto.js';
import { isGroup, type TemplateRow } from './plan-templates.js';
import { CostControlService } from '../projects/cost-control.service.js';
import { PlanBuilderService } from './plan-builder.service.js';
import { asRequirements } from './requirements.js';

export interface PlanCheck { key: string; ok: boolean; message: string }

/**
 * 快速策划与计划批准：
 * - 按交期倒排、按角色批量指定责任人、从可选工作包库添加；
 * - 由立项生成的项目，计划要对照项目要求检查，项目经理提交、计划批准人批准（直接建立的小项目仍由项目经理自己批准）。
 */
@Injectable()
export class PlanningService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: ProjectAccess,
    private readonly guard: ChangeGuard,
    private readonly wbs: WbsService,
    private readonly versions: PlanVersionsService,
    private readonly roles: ApprovalRolesService,
    private readonly builder: PlanBuilderService,
    private readonly notifications: NotificationsService,
    private readonly costControl: CostControlService,
  ) {}

  // ───── 对照项目要求的检查 ─────

  async checks(tenantId: string, project: Project): Promise<PlanCheck[]> {
    const out: PlanCheck[] = [];
    const ver = project.requirementVersion
      ? await this.prisma.projectRequirementVersion.findUnique({ where: { projectId_version: { projectId: project.id, version: project.requirementVersion } } })
      : null;
    const req = asRequirements(ver?.data);
    const [sched, leaves, deliverables, risks, pm] = await Promise.all([
      this.wbs.scheduleOf(tenantId, project),
      this.prisma.workPackage.findMany({ where: { projectId: project.id, tenantId, children: { none: {} } }, select: { id: true, code: true, name: true, ownerId: true, budget: true, deliverableId: true, description: true } }),
      this.prisma.deliverable.findMany({ where: { projectId: project.id, tenantId }, select: { name: true, phaseId: true, workPackages: { select: { id: true } } } }),
      this.prisma.risk.count({ where: { projectId: project.id, tenantId } }),
      this.prisma.projectMember.count({ where: { projectId: project.id, projectRole: ProjectRole.PROJECT_MANAGER, active: true } }),
    ]);
    out.push({ key: 'pm', ok: pm > 0, message: pm > 0 ? '项目经理：已指定' : '项目经理：还没有指定' });
    if (!leaves.length) out.push({ key: 'wbs', ok: false, message: '工作包：还没有工作包' });
    if (sched.requiredEnd) {
      const late = (sched.gapDays ?? 0) > 0;
      out.push({ key: 'date', ok: !late, message: `交期：预计完工 ${sched.projectedEnd}，要求 ${sched.requiredEnd}${late ? `，晚 ${sched.gapDays} 个工作日` : ''}` });
    }
    for (const c of await this.costControl.planChecks(tenantId, project.id, req.cost.cap > 0 ? req.cost.cap : null)) out.push({ ...c, message: `成本：${c.message}` });
    const noOwner = leaves.filter((w) => !w.ownerId);
    out.push({ key: 'owner', ok: noOwner.length === 0, message: noOwner.length ? `责任人：还有 ${noOwner.length} 个工作包未指定（${noOwner.slice(0, 5).map((w) => w.code).join('、')}${noOwner.length > 5 ? ' 等' : ''}）` : '责任人：全部已指定' });
    const orphan = deliverables.filter((d) => !d.phaseId && d.workPackages.length === 0);
    out.push({ key: 'deliverables', ok: orphan.length === 0, message: orphan.length ? `交付物：${orphan.map((d) => d.name).join('、')} 没有所属阶段或工作包` : `交付物：${deliverables.length} 项都已落实到阶段或工作包` });
    // 质量：有交付物或记录要求的工作包至少有一个检验 / 验证项；关键项要有验证人
    const items = await this.prisma.inspectionItem.findMany({ where: { projectId: project.id, tenantId }, select: { workPackageId: true, isKey: true, verifierId: true } });
    const withItems = new Set(items.map((i) => i.workPackageId));
    const needQ = leaves.filter((w) => (w.deliverableId || w.description?.startsWith('交付物')) && !withItems.has(w.id));
    out.push({ key: 'quality', ok: needQ.length === 0, message: needQ.length ? `质量：${needQ.slice(0, 5).map((w) => w.code).join('、')}${needQ.length > 5 ? ' 等' : ''} 有交付物但还没有检验 / 验证项` : '质量：有交付物的工作包都有检验 / 验证项' });
    const keyNoVerifier = items.filter((i) => i.isKey && !i.verifierId).length;
    out.push({ key: 'qualityKey', ok: keyNoVerifier === 0, message: keyNoVerifier ? `质量：${keyNoVerifier} 个关键检验项没有验证人` : '质量：关键检验项都有验证人' });
    out.push({ key: 'risks', ok: risks > 0, message: risks > 0 ? `风险：已登记 ${risks} 项风险与机会` : '风险：还没有登记风险与机会' });
    return out;
  }

  /** 读取项目：项目成员按项目权限；计划批准人即使不是成员也能看 */
  private async load(actor: AuthUser, projectId: string) {
    try {
      const ctx = await this.access.load(actor, projectId);
      return { project: ctx.project, isManager: ctx.isManager, tenantId: ctx.tenantId };
    } catch (e) {
      if (!(e instanceof NotFoundException) || !(await this.roles.has(actor, ApprovalRoleKind.PLAN_APPROVER))) throw e;
      const project = await this.prisma.project.findFirst({ where: { id: projectId, tenantId: requireTenantId(actor) } });
      if (!project) throw e;
      return { project, isManager: false, tenantId: project.tenantId };
    }
  }

  async status(actor: AuthUser, projectId: string) {
    const { project, isManager, tenantId } = await this.load(actor, projectId);
    const needsApproval = !!project.initiationId;
    const approver = needsApproval && (await this.roles.has(actor, ApprovalRoleKind.PLAN_APPROVER));
    const checks = await this.checks(tenantId, project);
    const ok = checks.every((c) => c.ok);
    const open = !project.baselined || project.planOutdated;
    return {
      needsApproval, submittedAt: project.planSubmittedAt, outdated: project.planOutdated, baselined: project.baselined, checks, ok,
      can: {
        submit: needsApproval && isManager && open && !project.planSubmittedAt,
        approve: needsApproval && approver && !!project.planSubmittedAt,
        selfApprove: !needsApproval && isManager && !project.baselined,
      },
    };
  }

  async submit(actor: AuthUser, projectId: string) {
    const { project, isManager, tenantId } = await this.load(actor, projectId);
    if (!isManager) throw new ForbiddenException('Project manager required');
    if (!project.initiationId) throw new ConflictException('This project is approved by its project manager directly');
    if (project.baselined && !project.planOutdated) throw new ConflictException('Plan already approved');
    if (project.planSubmittedAt) throw new ConflictException('Already submitted');
    const checks = await this.checks(tenantId, project);
    const failed = checks.filter((c) => !c.ok);
    if (failed.length) throw new BadRequestException({ code: 'PLAN_CHECK_FAILED', message: failed.map((c) => c.message).join('；'), problems: failed.map((c) => c.message) });
    await this.audit.tx(
      actor,
      { action: 'plan.submit', entity: 'Project', entityId: () => projectId, after: () => ({ requirementVersion: project.requirementVersion }) },
      (tx) => tx.project.update({ where: { id: projectId }, data: { planSubmittedAt: new Date() } }),
    );
    await this.notifications.notify(tenantId, await this.roles.usersFor(tenantId, ApprovalRoleKind.PLAN_APPROVER), {
      kind: 'PLAN_SUBMITTED', title: `计划待批准：${project.name}`, body: `${project.code} · 项目要求 v${project.requirementVersion}`, link: `/projects/${projectId}`,
    }, actor.id);
    return this.status(actor, projectId);
  }

  /** 计划批准人批准：第一次批准即“计划批准并启动项目”；项目要求变更后的重新批准保存新一版计划 */
  async approve(actor: AuthUser, projectId: string) {
    const { project, tenantId } = await this.load(actor, projectId);
    if (!project.initiationId) throw new ConflictException('This project is approved by its project manager directly');
    if (!(await this.roles.has(actor, ApprovalRoleKind.PLAN_APPROVER))) throw new ForbiddenException('Not a plan approver');
    if (!project.planSubmittedAt) throw new ConflictException('The project manager has not submitted the plan');
    const checks = await this.checks(tenantId, project);
    const failed = checks.filter((c) => !c.ok);
    if (failed.length) throw new BadRequestException({ code: 'PLAN_CHECK_FAILED', message: failed.map((c) => c.message).join('；'), problems: failed.map((c) => c.message) });
    const first = !project.baselined;
    await this.audit.tx(
      actor,
      { action: first ? 'project.baseline' : 'plan.reapprove', entity: 'Project', entityId: () => projectId, after: () => ({ requirementVersion: project.requirementVersion }) },
      async (tx) => {
        if (first) {
          const ph = await tx.phase.findFirst({ where: { projectId }, orderBy: { order: 'asc' } });
          if (ph) await tx.phase.update({ where: { id: ph.id }, data: { status: PhaseStatus.ACTIVE, startedAt: new Date() } });
        }
        await tx.project.update({ where: { id: projectId }, data: { baselined: true, status: first ? ProjectStatus.ACTIVE : undefined, planOutdated: false, planSubmittedAt: null } });
      },
    );
    await this.versions.capture(actor, projectId, first ? '批准计划' : `按项目要求 v${project.requirementVersion} 重新批准计划`, undefined, tenantId);
    const pms = await this.prisma.projectMember.findMany({ where: { projectId, projectRole: ProjectRole.PROJECT_MANAGER, active: true }, select: { userId: true } });
    await this.notifications.notify(tenantId, pms.map((p) => p.userId), { kind: 'PLAN_DECIDED', title: `计划已批准：${project.name}`, body: first ? '项目已启动' : '已保存新一版计划', link: `/projects/${projectId}` }, actor.id);
    return this.status(actor, projectId);
  }

  async returnPlan(actor: AuthUser, projectId: string, dto: DecisionDto) {
    const { project, tenantId } = await this.load(actor, projectId);
    if (!(await this.roles.has(actor, ApprovalRoleKind.PLAN_APPROVER))) throw new ForbiddenException('Not a plan approver');
    if (!project.planSubmittedAt) throw new ConflictException('Not submitted');
    if (!dto.note?.trim()) throw new BadRequestException('A reason is required');
    await this.audit.tx(
      actor,
      { action: 'plan.return', entity: 'Project', entityId: () => projectId, after: () => ({ note: dto.note }) },
      (tx) => tx.project.update({ where: { id: projectId }, data: { planSubmittedAt: null } }),
    );
    const pms = await this.prisma.projectMember.findMany({ where: { projectId, projectRole: ProjectRole.PROJECT_MANAGER, active: true }, select: { userId: true } });
    await this.notifications.notify(tenantId, pms.map((p) => p.userId), { kind: 'PLAN_DECIDED', title: `计划被退回：${project.name}`, body: dto.note!, link: `/projects/${projectId}` }, actor.id);
    return this.status(actor, projectId);
  }

  // ───── 按角色批量指定责任人 ─────

  async assignByRole(actor: AuthUser, projectId: string, dto: AssignByRoleDto) {
    const ctx = await this.access.load(actor, projectId);
    this.access.requireManager(ctx);
    this.access.requireOpen(ctx);
    const users = await this.prisma.user.count({ where: { tenantId: ctx.tenantId, active: true, id: { in: [...new Set(dto.assignments.map((a) => a.userId))] } } });
    if (users !== new Set(dto.assignments.map((a) => a.userId)).size) throw new BadRequestException('Unknown user');
    let changed = 0;
    await this.audit.tx(
      actor,
      { action: 'wbs.assignByRole', entity: 'Project', entityId: () => projectId, after: () => ({ assignments: dto.assignments.map((a) => ({ ...a })), overwrite: !!dto.overwrite, changed }) },
      async (tx) => {
        for (const a of dto.assignments) {
          const r = await tx.workPackage.updateMany({
            where: { projectId, tenantId: ctx.tenantId, functionalRoleId: a.functionalRoleId, children: { none: {} }, ...(dto.overwrite ? {} : { ownerId: null }) },
            data: { ownerId: a.userId },
          });
          changed += r.count;
        }
      },
    );
    return { changed };
  }

  // ───── 可选工作包库 ─────

  listLibrary(actor: AuthUser) {
    return this.prisma.optionalWorkPackage.findMany({ where: { tenantId: requireTenantId(actor) }, orderBy: { createdAt: 'asc' } });
  }

  async createLibrary(actor: AuthUser, dto: OptionalWpDto) {
    const tenantId = requireTenantId(actor);
    return this.unique(() => this.audit.tx(
      actor,
      { action: 'optionalWp.create', entity: 'OptionalWorkPackage', entityId: (r) => r.id, after: (r) => ({ name: r.name }) },
      (tx) => tx.optionalWorkPackage.create({ data: { tenantId, name: dto.name.trim(), durationDays: dto.durationDays, suggestedPhase: dto.suggestedPhase ?? '', roleName: dto.roleName ?? '', deliverable: dto.deliverable ?? '', types: dto.types ?? ['A', 'B', 'C'] } }),
    ));
  }

  async updateLibrary(actor: AuthUser, id: string, dto: UpdateOptionalWpDto) {
    const tenantId = requireTenantId(actor);
    const cur = await this.prisma.optionalWorkPackage.findFirst({ where: { id, tenantId } });
    if (!cur) throw new NotFoundException('Not found');
    return this.unique(() => this.audit.tx(
      actor,
      { action: 'optionalWp.update', entity: 'OptionalWorkPackage', entityId: () => id, before: { name: cur.name, active: cur.active }, after: () => ({ ...dto }) as unknown as Prisma.InputJsonValue },
      (tx) => tx.optionalWorkPackage.update({ where: { id }, data: { ...dto, name: dto.name?.trim() } }),
    ));
  }

  /** 从可选库加一个工作包到项目：放在指定的一级工作包下，编号接着排，责任角色按名称对上 */
  async addFromLibrary(actor: AuthUser, projectId: string, dto: AddFromLibraryDto) {
    const ctx = await this.access.load(actor, projectId);
    this.access.requireManager(ctx);
    this.access.requireOpen(ctx);
    await this.guard.assertAllowed(ctx, dto.changeRequestId);
    const lib = await this.prisma.optionalWorkPackage.findFirst({ where: { id: dto.libraryId, tenantId: ctx.tenantId, active: true } });
    if (!lib) throw new NotFoundException('Library item not found');
    let parent = null;
    if (dto.parentId) {
      parent = await this.prisma.workPackage.findFirst({ where: { id: dto.parentId, projectId, tenantId: ctx.tenantId } });
      if (!parent) throw new BadRequestException('Unknown parent');
    }
    const siblings = await this.prisma.workPackage.findMany({ where: { projectId, tenantId: ctx.tenantId, parentId: parent?.id ?? null }, select: { code: true } });
    const prefix = parent ? `${parent.code}.` : '';
    const n = Math.max(0, ...siblings.map((s) => Number(s.code.slice(prefix.length).split('.')[0]) || 0)) + 1;
    const role = lib.roleName ? await this.prisma.functionalRole.findFirst({ where: { tenantId: ctx.tenantId, name: lib.roleName, active: true } }) : null;
    return this.audit.tx(
      actor,
      { action: 'wbs.create', entity: 'WorkPackage', entityId: (w) => w.id, after: (w) => ({ code: w.code, name: w.name, fromLibrary: lib.name, changeRequestId: dto.changeRequestId ?? null }) },
      async (tx) => {
        const w = await tx.workPackage.create({
        data: {
          resourceDays: lib.durationDays > 0 ? lib.durationDays : null,
          tenantId: ctx.tenantId, projectId, parentId: parent?.id ?? null, phaseId: parent?.phaseId ?? null, code: `${prefix}${n}`, name: lib.name,
          durationDays: Math.max(lib.durationDays, 0), isMilestone: lib.durationDays === 0, functionalRoleId: role?.id ?? null,
          isPurchase: parent?.isPurchase ?? false, description: lib.deliverable ? `交付物 / 记录：${lib.deliverable}` : null,
        },
      });
        if (lib.durationDays > 0) await this.costControl.recomputeBudget(tx, w.id);
        if (lib.deliverable) {
          const cats = (await tx.tenant.findUnique({ where: { id: ctx.tenantId }, select: { inspectionCategories: true } }))?.inspectionCategories ?? [];
          await tx.inspectionItem.create({ data: { tenantId: ctx.tenantId, projectId, workPackageId: w.id, name: lib.deliverable, category: cats.includes('文件') ? '文件' : cats[0] ?? '文件', requirement: '内容完整，经审核', method: '审核', record: lib.deliverable, sortOrder: 1 } });
        }
        return w;
      },
    );
  }

  // ───── A/B/C 计划模板 ─────

  async getTemplate(actor: AuthUser, type: ProjectType) {
    const tenantId = requireTenantId(actor);
    const custom = await this.prisma.planTypeTemplate.findUnique({ where: { tenantId_type: { tenantId, type } } });
    return { type, custom: !!custom, updatedAt: custom?.updatedAt ?? null, items: await this.builder.templateRows(tenantId, type) };
  }

  async saveTemplate(actor: AuthUser, type: ProjectType, rows: TemplateRow[]) {
    const tenantId = requireTenantId(actor);
    validateTemplate(rows);
    await this.audit.tx(
      actor,
      { action: 'planTemplate.save', entity: 'PlanTypeTemplate', entityId: () => type, after: () => ({ items: rows.length }) },
      (tx) => tx.planTypeTemplate.upsert({
        where: { tenantId_type: { tenantId, type } },
        create: { tenantId, type, items: rows as unknown as Prisma.InputJsonValue },
        update: { items: rows as unknown as Prisma.InputJsonValue },
      }),
    );
    return this.getTemplate(actor, type);
  }

  async resetTemplate(actor: AuthUser, type: ProjectType) {
    const tenantId = requireTenantId(actor);
    await this.audit.tx(
      actor,
      { action: 'planTemplate.reset', entity: 'PlanTypeTemplate', entityId: () => type },
      (tx) => tx.planTypeTemplate.deleteMany({ where: { tenantId, type } }),
    );
    return this.getTemplate(actor, type);
  }

  private async unique<T>(fn: () => Promise<T>) {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new ConflictException('An item with this name already exists');
      throw e;
    }
  }
}

/** 模板的基本校验：编号唯一、二级编号在一级之下、前置存在、没有循环 */
export function validateTemplate(rows: TemplateRow[]) {
  const problems: string[] = [];
  const codes = new Set<string>();
  for (const r of rows) {
    if (codes.has(r.code)) problems.push(`编号重复：${r.code}`);
    codes.add(r.code);
  }
  const groups = new Set(rows.filter(isGroup).map((g) => g.code));
  const items = rows.filter((r) => !isGroup(r)) as Exclude<TemplateRow, { group: true }>[];
  for (const i of items) {
    if (!groups.has(i.code.split('.')[0])) problems.push(`${i.code} 没有对应的一级（阶段）`);
    for (const p of i.predecessors) if (!codes.has(p) || groups.has(p)) problems.push(`${i.code} 的前置 ${p} 不是模板里的工作包`);
    if (!(i.durationDays >= 0)) problems.push(`${i.code} 工期不对`);
  }
  // 环检测
  const by = new Map(items.map((i) => [i.code, i]));
  const state = new Map<string, number>();
  const dfs = (c: string): boolean => {
    if (state.get(c) === 1) return true;
    if (state.get(c) === 2 || !by.has(c)) return false;
    state.set(c, 1);
    for (const p of by.get(c)!.predecessors) if (dfs(p)) return true;
    state.set(c, 2);
    return false;
  };
  if (items.some((i) => dfs(i.code))) problems.push('前置关系有循环');
  if (problems.length) throw new BadRequestException({ code: 'TEMPLATE_INVALID', message: problems.join('；'), problems });
}

