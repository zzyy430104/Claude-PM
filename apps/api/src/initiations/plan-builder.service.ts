import { Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { DeliverableKind, ProjectRole, ProjectType, RiskKind } from '../generated/prisma/enums.js';
import { DEFAULT_ACCOUNTS } from '../projects/cost-control.service.js';
import { ObjectivesService } from '../governance/objectives.service.js';
import { loadRiskSettings, ruleOf, importanceOf } from '../governance/risk-settings.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { DEFAULT_TEMPLATES, DELIVERY_MILESTONE, generatePlan, isGroup, phaseRule, type TemplateRow } from './plan-templates.js';
import { effectiveDeliveryDate, type Requirements } from './requirements.js';

type Tx = Prisma.TransactionClient;
const REVIEW_INTERVAL = { LOW: 60, MEDIUM: 30, HIGH: 14 } as const;

export interface ProjectSeed {
  tenantId: string; actorId: string; initiationId: string;
  code: string; name: string; type: ProjectType; riskLevel: 'LOW' | 'MEDIUM' | 'HIGH'; description: string;
  startDate: Date; managerId: string; requirements: Requirements;
}

/** 立项批准后生成项目：阶段、计划草稿（按类型模板取舍并接好依赖）、交付物、初步风险、项目要求第 1 版 */
@Injectable()
export class PlanBuilderService {
  constructor(private readonly prisma: PrismaService, private readonly objectives: ObjectivesService) {}

  /** 企业改过的模板优先，否则用系统默认模板 */
  async templateRows(tenantId: string, type: ProjectType, tx: Tx | PrismaService = this.prisma): Promise<TemplateRow[]> {
    const t = await tx.planTypeTemplate.findUnique({ where: { tenantId_type: { tenantId, type } } });
    return (t?.items as unknown as TemplateRow[] | undefined) ?? DEFAULT_TEMPLATES[type];
  }

  async createProject(tx: Tx, s: ProjectSeed) {
    const req = s.requirements;
    const due = effectiveDeliveryDate(s.type, req);
    const end = due ? new Date(due) : s.startDate;
    const project = await tx.project.create({
      data: {
        tenantId: s.tenantId, code: s.code, name: s.name, description: s.description, riskLevel: s.riskLevel, type: s.type,
        startDate: s.startDate, endDate: end, customerDeliveryDate: due ? new Date(due) : null,
        budget: req.cost.target ?? (req.cost.cap || null), reviewIntervalDays: REVIEW_INTERVAL[s.riskLevel],
        initiationId: s.initiationId, requirementVersion: 1, createdById: s.actorId,
      },
    });
    await tx.projectMember.create({ data: { tenantId: s.tenantId, projectId: project.id, userId: s.managerId, projectRole: ProjectRole.PROJECT_MANAGER, isCcb: true } });
    await tx.projectRequirementVersion.create({
      data: { tenantId: s.tenantId, projectId: project.id, version: 1, data: { type: s.type, ...req } as unknown as Prisma.InputJsonValue, reason: '立项批准', approvedById: s.actorId },
    });
    const removed = await this.buildPlan(tx, s.tenantId, project.id, s.type, req, due);
    await this.objectives.syncAuto(tx, s.tenantId, project.id);
    if (req.risks.length) {
      // 立项时的初步风险按“中”带入，待项目经理评估
      const rs = await loadRiskSettings(tx, s.tenantId);
      const mid = rs.scale === 5 ? 3 : 2;
      const days = ruleOf(rs, 'PROJECT', importanceOf(rs, mid, mid)).reviewDays;
      const next = new Date(Date.now() + days * 86_400_000);
      await tx.risk.createMany({
        data: req.risks.map((r) => ({
          nextReviewAt: new Date(next.toISOString().slice(0, 10)), reviewCycleDays: days,
          tenantId: s.tenantId, projectId: project.id, kind: r.kind === 'OPPORTUNITY' ? RiskKind.OPPORTUNITY : RiskKind.RISK, title: r.text,
          probability: mid, impact: mid, exposureAmount: 0, responseCost: 0, costBenefitAnalysis: '立项时识别，待项目经理评估', createdById: s.actorId, ownerId: s.managerId,
        })),
      });
    }
    return { project, removed };
  }

  /** 阶段 + WBS 草稿 + 依赖 + 交付物 */
  private async buildPlan(tx: Tx, tenantId: string, projectId: string, type: ProjectType, req: Requirements, due: string | undefined) {
    const rows = await this.templateRows(tenantId, type, tx);
    const plan = generatePlan(type, rows, req);
    const phaseIds = new Map<string, string>();
    for (const [i, name] of plan.phases.entries()) {
      const rule = phaseRule(name);
      const ph = await tx.phase.create({ data: { tenantId, projectId, name, order: i + 1, checklist: rule.checklist, mandatoryRoles: rule.mandatoryRoles } });
      phaseIds.set(name, ph.id);
    }
    const roles = await tx.functionalRole.findMany({ where: { tenantId, active: true } });
    const roleId = (name: string) => roles.find((r) => r.name === name)?.id ?? null;

    // 默认成本科目；工作包人工 = 工期（按 1 人全职估算的人天）× 职能角色标准费率
    await tx.costAccount.createMany({ data: DEFAULT_ACCOUNTS.map((a) => ({ tenantId, projectId, code: a.code, name: a.name, budget: 0, isLabor: !!a.isLabor })) });
    const laborAcc = await tx.costAccount.findFirstOrThrow({ where: { projectId, isLabor: true } });
    let laborTotal = 0;
    const cats = (await tx.tenant.findUnique({ where: { id: tenantId }, select: { inspectionCategories: true } }))?.inspectionCategories ?? [];
    const cat = (want: string) => (cats.includes(want) ? want : cats[0] ?? want);

    const wpIds = new Map<string, string>();
    const usedGroups = new Set(plan.items.map((i) => i.parentCode));
    for (const grp of rows.filter(isGroup).filter((x) => usedGroups.has(x.code))) {
      const wp = await tx.workPackage.create({
        data: { tenantId, projectId, code: grp.code, name: grp.name, phaseId: grp.phase ? phaseIds.get(grp.phase) : null, isPurchase: grp.phase === null, durationDays: 1 },
      });
      wpIds.set(grp.code, wp.id);
    }
    for (const it of plan.items) {
      const wp = await tx.workPackage.create({
        data: {
          tenantId, projectId, code: it.code, name: it.name, parentId: wpIds.get(it.parentCode),
          phaseId: it.phase ? phaseIds.get(it.phase) : null, durationDays: it.milestone ? 0 : Math.max(it.durationDays, 1), isMilestone: !!it.milestone,
          functionalRoleId: roleId(it.role), isPurchase: it.purchase, longLead: it.condition === 'longLead',
          description: it.deliverable ? `交付物 / 记录：${it.deliverable}` : null,
          ...(() => {
            if (it.milestone) return {};
            const days = Math.max(it.durationDays, 1);
            const rate = Number(roles.find((r) => r.name === it.role)?.rate ?? 0);
            const labor = Math.round(days * rate * 100) / 100;
            laborTotal += labor;
            return { resourceDays: days, budget: labor, costAccountId: laborAcc.id };
          })(),
        },
      });
      wpIds.set(it.code, wp.id);
      // 默认检验 / 验证项：模板里写了交付物或记录的工作包，检查该输出完成并确认
      if (it.deliverable) {
        await tx.inspectionItem.create({
          data: {
            tenantId, projectId, workPackageId: wp.id, name: it.deliverable, category: cat(it.milestone ? '评审' : '文件'),
            requirement: it.milestone ? '达到节点要求，经确认' : '内容完整，经审核', method: it.milestone ? '评审 / 确认' : '审核', record: it.deliverable, sortOrder: 1,
          },
        });
      }
    }
    const target = (await tx.project.findUniqueOrThrow({ where: { id: projectId }, select: { budget: true } })).budget;
    if (target === null || laborTotal <= Number(target)) await tx.costAccount.update({ where: { id: laborAcc.id }, data: { budget: Math.round(laborTotal * 100) / 100 } });
    const deps = plan.items.flatMap((it) => it.predecessors.filter((p) => wpIds.has(p)).map((p) => ({ tenantId, projectId, predecessorId: wpIds.get(p)!, successorId: wpIds.get(it.code)! })));
    if (deps.length) await tx.wpDependency.createMany({ data: deps, skipDuplicates: true });

    // 交付物：A/B 来自合同交付物，C 来自库存计划行；产品挂到交付（入库）里程碑
    const deliveryPhase = phaseIds.get(type === ProjectType.C ? '入库' : '交付') ?? null;
    const list = type === ProjectType.C
      ? req.stockLines.map((l) => ({ name: `${l.product}（${l.quantity}）`, due: l.date, product: true }))
      : req.deliverables.map((d) => ({ name: d.quantity ? `${d.name}（${d.quantity}）` : d.name, due, product: d.kind === 'PRODUCT' }));
    let firstProduct: string | null = null;
    for (const d of list) {
      const row = await tx.deliverable.create({ data: { tenantId, projectId, phaseId: deliveryPhase, name: d.name, kind: DeliverableKind.INTERNAL, dueDate: d.due ? new Date(d.due) : null } });
      if (d.product && !firstProduct) firstProduct = row.id;
    }
    const milestone = wpIds.get(DELIVERY_MILESTONE[type]);
    if (firstProduct && milestone) await tx.workPackage.update({ where: { id: milestone }, data: { deliverableId: firstProduct } });
    return plan.removed;
  }

  /** 项目类型变更后补上新类型缺少的阶段（已有阶段保留，按名称判断） */
  async addMissingPhases(tx: Tx, tenantId: string, projectId: string, type: ProjectType, req: Requirements) {
    const rows = await this.templateRows(tenantId, type, tx);
    const wanted = generatePlan(type, rows, req).phases;
    const have = await tx.phase.findMany({ where: { projectId }, orderBy: { order: 'asc' } });
    let order = have.at(-1)?.order ?? 0;
    const added: string[] = [];
    for (const name of wanted) {
      if (have.some((h) => h.name === name)) continue;
      const rule = phaseRule(name);
      await tx.phase.create({ data: { tenantId, projectId, name, order: ++order, checklist: rule.checklist, mandatoryRoles: rule.mandatoryRoles } });
      added.push(name);
    }
    return added;
  }
}
