import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type Project } from '../generated/prisma/client.js';
import {
  ApprovalRoleKind, DeliverableStatus, EvaluationStatus, InspectionResult, IssueKind, IssueStatus, NcSeverity, NcSource, ProjectRole, Role, WpStatus,
} from '../generated/prisma/enums.js';
import { AuditService } from '../audit/audit.service.js';
import { requireTenantId } from '../common/auth.types.js';
import type { AuthUser } from '../common/auth.types.js';
import { asRequirements } from '../initiations/requirements.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CalendarService } from '../projects/calendar.service.js';
import { CostControlService } from '../projects/cost-control.service.js';
import { WbsService } from '../projects/wbs.service.js';
import { AUTO_ASPECTS, type AutoAspect, checkAspects, GRADE_LABELS, gradeOf, loadPerfConfig, type PerfAspect, type PerfConfig } from './perf-settings.js';

const day = (d: Date) => d.toISOString().slice(0, 10);
const wan = (n: number) => `${(n / 10000).toLocaleString('zh-CN', { maximumFractionDigits: 1 })} 万`;
const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));
const isMgmt = (u: AuthUser) => u.role === Role.TOP_MANAGEMENT || u.role === Role.TENANT_ADMIN;

export interface AspectResult { key: string; name: string; weight: number; auto: boolean; target: string; actual: string; score: number | null; estimate?: boolean }
interface Viewer { mgmt: boolean; hr: boolean; pm: boolean; deptOf: Set<string>; self: string }

/**
 * 项目绩效评价（第 5C 章）。
 * 项目经理绩效：按交付的时间、质量、成本自动计分，权重企业默认、可按项目调整；管理层可加评语、调整分数（须写理由）并确认。
 * 成员绩效：项目经理按维度打分并写评语，只针对本项目；提交后锁定，发给人事和员工所在部门负责人。
 * 可见范围：管理层、人事、所在部门负责人、项目经理（评价人）、被评价人本人（提交后）；企业可调整。查看、修改、导出都记审计。
 */
@Injectable()
export class EvaluationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly wbs: WbsService,
    private readonly cost: CostControlService,
    private readonly calendars: CalendarService,
  ) {}

  // ───── 谁能看 ─────

  async hrUsers(tenantId: string) {
    const today = day(new Date());
    const rows = await this.prisma.approvalAssignment.findMany({ where: { tenantId, kind: ApprovalRoleKind.HR } });
    return rows.filter((r) => (!r.validFrom || day(r.validFrom) <= today) && (!r.validTo || day(r.validTo) >= today)).map((r) => r.userId);
  }
  headedDepartments(tenantId: string, userId: string) {
    return this.prisma.department.count({ where: { tenantId, headId: userId, active: true } });
  }
  /** 当前用户的身份：管理层、人事、某些部门的负责人 */
  private async viewer(actor: AuthUser, cfg: PerfConfig, projectId?: string): Promise<Viewer> {
    const tenantId = requireTenantId(actor);
    const [hr, depts, pm] = await Promise.all([
      this.hrUsers(tenantId),
      this.prisma.department.findMany({ where: { tenantId, headId: actor.id, active: true }, select: { id: true } }),
      projectId ? this.prisma.projectMember.findFirst({ where: { projectId, userId: actor.id, active: true, projectRole: ProjectRole.PROJECT_MANAGER } }) : null,
    ]);
    return { mgmt: isMgmt(actor), hr: cfg.visibility.hr && hr.includes(actor.id), pm: !!pm, deptOf: new Set(cfg.visibility.deptHead ? depts.map((d) => d.id) : []), self: actor.id };
  }
  private async deptOfUsers(tenantId: string, ids: string[]) {
    const us = await this.prisma.user.findMany({ where: { tenantId, id: { in: ids } }, select: { id: true, departmentId: true } });
    return new Map(us.map((u) => [u.id, u.departmentId]));
  }

  private async project(actor: AuthUser, projectId: string) {
    const p = await this.prisma.project.findFirst({ where: { id: projectId, tenantId: requireTenantId(actor) } });
    if (!p) throw new NotFoundException('Project not found');
    return p;
  }
  private async pms(projectId: string) {
    return (await this.prisma.projectMember.findMany({ where: { projectId, active: true, projectRole: ProjectRole.PROJECT_MANAGER }, select: { userId: true } })).map((m) => m.userId);
  }

  // ───── 项目经理绩效（自动计算） ─────

  async compute(p: Project, cfg: PerfConfig, perf: { aspects: unknown; actualDelivery: Date | null; manualScores: unknown } | null) {
    const tenantId = p.tenantId;
    const ver = p.requirementVersion ? await this.prisma.projectRequirementVersion.findUnique({ where: { projectId_version: { projectId: p.id, version: p.requirementVersion } } }) : null;
    const req = ver ? asRequirements(ver.data) : null;
    const aspects = (Array.isArray(perf?.aspects) && (perf!.aspects as PerfAspect[]).length ? perf!.aspects : cfg.aspects) as PerfAspect[];
    const manual = (perf?.manualScores ?? {}) as Record<string, number>;
    const r = cfg.rules;
    const out: AspectResult[] = [];

    for (const a of aspects) {
      if (!AUTO_ASPECTS.includes(a.key as AutoAspect)) {
        const s = manual[a.key];
        out.push({ ...a, auto: false, target: '管理层评分', actual: s === undefined ? '未评分' : `${s} 分`, score: s === undefined ? null : clamp(s) });
        continue;
      }
      if (a.key === 'TIME') {
        const required = p.customerDeliveryDate ? day(p.customerDeliveryDate) : null;
        let actual = perf?.actualDelivery ? day(perf.actualDelivery) : null;
        let estimate = false;
        if (!actual) {
          const products = await this.prisma.deliverable.findMany({ where: { projectId: p.id }, select: { status: true, updatedAt: true } });
          if (products.length && products.every((d) => d.status === DeliverableStatus.ACCEPTED)) actual = day(new Date(Math.max(...products.map((d) => d.updatedAt.getTime()))));
        }
        if (!actual) { actual = (await this.wbs.scheduleOf(tenantId, p)).projectedEnd; estimate = true; }
        if (!required) { out.push({ ...a, auto: true, target: '没有交期要求', actual: actual ?? '—', score: null, estimate }); continue; }
        const late = (await this.calendars.forTenant(tenantId)).workdaysBetween(required, actual);
        out.push({
          ...a, auto: true, estimate, target: `要求 ${required}`,
          actual: `${estimate ? '预计' : '实际'} ${actual}，${late > 0 ? `晚 ${late} 个工作日` : late < 0 ? `提前 ${-late} 个工作日` : '按期'}`,
          score: late > 0 ? clamp(100 - r.latePerDay * late) : 100,
        });
      } else if (a.key === 'QUALITY') {
        const [items, ncs] = await Promise.all([
          this.prisma.inspectionItem.findMany({ where: { projectId: p.id, firstResult: { in: [InspectionResult.PASS, InspectionResult.FAIL] } }, select: { name: true, category: true, firstResult: true } }),
          this.prisma.nonconformity.findMany({ where: { projectId: p.id }, select: { severity: true, source: true } }),
        ]);
        const fai = items.filter((i) => /FAI|首件/i.test(`${i.name} ${i.category}`));
        const faiFail = fai.some((i) => i.firstResult === InspectionResult.FAIL);
        const fpy = items.length ? Math.round((items.filter((i) => i.firstResult === InspectionResult.PASS).length / items.length) * 1000) / 10 : null;
        const major = ncs.filter((n) => n.severity === NcSeverity.MAJOR).length;
        const critical = ncs.filter((n) => n.severity === NcSeverity.CRITICAL).length;
        const customer = ncs.filter((n) => n.source === NcSource.CUSTOMER).length;
        let s = 100;
        if (faiFail) s -= r.faiNotFirstPass;
        if (fpy !== null && fpy < r.fpyTarget) s -= (r.fpyTarget - fpy) * r.fpyPerPct;
        s -= major * r.majorNc + critical * r.criticalNc + customer * r.customerNc;
        const faiText = req?.quality.fai === false ? '不做 FAI' : !fai.length ? 'FAI 未记录' : faiFail ? 'FAI 未一次通过' : 'FAI 一次通过';
        out.push({
          ...a, auto: true,
          target: `${req?.quality.fai === false ? '' : 'FAI 一次通过；'}一次合格率 ≥ ${r.fpyTarget}%；无重大不符合项和客户投诉`,
          actual: `${faiText}；一次合格率 ${fpy === null ? '—' : fpy + '%'}；重大 ${major}、严重 ${critical}；客户投诉 ${customer}`,
          score: clamp(s),
        });
      } else {
        const target = p.budget !== null ? Number(p.budget) : null;
        const cap = req?.cost.cap || null;
        const eac = (await this.cost.wpCosts(tenantId, p.id)).reduce((n, c) => n + c.eac, 0);
        if (target === null) { out.push({ ...a, auto: true, target: '没有目标成本', actual: wan(eac), score: null }); continue; }
        let s = 100;
        if (eac > target) {
          if (cap && cap > target) s = eac <= cap ? 100 - ((100 - r.capScore) * (eac - target)) / (cap - target) : r.capScore - (r.overCapPerPct * (eac - cap) * 100) / cap;
          else s = 100 - (r.overTargetPerPct * (eac - target) * 100) / target;
        }
        const diff = eac - target;
        out.push({
          ...a, auto: true, target: `目标成本 ${wan(target)}${cap ? `（上限 ${wan(cap)}）` : ''}`,
          actual: `实际 / 完工估算 ${wan(eac)}，${diff > 0 ? `超目标 ${wan(diff)}${cap && eac > cap ? '，超上限' : cap ? '，未超上限' : ''}` : `结余 ${wan(-diff)}`}`,
          score: clamp(s),
        });
      }
    }
    const scored = out.filter((x) => x.score !== null && x.weight > 0);
    const w = scored.reduce((n, x) => n + x.weight, 0);
    const total = w ? Math.round(scored.reduce((n, x) => n + x.weight * x.score!, 0) / w) : null;
    return { aspects: out, total, complete: scored.length === out.filter((x) => x.weight > 0).length };
  }

  private async pmView(p: Project, cfg: PerfConfig) {
    const perf = await this.prisma.projectPerformance.findUnique({ where: { projectId: p.id } });
    const live = perf?.confirmedAt && perf.snapshot ? (perf.snapshot as unknown as Awaited<ReturnType<EvaluationService['compute']>>) : await this.compute(p, cfg, perf);
    const final = perf?.adjustedScore ?? live.total;
    const pmIds = await this.pms(p.id);
    const pmUsers = await this.prisma.user.findMany({ where: { id: { in: pmIds } }, select: { id: true, name: true, departmentId: true } });
    return {
      managers: pmUsers,
      ...live,
      adjustedScore: perf?.adjustedScore ?? null, adjustReason: perf?.adjustReason ?? null, comment: perf?.comment ?? null,
      aspectsReason: perf?.aspectsReason ?? null, customAspects: !!perf?.aspects, actualDelivery: perf?.actualDelivery ? day(perf.actualDelivery) : null,
      score: final, grade: final === null ? null : GRADE_LABELS[gradeOf(cfg.grades, final)],
      confirmedAt: perf?.confirmedAt ?? null, confirmedById: perf?.confirmedById ?? null,
    };
  }

  // ───── 成员参考数据 ─────

  private async reference(p: Project, userIds: string[]) {
    const today = day(new Date());
    const [sched, items, issues] = await Promise.all([
      this.wbs.scheduleOf(p.tenantId, p),
      this.prisma.inspectionItem.findMany({ where: { projectId: p.id, firstResult: { in: [InspectionResult.PASS, InspectionResult.FAIL] } }, select: { workPackageId: true, firstResult: true } }),
      this.prisma.issue.findMany({ where: { projectId: p.id, kind: IssueKind.ACTION, ownerId: { in: userIds } }, select: { ownerId: true, dueDate: true, status: true, closedAt: true } }),
    ]);
    const out = new Map<string, { workPackages: number; done: number; onTimeRate: number | null; firstPassYield: number | null; overruns: number; overdueActions: number; text: string }>();
    for (const uid of userIds) {
      const wps = sched.items.filter((w) => w.isLeaf && w.ownerId === uid);
      const done = wps.filter((w) => w.status === WpStatus.DONE || w.status === WpStatus.VERIFIED);
      const onTime = done.filter((w) => w.actualEnd && day(w.actualEnd) <= w.scheduledEnd).length;
      const ids = new Set(wps.map((w) => w.id));
      const its = items.filter((i) => ids.has(i.workPackageId));
      const fpy = its.length ? Math.round((its.filter((i) => i.firstResult === InspectionResult.PASS).length / its.length) * 1000) / 10 : null;
      const overruns = wps.filter((w) => w.costAlert).length;
      const overdue = issues.filter((i) => i.ownerId === uid && i.dueDate && (i.status === IssueStatus.CLOSED ? i.closedAt && day(i.closedAt) > day(i.dueDate) : day(i.dueDate) < today)).length;
      const onTimeRate = done.length ? Math.round((onTime / done.length) * 100) : null;
      out.set(uid, {
        workPackages: wps.length, done: done.length, onTimeRate, firstPassYield: fpy, overruns, overdueActions: overdue,
        text: [`工作包 ${wps.length}`, `按时 ${onTimeRate === null ? '—' : onTimeRate + '%'}`, `一次合格 ${fpy === null ? '—' : fpy + '%'}`, overruns ? `${overruns} 个超支` : '', overdue ? `逾期行动 ${overdue}` : ''].filter(Boolean).join(' · '),
      });
    }
    return out;
  }

  // ───── 读取 ─────

  /** 项目的绩效评价：按身份只返回能看的部分 */
  async get(actor: AuthUser, projectId: string) {
    const p = await this.project(actor, projectId);
    const cfg = await loadPerfConfig(this.prisma, p.tenantId);
    const v = await this.viewer(actor, cfg, projectId);
    const pmIds = await this.pms(projectId);
    const depts = await this.deptOfUsers(p.tenantId, pmIds);
    const seePm = v.mgmt || v.hr || pmIds.includes(actor.id) || pmIds.some((id) => v.deptOf.has(depts.get(id) ?? ''));

    const members = await this.prisma.projectMember.findMany({ where: { projectId, active: true }, select: { userId: true, projectRole: true } });
    const memberIds = [...new Set(members.map((m) => m.userId))].filter((id) => !pmIds.includes(id));
    const evals = await this.prisma.memberEvaluation.findMany({ where: { projectId } });
    const users = await this.prisma.user.findMany({ where: { id: { in: [...new Set([...memberIds, ...evals.map((e) => e.userId)])] } }, select: { id: true, name: true, departmentId: true, functionalRoleId: true } });
    const roles = await this.prisma.functionalRole.findMany({ where: { tenantId: p.tenantId }, select: { id: true, name: true } });
    const canSee = (uid: string, submitted: boolean) =>
      v.mgmt || v.hr || v.pm || v.deptOf.has(users.find((u) => u.id === uid)?.departmentId ?? '') || (cfg.visibility.memberSelf && submitted && uid === actor.id);
    const visible = users.filter((u) => canSee(u.id, evals.find((e) => e.userId === u.id)?.status === EvaluationStatus.SUBMITTED));
    if (!seePm && !visible.length) throw new ForbiddenException('No access to this evaluation');

    const refs = v.pm || v.mgmt ? await this.reference(p, visible.filter((u) => memberIds.includes(u.id)).map((u) => u.id)) : new Map();
    const rows = visible.map((u) => {
      const e = evals.find((x) => x.userId === u.id);
      const live = refs.get(u.id);
      const editing = v.pm && (!e || e.status === EvaluationStatus.DRAFT);
      return {
        userId: u.id, name: u.name, roleName: e?.roleName || roles.find((r) => r.id === u.functionalRoleId)?.name || '',
        reference: e?.status === EvaluationStatus.SUBMITTED ? e.reference : live ?? e?.reference ?? null,
        scores: e?.scores ?? {}, score: e?.score ?? null, grade: e?.grade || null, comment: e?.comment ?? '',
        status: e?.status ?? EvaluationStatus.DRAFT, version: e?.version ?? 0, submittedAt: e?.submittedAt ?? null, editable: editing && p.status !== 'CANCELLED',
      };
    });
    if (!v.pm) {
      await this.audit.record({ tenantId: p.tenantId, actorId: actor.id, action: 'evaluation.view', entity: 'Project', entityId: projectId, after: { members: rows.map((r) => r.userId), pm: seePm } });
    }
    return {
      config: { aspects: cfg.aspects, memberDims: cfg.memberDims, grades: cfg.grades },
      pm: seePm ? await this.pmView(p, cfg) : null,
      members: rows,
      can: { evaluate: v.pm, manage: v.mgmt, setWeights: v.pm || v.mgmt, export: v.mgmt || v.hr || v.pm || v.deptOf.size > 0 },
    };
  }

  // ───── 项目经理绩效：权重、实际交付、评语与调整、确认 ─────

  private async perfRow(tenantId: string, projectId: string) {
    // 两次保存同时到达时不能重复创建
    await this.prisma.projectPerformance.createMany({ data: [{ tenantId, projectId }], skipDuplicates: true });
    return this.prisma.projectPerformance.findUniqueOrThrow({ where: { projectId } });
  }
  private locked(row: { confirmedAt: Date | null }) {
    if (row.confirmedAt) throw new ConflictException({ code: 'EVALUATION_CONFIRMED', message: 'The project manager evaluation has been confirmed' });
  }

  async setAspects(actor: AuthUser, projectId: string, aspects: PerfAspect[] | null, reason: string) {
    const p = await this.project(actor, projectId);
    const pmIds = await this.pms(projectId);
    if (!isMgmt(actor) && !pmIds.includes(actor.id)) throw new ForbiddenException('Project manager or management required');
    if (aspects) { const err = checkAspects(aspects); if (err) throw new BadRequestException(err); }
    if (!reason?.trim()) throw new BadRequestException({ code: 'REASON_REQUIRED', message: 'Reason is required to change the weights' });
    const row = await this.perfRow(p.tenantId, projectId);
    this.locked(row);
    const next = aspects ? (aspects.map((x) => ({ key: x.key, name: x.name.trim(), weight: x.weight })) as unknown as Prisma.InputJsonValue) : Prisma.DbNull;
    return this.audit.tx(actor, { action: 'evaluation.weights', entity: 'Project', entityId: () => projectId, before: { aspects: (row.aspects ?? null) as Prisma.InputJsonValue }, after: () => ({ aspects: (aspects ?? null) as unknown as Prisma.InputJsonValue, reason }) },
      (tx) => tx.projectPerformance.update({ where: { id: row.id }, data: { aspects: next, aspectsReason: reason.trim() } }));
  }

  async updatePm(actor: AuthUser, projectId: string, dto: { actualDelivery?: string | null; manualScores?: Record<string, number>; comment?: string; adjustedScore?: number | null; adjustReason?: string }) {
    const p = await this.project(actor, projectId);
    const pmIds = await this.pms(projectId);
    const mgmt = isMgmt(actor);
    if (!mgmt && !pmIds.includes(actor.id)) throw new ForbiddenException('Project manager or management required');
    if (!mgmt && (dto.manualScores || dto.comment !== undefined || dto.adjustedScore !== undefined)) throw new ForbiddenException('Management only');
    if (dto.adjustedScore !== undefined && dto.adjustedScore !== null && !dto.adjustReason?.trim()) throw new BadRequestException({ code: 'REASON_REQUIRED', message: 'Reason is required to adjust the score' });
    for (const v of Object.values(dto.manualScores ?? {})) if (!Number.isInteger(v) || v < 0 || v > 100) throw new BadRequestException('Scores are 0–100');
    const row = await this.perfRow(p.tenantId, projectId);
    this.locked(row);
    return this.audit.tx(actor,
      { action: 'evaluation.pm', entity: 'Project', entityId: () => projectId, before: { adjustedScore: row.adjustedScore, comment: row.comment, actualDelivery: row.actualDelivery ? day(row.actualDelivery) : null }, after: () => dto as unknown as Prisma.InputJsonValue },
      (tx) => tx.projectPerformance.update({
        where: { id: row.id },
        data: {
          ...(dto.actualDelivery !== undefined ? { actualDelivery: dto.actualDelivery ? new Date(dto.actualDelivery) : null } : {}),
          ...(dto.manualScores ? { manualScores: { ...(row.manualScores as object), ...dto.manualScores } } : {}),
          ...(dto.comment !== undefined ? { comment: dto.comment.trim() } : {}),
          ...(dto.adjustedScore !== undefined ? { adjustedScore: dto.adjustedScore, adjustReason: dto.adjustedScore === null ? null : dto.adjustReason!.trim() } : {}),
        },
      }));
  }

  /** 管理层确认：计算结果冻结，通知项目经理、人事和项目经理所在部门负责人 */
  async confirmPm(actor: AuthUser, projectId: string) {
    if (!isMgmt(actor)) throw new ForbiddenException('Management only');
    const p = await this.project(actor, projectId);
    const cfg = await loadPerfConfig(this.prisma, p.tenantId);
    const row = await this.perfRow(p.tenantId, projectId);
    this.locked(row);
    const snap = await this.compute(p, cfg, row);
    if (!snap.complete) throw new ConflictException({ code: 'EVALUATION_INCOMPLETE', message: 'Some aspects have no score yet' });
    const done = await this.audit.tx(actor, { action: 'evaluation.confirm', entity: 'Project', entityId: () => projectId, after: () => ({ total: snap.total, adjusted: row.adjustedScore }) },
      (tx) => tx.projectPerformance.update({ where: { id: row.id }, data: { snapshot: snap as unknown as Prisma.InputJsonValue, confirmedAt: new Date(), confirmedById: actor.id } }));
    const pmIds = await this.pms(projectId);
    await this.notifications.notify(p.tenantId, [...pmIds, ...(cfg.visibility.hr ? await this.hrUsers(p.tenantId) : []), ...(await this.heads(p.tenantId, pmIds, cfg))], {
      kind: 'EVALUATION_SUBMITTED', title: `项目经理绩效已确认：${p.code} ${p.name}`, body: `综合 ${row.adjustedScore ?? snap.total} 分`, link: `/projects/${projectId}?g=close&s=closure`,
    }, actor.id);
    return done;
  }

  private async heads(tenantId: string, userIds: string[], cfg: PerfConfig) {
    if (!cfg.visibility.deptHead) return [];
    const deps = [...new Set([...(await this.deptOfUsers(tenantId, userIds)).values()].filter((x): x is string => !!x))];
    return (await this.prisma.department.findMany({ where: { id: { in: deps }, active: true }, select: { headId: true } })).map((d) => d.headId);
  }

  // ───── 成员评价 ─────

  private async requirePm(actor: AuthUser, projectId: string) {
    const p = await this.project(actor, projectId);
    if (!(await this.pms(projectId)).includes(actor.id)) throw new ForbiddenException('Only the project manager evaluates members');
    return p;
  }

  async saveMember(actor: AuthUser, projectId: string, userId: string, dto: { scores: Record<string, number>; comment?: string }) {
    const p = await this.requirePm(actor, projectId);
    const cfg = await loadPerfConfig(this.prisma, p.tenantId);
    const member = await this.prisma.projectMember.findFirst({ where: { projectId, userId } });
    if (!member) throw new NotFoundException('Not a member of this project');
    if (userId === actor.id) throw new BadRequestException('The project manager is evaluated through the project result');
    for (const [k, v] of Object.entries(dto.scores ?? {})) {
      if (!cfg.memberDims.includes(k)) throw new BadRequestException(`Unknown dimension ${k}`);
      if (!Number.isInteger(v) || v < 1 || v > 5) throw new BadRequestException('Scores are 1–5');
    }
    // 先确保有记录（连续快速打分时请求会同时到达）
    await this.prisma.memberEvaluation.createMany({ data: [{ tenantId: p.tenantId, projectId, userId, evaluatorId: actor.id }], skipDuplicates: true });
    const cur = await this.prisma.memberEvaluation.findUniqueOrThrow({ where: { projectId_userId: { projectId, userId } } });
    if (cur.status === EvaluationStatus.SUBMITTED) throw new ConflictException({ code: 'EVALUATION_SUBMITTED', message: 'Submitted evaluations are locked; reopen to change' });
    const scores = { ...(cur.scores as Record<string, number>), ...dto.scores };
    const vals = cfg.memberDims.map((d) => scores[d]).filter((x) => x !== undefined);
    const score = vals.length ? Math.round((vals.reduce((n, x) => n + x, 0) / vals.length) * 20) : 0;
    const data = { scores, score, grade: vals.length ? GRADE_LABELS[gradeOf(cfg.grades, score)] : '', comment: dto.comment?.trim() ?? cur.comment, evaluatorId: actor.id };
    return this.audit.tx(actor, { action: 'evaluation.member.save', entity: 'MemberEvaluation', entityId: (x) => x.id, before: { scores: cur.scores, comment: cur.comment } as Prisma.InputJsonValue, after: () => ({ userId, scores, comment: data.comment }) },
      (tx) => tx.memberEvaluation.update({ where: { id: cur.id }, data }));
  }

  /** 提交：所有维度必须打分；冻结参考数据；通知人事、所在部门负责人和本人 */
  async submitMember(actor: AuthUser, projectId: string, userId: string) {
    const p = await this.requirePm(actor, projectId);
    const cfg = await loadPerfConfig(this.prisma, p.tenantId);
    const e = await this.prisma.memberEvaluation.findUnique({ where: { projectId_userId: { projectId, userId } } });
    if (!e) throw new NotFoundException('Evaluation not found');
    if (e.status === EvaluationStatus.SUBMITTED) throw new ConflictException('Already submitted');
    const scores = e.scores as Record<string, number>;
    const missing = cfg.memberDims.filter((d) => scores[d] === undefined);
    if (missing.length) throw new BadRequestException({ code: 'SCORES_INCOMPLETE', message: `Missing: ${missing.join(', ')}`, missing });
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { name: true, functionalRoleId: true } });
    const role = user.functionalRoleId ? await this.prisma.functionalRole.findUnique({ where: { id: user.functionalRoleId } }) : null;
    const ref = (await this.reference(p, [userId])).get(userId);
    const done = await this.audit.tx(actor, { action: 'evaluation.member.submit', entity: 'MemberEvaluation', entityId: () => e.id, after: () => ({ userId, score: e.score, grade: e.grade, version: e.version + 1 }) },
      (tx) => tx.memberEvaluation.update({ where: { id: e.id }, data: { status: EvaluationStatus.SUBMITTED, submittedAt: new Date(), version: e.version + 1, reference: (ref ?? {}) as Prisma.InputJsonValue, roleName: e.roleName || role?.name || '' } }));
    const to = [...(cfg.visibility.hr ? await this.hrUsers(p.tenantId) : []), ...(await this.heads(p.tenantId, [userId], cfg)), ...(cfg.visibility.memberSelf ? [userId] : [])];
    await this.notifications.notify(p.tenantId, to, {
      kind: 'EVALUATION_SUBMITTED', title: `项目绩效评价单：${user.name} · ${p.code} ${p.name}`, body: `${e.grade}（${e.score} 分）${e.version ? `，第 ${e.version + 1} 次提交` : ''}`, link: '/evaluations',
    }, actor.id);
    return done;
  }

  /** 撤回修改：回到草稿，修改后须重新提交（留审计） */
  async reopenMember(actor: AuthUser, projectId: string, userId: string, reason: string) {
    await this.requirePm(actor, projectId);
    if (!reason?.trim()) throw new BadRequestException({ code: 'REASON_REQUIRED', message: 'Reason is required' });
    const e = await this.prisma.memberEvaluation.findUnique({ where: { projectId_userId: { projectId, userId } } });
    if (!e || e.status !== EvaluationStatus.SUBMITTED) throw new ConflictException('Only submitted evaluations can be reopened');
    return this.audit.tx(actor, { action: 'evaluation.member.reopen', entity: 'MemberEvaluation', entityId: () => e.id, before: { score: e.score, grade: e.grade, scores: e.scores as Prisma.InputJsonValue, comment: e.comment }, after: () => ({ reason }) },
      (tx) => tx.memberEvaluation.update({ where: { id: e.id }, data: { status: EvaluationStatus.DRAFT } }));
  }

  // ───── 评价单（人事、部门负责人、管理层、本人） ─────

  /** 当前用户能看到的已提交评价单（成员）和已确认的项目经理绩效；可按项目关闭时间筛选 */
  async sheets(actor: AuthUser, q: { from?: string; to?: string; projectId?: string }) {
    const tenantId = requireTenantId(actor);
    const cfg = await loadPerfConfig(this.prisma, tenantId);
    const v = await this.viewer(actor, cfg);
    const evals = await this.prisma.memberEvaluation.findMany({ where: { tenantId, status: EvaluationStatus.SUBMITTED, ...(q.projectId ? { projectId: q.projectId } : {}) }, orderBy: { submittedAt: 'desc' } });
    const perfs = await this.prisma.projectPerformance.findMany({ where: { tenantId, confirmedAt: { not: null }, ...(q.projectId ? { projectId: q.projectId } : {}) } });
    const projectIds = [...new Set([...evals.map((e) => e.projectId), ...perfs.map((x) => x.projectId)])];
    const projects = await this.prisma.project.findMany({ where: { tenantId, id: { in: projectIds } }, select: { id: true, code: true, name: true, status: true, updatedAt: true } });
    const pmByProject = new Map<string, string[]>();
    for (const pid of projectIds) pmByProject.set(pid, await this.pms(pid));
    const userIds = [...new Set([...evals.map((e) => e.userId), ...evals.map((e) => e.evaluatorId), ...[...pmByProject.values()].flat()])];
    const users = await this.prisma.user.findMany({ where: { tenantId, id: { in: userIds } }, select: { id: true, name: true, departmentId: true } });
    const depts = await this.prisma.department.findMany({ where: { tenantId }, select: { id: true, name: true } });
    const uname = (id: string) => users.find((u) => u.id === id)?.name ?? '—';
    const udept = (id: string) => users.find((u) => u.id === id)?.departmentId ?? null;
    const dname = (id: string | null) => depts.find((d) => d.id === id)?.name ?? '';
    const sees = (uid: string) => v.mgmt || v.hr || v.deptOf.has(udept(uid) ?? '') || (uid === actor.id && cfg.visibility.memberSelf);
    const inRange = (pid: string, at: Date | null) => { const d = at ? day(at) : day(projects.find((x) => x.id === pid)!.updatedAt); return (!q.from || d >= q.from) && (!q.to || d <= q.to); };
    const proj = (pid: string) => { const x = projects.find((y) => y.id === pid)!; return { id: x.id, code: x.code, name: x.name, status: x.status }; };
    const members = evals.filter((e) => sees(e.userId) && inRange(e.projectId, e.submittedAt)).map((e) => ({
      kind: 'MEMBER' as const, id: e.id, project: proj(e.projectId), userId: e.userId, name: uname(e.userId), department: dname(udept(e.userId)), roleName: e.roleName,
      evaluator: uname(e.evaluatorId), reference: e.reference, scores: e.scores, score: e.score, grade: e.grade, comment: e.comment, version: e.version, submittedAt: e.submittedAt,
    }));
    const pms = [];
    for (const x of perfs) {
      for (const uid of pmByProject.get(x.projectId) ?? []) {
        if (!(v.mgmt || v.hr || v.deptOf.has(udept(uid) ?? '') || uid === actor.id) || !inRange(x.projectId, x.confirmedAt)) continue;
        const snap = x.snapshot as unknown as { aspects: AspectResult[]; total: number | null };
        const score = x.adjustedScore ?? snap.total ?? 0;
        pms.push({
          kind: 'PM' as const, id: x.id, project: proj(x.projectId), userId: uid, name: uname(uid), department: dname(udept(uid)), roleName: '项目经理',
          aspects: snap.aspects, score, grade: GRADE_LABELS[gradeOf(cfg.grades, score)], comment: x.comment ?? '', adjustReason: x.adjustReason, submittedAt: x.confirmedAt,
        });
      }
    }
    return { pms, members };
  }

  async exportSheets(actor: AuthUser, q: { from?: string; to?: string; projectId?: string }) {
    const { pms, members } = await this.sheets(actor, q);
    const cfg = await loadPerfConfig(this.prisma, requireTenantId(actor));
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('项目绩效评价单');
    ws.columns = [
      { header: '项目', key: 'project', width: 26 }, { header: '姓名', key: 'name', width: 10 }, { header: '部门', key: 'dept', width: 12 }, { header: '角色', key: 'role', width: 10 },
      { header: '参考数据', key: 'ref', width: 44 }, { header: '各项得分', key: 'scores', width: 44 }, { header: '综合', key: 'score', width: 8 }, { header: '等级', key: 'grade', width: 8 },
      { header: '评语', key: 'comment', width: 40 }, { header: '评价人 / 确认', key: 'by', width: 12 }, { header: '日期', key: 'date', width: 12 },
    ];
    ws.getRow(1).font = { bold: true };
    for (const x of pms) {
      ws.addRow({ project: `${x.project.code} ${x.project.name}`, name: x.name, dept: x.department, role: x.roleName, ref: x.aspects.map((a) => `${a.name}：${a.actual}`).join('\n'),
        scores: x.aspects.map((a) => `${a.name} ${a.weight}%：${a.score ?? '—'}`).join('\n'), score: x.score, grade: x.grade, comment: [x.comment, x.adjustReason ? `调整：${x.adjustReason}` : ''].filter(Boolean).join('\n'), by: '管理层', date: x.submittedAt ? day(x.submittedAt) : '' });
    }
    for (const x of members) {
      const sc = x.scores as Record<string, number>;
      ws.addRow({ project: `${x.project.code} ${x.project.name}`, name: x.name, dept: x.department, role: x.roleName, ref: (x.reference as { text?: string })?.text ?? '',
        scores: cfg.memberDims.map((d) => `${d}：${sc[d] ?? '—'}`).join('\n'), score: x.score, grade: x.grade, comment: x.comment, by: x.evaluator, date: x.submittedAt ? day(x.submittedAt) : '' });
    }
    ws.eachRow((r) => { r.alignment = { wrapText: true, vertical: 'top' }; });
    await this.audit.record({ tenantId: requireTenantId(actor), actorId: actor.id, action: 'evaluation.export', entity: 'Tenant', entityId: requireTenantId(actor), after: { ...q, pms: pms.length, members: members.length } });
    return Buffer.from(await wb.xlsx.writeBuffer());
  }
}
