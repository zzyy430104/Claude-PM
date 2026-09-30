import { ForbiddenException, Injectable } from '@nestjs/common';
import { ZipArchive } from 'archiver';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { join, resolve } from 'node:path';
import { PassThrough } from 'node:stream';
import { AuditService } from '../audit/audit.service.js';
import type { AuthUser } from '../common/auth.types.js';
import { CostService } from '../cost/cost.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ProjectAccess } from '../projects/access.service.js';
import { MetricsService } from '../governance/metrics.service.js';

const storageRoot = () => resolve(process.env.STORAGE_DIR ?? './storage');

/** 条款与证据文件的对应关系，写入证据包的 INDEX.md，供审核员按条款查阅 */
const CLAUSE_MAP: [string, string, string][] = [
  ['8.1.3.1', '阶段与关口评审、项目分类', 'phases.json, gate-reviews.json'],
  ['8.1.3.1.3', '项目文件与评审记录保留', 'documents/, documents.json'],
  ['8.1.3.2', '项目管理计划', 'project-plan.json, members.json'],
  ['8.1.3.1.1 a、8.1.3.3 a', '项目需求及其与交付物的对应', 'requirements.json'],
  ['8.1.3.3', '范围管理（WBS、工作包核验）', 'work-packages.json'],
  ['8.1.3.4', '进度管理（依赖、关键路径）', 'work-packages.json, progress.json'],
  ['8.1.3.2 g', '计划批准版本（每次变更实施后的计划快照）', 'plan-versions.json'],
  ['8.1.3.5', '成本管理', 'cost.json'],
  ['8.1.3.6', '项目质量计划与不符合项', 'quality-plan.json, nonconformities.json'],
  ['8.1.3.7', '人力资源（任命、能力、培训）', 'members.json, trainings.json'],
  ['8.1.3.8', '沟通管理', 'communication-plan.json, communication-logs.json'],
  ['8.1.3.9', '风险与机会登记册', 'risks.json'],
  ['8.1.3.10', '采购（外部供方交付物）', 'deliverables.json'],
  ['8.1.3.11', '项目评审', 'project-reviews.json, issues.json'],
  ['8.1.4.1', '配置管理', 'config-items.json, baselines.json'],
  ['8.1.4.2', '变更控制', 'change-requests.json, audit-logs.json'],
  ['7.5', '成文信息的控制与追溯', 'audit-logs.json, MANIFEST.sha256'],
];

/** 审核证据包：把项目的记录、文档和审计日志打成一个 ZIP，附带 SHA-256 清单 */
@Injectable()
export class EvidenceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: ProjectAccess,
    private readonly cost: CostService,
    private readonly metrics: MetricsService,
  ) {}

  async build(actor: AuthUser, projectId: string): Promise<{ stream: PassThrough; fileName: string }> {
    const ctx = await this.access.load(actor, projectId);
    if (!ctx.isManager && !ctx.isQuality && !ctx.isTopManagement) {
      throw new ForbiddenException('Project manager, quality manager or top management required');
    }
    const { tenantId, project } = ctx;
    const w = { projectId, tenantId };
    const [
      plan, phases, members, wps, deps, deliverables, gates, reviews, issues, changes, risks, qualityPlan, ncs,
      commPlan, commLogs, trainings, cfgItems, baselines, lessons, docs, docVersions,
    ] = await Promise.all([
      this.prisma.projectPlan.findUnique({ where: { projectId } }),
      this.prisma.phase.findMany({ where: w, orderBy: { order: 'asc' } }),
      this.prisma.projectMember.findMany({ where: w }),
      this.prisma.workPackage.findMany({ where: w, orderBy: { code: 'asc' } }),
      this.prisma.wpDependency.findMany({ where: w }),
      this.prisma.deliverable.findMany({ where: w }),
      this.prisma.gateReview.findMany({ where: w, orderBy: { createdAt: 'asc' } }),
      this.prisma.projectReview.findMany({ where: w, orderBy: { reviewDate: 'asc' } }),
      this.prisma.issue.findMany({ where: w, orderBy: { createdAt: 'asc' } }),
      this.prisma.changeRequest.findMany({ where: w, orderBy: { code: 'asc' } }),
      this.prisma.risk.findMany({ where: w, orderBy: { createdAt: 'asc' } }),
      this.prisma.qualityPlan.findUnique({ where: { projectId } }),
      this.prisma.nonconformity.findMany({ where: w, orderBy: { code: 'asc' } }),
      this.prisma.communicationPlan.findUnique({ where: { projectId } }),
      this.prisma.communicationLog.findMany({ where: w, orderBy: { logDate: 'asc' } }),
      this.prisma.training.findMany({ where: w }),
      this.prisma.configItem.findMany({ where: w, orderBy: { code: 'asc' } }),
      this.prisma.baseline.findMany({ where: w, orderBy: { createdAt: 'asc' } }),
      this.prisma.lesson.findMany({ where: w }),
      this.prisma.document.findMany({ where: w, orderBy: [{ folder: 'asc' }, { name: 'asc' }] }),
      this.prisma.documentVersion.findMany({ where: { tenantId, document: { projectId } }, orderBy: [{ documentId: 'asc' }, { version: 'asc' }] }),
    ]);
    const [requirements, planVersions] = await Promise.all([
      this.prisma.requirement.findMany({ where: w, orderBy: { code: 'asc' } }),
      this.prisma.planVersion.findMany({ where: w, orderBy: { version: 'asc' } }),
    ]);
    const [costSummary, costEntries, progress] = await Promise.all([
      this.cost.summary(actor, projectId),
      this.prisma.costEntry.findMany({ where: w, orderBy: { entryDate: 'asc' } }),
      this.metrics.progress(ctx),
    ]);

    // 涉及本项目的所有实体的审计日志
    const entityIds = [
      projectId, ...phases.map((x) => x.id), ...members.map((x) => x.id), ...wps.map((x) => x.id), ...deps.map((x) => x.id),
      ...deliverables.map((x) => x.id), ...gates.map((x) => x.id), ...reviews.map((x) => x.id), ...issues.map((x) => x.id),
      ...changes.map((x) => x.id), ...risks.map((x) => x.id), ...ncs.map((x) => x.id), ...trainings.map((x) => x.id),
      ...cfgItems.map((x) => x.id), ...baselines.map((x) => x.id), ...docs.map((x) => x.id), ...lessons.map((x) => x.id),
      ...commLogs.map((x) => x.id), ...costEntries.map((x) => x.id), ...requirements.map((x) => x.id),
    ];
    const auditLogs = await this.prisma.auditLog.findMany({ where: { tenantId, entityId: { in: entityIds } }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });

    const userIds = new Set<string>();
    for (const l of auditLogs) if (l.actorId) userIds.add(l.actorId);
    for (const m of members) userIds.add(m.userId);
    const users = await this.prisma.user.findMany({ where: { id: { in: [...userIds] }, tenantId }, select: { id: true, name: true, email: true } });

    const generatedAt = new Date();
    const json = (data: unknown) => Buffer.from(JSON.stringify(data, null, 2), 'utf8');
    const files: [string, Buffer][] = [
      ['project.json', json(project)], ['project-plan.json', json(plan)], ['phases.json', json(phases)], ['members.json', json({ members, users })],
      ['work-packages.json', json({ workPackages: wps, dependencies: deps })], ['progress.json', json(progress)], ['deliverables.json', json(deliverables)],
      ['gate-reviews.json', json(gates)], ['project-reviews.json', json(reviews)], ['issues.json', json(issues)],
      ['change-requests.json', json(changes)], ['risks.json', json(risks)], ['quality-plan.json', json(qualityPlan)],
      ['nonconformities.json', json(ncs)], ['communication-plan.json', json(commPlan)], ['communication-logs.json', json(commLogs)],
      ['trainings.json', json(trainings)], ['cost.json', json({ summary: costSummary, entries: costEntries })],
      ['config-items.json', json(cfgItems)], ['baselines.json', json(baselines)], ['lessons.json', json(lessons)],
      ['requirements.json', json(requirements)], ['plan-versions.json', json(planVersions)],
      ['documents.json', json({ documents: docs, versions: docVersions.map(({ storagePath: _p, ...v }) => v) })],
      ['audit-logs.json', json({ users, logs: auditLogs })],
    ];
    const index = [
      `# 审核证据包：${project.code} ${project.name}`, '',
      `- 生成时间：${generatedAt.toISOString()}`, `- 生成人：${actor.name}（${actor.email}）`,
      `- 项目状态：${project.status}${project.baselined ? '，计划已批准' : ''}`,
      `- 完整性：MANIFEST.sha256 列出了包内每个文件的 SHA-256，可用 \`sha256sum -c MANIFEST.sha256\` 校验`, '',
      '## 标准条款与证据文件（ISO 22163:2023）', '', '| 条款 | 内容 | 证据文件 |', '| --- | --- | --- |',
      ...CLAUSE_MAP.map(([c, d, f]) => `| ${c} | ${d} | ${f} |`), '',
      `## 统计`, '',
      `- 阶段 ${phases.length}，关口评审 ${gates.length}，项目评审 ${reviews.length}，变更申请 ${changes.length}，风险与机会 ${risks.length}`,
      `- 问题与行动项 ${issues.length}，不符合项 ${ncs.length}，文档 ${docs.length}（${docVersions.length} 个版本），审计记录 ${auditLogs.length} 条`,
    ].join('\n');
    files.unshift(['INDEX.md', Buffer.from(index, 'utf8')]);

    const manifest: string[] = files.map(([name, buf]) => `${createHash('sha256').update(buf).digest('hex')}  ${name}`);
    const docEntries = docVersions.map((v) => {
      const doc = docs.find((d) => d.id === v.documentId)!;
      const path = `documents/${doc.folder}/${doc.name.replace(/[\\/:*?"<>|]/g, '_')}_v${v.version}_${v.fileName.replace(/[\\/:*?"<>|]/g, '_')}`;
      return { v, path };
    });
    for (const { v, path } of docEntries) manifest.push(`${v.sha256}  ${path}`);

    const archive = new ZipArchive({ zlib: { level: 6 } });
    const stream = new PassThrough();
    archive.pipe(stream);
    for (const [name, buf] of files) archive.append(buf, { name });
    archive.append(Buffer.from(manifest.join('\n') + '\n', 'utf8'), { name: 'MANIFEST.sha256' });
    for (const { v, path } of docEntries) archive.append(createReadStream(join(storageRoot(), v.storagePath)), { name: path });
    void archive.finalize();

    await this.audit.record({ tenantId, actorId: actor.id, action: 'evidencePack.export', entity: 'Project', entityId: projectId, after: { files: files.length + docEntries.length + 1 } });
    return { stream, fileName: `evidence-${project.code}-${generatedAt.toISOString().slice(0, 10)}.zip` };
  }
}
