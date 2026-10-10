import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { InspectionResult, ObjectiveMetric, RiskKind, RiskStatus } from '../generated/prisma/enums.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthUser } from '../common/auth.types.js';
import { asRequirements } from '../initiations/requirements.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ProjectAccess } from '../projects/access.service.js';
import { CostControlService } from '../projects/cost-control.service.js';
import { WbsService } from '../projects/wbs.service.js';
import { faiSummary } from '../delivery/checks.js';
import { ObjectiveDto, UpdateObjectiveDto } from './dto.js';
import { importanceOf, loadRiskSettings } from './risk-settings.js';

type Tx = Prisma.TransactionClient | PrismaService;
const wan = (n: number) => `${(n / 10000).toLocaleString('zh-CN', { maximumFractionDigits: 2 })} 万`;
export type ObjState = 'GREEN' | 'AMBER' | 'RED' | 'GREY';

/**
 * 项目目标（第 5B 章）：由项目要求生成交期、成本、质量目标，项目经理可补充自定义目标。
 * 目标状态同时看指标是否偏离、以及是否还有影响它的未关闭高风险（指标正常但有高风险时为“关注”）。
 */
@Injectable()
export class ObjectivesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: ProjectAccess,
    private readonly wbs: WbsService,
    private readonly cost: CostControlService,
  ) {}

  /** 按项目要求（没有时按项目交期和预算）生成或更新自动目标；已有目标保留 id，风险的关联不丢 */
  async syncAuto(tx: Tx, tenantId: string, projectId: string) {
    const p = await tx.project.findUniqueOrThrow({ where: { id: projectId } });
    const ver = p.requirementVersion ? await tx.projectRequirementVersion.findUnique({ where: { projectId_version: { projectId, version: p.requirementVersion } } }) : null;
    const req = ver ? asRequirements(ver.data) : null;
    const due = p.customerDeliveryDate?.toISOString().slice(0, 10);
    const target = p.budget !== null ? Number(p.budget) : null;
    const want: { metric: ObjectiveMetric; dimension: string; name: string; target: string }[] = [];
    if (due) want.push({ metric: ObjectiveMetric.DELIVERY, dimension: '交期', name: p.type === 'C' ? '全部入库' : '全部交付', target: `不晚于 ${due}` });
    if (target !== null || req?.cost.cap) {
      want.push({ metric: ObjectiveMetric.COST, dimension: '成本', name: '完工成本', target: `不超过目标成本 ${target !== null ? wan(target) : '—'}${req?.cost.cap ? `（上限 ${wan(req.cost.cap)}）` : ''}` });
    }
    if (req?.quality.fai) want.push({ metric: ObjectiveMetric.FAI, dimension: '质量', name: 'FAI 首件鉴定', target: `一次通过${req.quality.customerWitness ? '（客户见证）' : ''}` });
    const have = await tx.projectObjective.findMany({ where: { projectId, auto: true } });
    for (const [i, w] of want.entries()) {
      const cur = have.find((h) => h.metric === w.metric);
      if (cur) await tx.projectObjective.update({ where: { id: cur.id }, data: { name: w.name, target: w.target, dimension: w.dimension } });
      else await tx.projectObjective.create({ data: { tenantId, projectId, ...w, auto: true, sortOrder: i } });
    }
    const drop = have.filter((h) => !want.some((w) => w.metric === h.metric));
    if (drop.length) {
      await tx.risk.updateMany({ where: { objectiveId: { in: drop.map((d) => d.id) } }, data: { objectiveId: null } });
      await tx.projectObjective.deleteMany({ where: { id: { in: drop.map((d) => d.id) } } });
    }
  }

  async list(actor: AuthUser, projectId: string) {
    const ctx = await this.access.load(actor, projectId);
    if (!(await this.prisma.projectObjective.count({ where: { projectId } }))) await this.syncAuto(this.prisma, ctx.tenantId, projectId);
    const [objs, risks, s] = await Promise.all([
      this.prisma.projectObjective.findMany({ where: { projectId, tenantId: ctx.tenantId }, orderBy: [{ auto: 'desc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }] }),
      this.prisma.risk.findMany({ where: { projectId, tenantId: ctx.tenantId, objectiveId: { not: null } }, select: { id: true, kind: true, title: true, probability: true, impact: true, status: true, objectiveId: true } }),
      loadRiskSettings(this.prisma, ctx.tenantId),
    ]);
    const metrics = await this.metrics(ctx.tenantId, ctx.project);
    return objs.map((o) => {
      const related = risks.filter((r) => r.objectiveId === o.id && r.status !== RiskStatus.CLOSED).map((r) => ({ ...r, importance: importanceOf(s, r.probability, r.impact) }));
      const m = o.metric === ObjectiveMetric.MANUAL ? { current: o.current, state: (o.manualState as ObjState | null) ?? 'GREY' } : metrics[o.metric] ?? { current: o.current, state: 'GREY' as ObjState };
      const highRisk = related.some((r) => r.kind === RiskKind.RISK && r.importance === 'HIGH' && r.status !== RiskStatus.OCCURRED);
      const state: ObjState = m.state === 'RED' ? 'RED' : highRisk ? 'AMBER' : m.state;
      return { ...o, currentText: m.current, metricState: m.state, state, highRisk, risks: related };
    });
  }

  /** 能自动取数的指标：交期看预计完工，成本看完工估算，一次合格率看检验记录 */
  private async metrics(tenantId: string, project: Prisma.ProjectGetPayload<object>): Promise<Partial<Record<ObjectiveMetric, { current: string; state: ObjState }>>> {
    const out: Partial<Record<ObjectiveMetric, { current: string; state: ObjState }>> = {};
    const sched = await this.wbs.scheduleOf(tenantId, project);
    if (sched.requiredEnd && sched.items.length) {
      const late = (sched.gapDays ?? 0) > 0;
      out.DELIVERY = { current: `预计 ${sched.projectedEnd}${late ? `，晚 ${sched.gapDays} 个工作日` : ''}`, state: late ? 'RED' : 'GREEN' };
    }
    const costs = await this.cost.wpCosts(tenantId, project.id);
    const eac = costs.reduce((n, c) => n + c.eac, 0);
    if (project.budget !== null) {
      const t = Number(project.budget);
      out.COST = { current: `完工估算 ${wan(eac)}`, state: project.costAlert || eac > t ? 'RED' : eac > t * 0.95 ? 'AMBER' : 'GREEN' };
    }
    const fai = await faiSummary(this.prisma, project.id);
    if (fai.records.length) out.FAI = { current: fai.text, state: fai.state };
    const items = await this.prisma.inspectionItem.findMany({ where: { projectId: project.id, firstResult: { in: [InspectionResult.PASS, InspectionResult.FAIL] } }, select: { firstResult: true } });
    if (items.length) {
      const fpy = Math.round((items.filter((i) => i.firstResult === InspectionResult.PASS).length / items.length) * 1000) / 10;
      out.FIRST_PASS_YIELD = { current: `一次合格率 ${fpy}%`, state: 'GREY' };
    }
    return out;
  }

  async create(actor: AuthUser, projectId: string, dto: ObjectiveDto) {
    const ctx = await this.access.load(actor, projectId);
    this.access.requireManager(ctx);
    this.access.requireOpen(ctx);
    if (dto.metric && dto.metric !== ObjectiveMetric.MANUAL && dto.metric !== ObjectiveMetric.FIRST_PASS_YIELD) throw new BadRequestException('Only manual or first-pass-yield metrics can be added');
    return this.audit.tx(
      actor,
      { action: 'objective.create', entity: 'ProjectObjective', entityId: (o) => o.id, after: (o) => ({ name: o.name, target: o.target }) },
      (tx) => tx.projectObjective.create({ data: { tenantId: ctx.tenantId, projectId, dimension: dto.dimension.trim(), name: dto.name.trim(), target: dto.target.trim(), metric: dto.metric ?? ObjectiveMetric.MANUAL } }),
    );
  }

  async update(actor: AuthUser, projectId: string, id: string, dto: UpdateObjectiveDto) {
    const ctx = await this.access.load(actor, projectId);
    this.access.requireManager(ctx);
    this.access.requireOpen(ctx);
    const o = await this.prisma.projectObjective.findFirst({ where: { id, projectId, tenantId: ctx.tenantId } });
    if (!o) throw new NotFoundException('Objective not found');
    if (o.auto && (dto.name !== undefined || dto.target !== undefined || dto.dimension !== undefined)) throw new ConflictException('Objectives generated from the project requirements change through a requirement change');
    return this.audit.tx(
      actor,
      { action: 'objective.update', entity: 'ProjectObjective', entityId: () => id, before: { name: o.name, target: o.target, current: o.current, state: o.manualState }, after: (x) => ({ name: x.name, target: x.target, current: x.current, state: x.manualState }) },
      (tx) => tx.projectObjective.update({ where: { id }, data: { dimension: dto.dimension?.trim(), name: dto.name?.trim(), target: dto.target?.trim(), current: dto.current?.trim(), manualState: dto.manualState } }),
    );
  }

  async remove(actor: AuthUser, projectId: string, id: string) {
    const ctx = await this.access.load(actor, projectId);
    this.access.requireManager(ctx);
    this.access.requireOpen(ctx);
    const o = await this.prisma.projectObjective.findFirst({ where: { id, projectId, tenantId: ctx.tenantId } });
    if (!o) throw new NotFoundException('Objective not found');
    if (o.auto) throw new ConflictException('Objectives generated from the project requirements cannot be deleted');
    await this.audit.tx(actor, { action: 'objective.delete', entity: 'ProjectObjective', entityId: () => id, before: { name: o.name } }, async (tx) => {
      await tx.risk.updateMany({ where: { objectiveId: id }, data: { objectiveId: null } });
      await tx.projectObjective.delete({ where: { id } });
    });
    return { ok: true };
  }
}
