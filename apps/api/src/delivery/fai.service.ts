import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { FaiRecord, Prisma } from '../generated/prisma/client.js';
import { FaiResult } from '../generated/prisma/enums.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthUser } from '../common/auth.types.js';
import { IssuesService } from '../governance/issues.service.js';
import { asRequirements } from '../initiations/requirements.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ProjectAccess, type ProjectCtx } from '../projects/access.service.js';
import { faiSummary } from './checks.js';
import { FaiDto, UpdateFaiDto } from './dto.js';

const day = (d: Date) => d.toISOString().slice(0, 10);

/** FAI 记录（第 3 步）：只记结论和追溯信息；遗留项生成行动项在「问题与行动」跟踪。项目经理或项目质量经理登记。 */
@Injectable()
export class FaiService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: ProjectAccess,
    private readonly issues: IssuesService,
    private readonly notifications: NotificationsService,
  ) {}

  private async editable(actor: AuthUser, projectId: string) {
    const ctx = await this.access.load(actor, projectId);
    this.access.requireOpen(ctx);
    this.access.requireCan(ctx, 'INSPECTION');
    return ctx;
  }
  private async record(ctx: ProjectCtx, id: string) {
    const r = await this.prisma.faiRecord.findFirst({ where: { id, projectId: ctx.project.id, tenantId: ctx.tenantId } });
    if (!r) throw new NotFoundException('FAI record not found');
    return r;
  }

  async list(actor: AuthUser, projectId: string) {
    const ctx = await this.access.load(actor, projectId);
    const p = ctx.project;
    const ver = p.requirementVersion ? await this.prisma.projectRequirementVersion.findUnique({ where: { projectId_version: { projectId, version: p.requirementVersion } } }) : null;
    const req = ver ? asRequirements(ver.data) : null;
    const sum = await faiSummary(this.prisma, projectId);
    const actions = await this.prisma.issue.findMany({ where: { projectId, source: 'FAI' }, select: { id: true, title: true, status: true, description: true } });
    const users = await this.prisma.user.findMany({ where: { id: { in: sum.records.map((r) => r.createdById) } }, select: { id: true, name: true } });
    return {
      requirement: req ? { fai: req.quality.fai, faiReason: req.quality.faiReason, customerWitness: req.quality.customerWitness, version: p.requirementVersion } : null,
      records: [...sum.records].reverse().map((r) => ({
        ...r, date: day(r.date), createdBy: users.find((u) => u.id === r.createdById)?.name ?? '',
        actions: actions.filter((a) => a.description === `FAI ${r.reportNo}`).map((a) => ({ id: a.id, title: a.title, status: a.status })),
      })),
      parts: sum.parts, firstPass: sum.firstPass, state: sum.state, text: sum.text,
      canEdit: ctx.project.status !== 'CLOSED' && ctx.perms.INSPECTION,
    };
  }

  async create(actor: AuthUser, projectId: string, dto: FaiDto) {
    const ctx = await this.editable(actor, projectId);
    if (await this.prisma.faiRecord.findFirst({ where: { projectId, reportNo: dto.reportNo.trim() } })) throw new ConflictException({ code: 'DUPLICATE_NAME', message: 'Report number exists' });
    const points = (dto.openPoints ?? []).map((x) => x.trim()).filter(Boolean);
    if (dto.result === FaiResult.CONDITIONAL && !points.length) throw new ConflictException({ code: 'OPEN_POINTS_REQUIRED', message: 'Conditional acceptance needs the open points' });
    const r = await this.audit.tx(actor, { action: 'fai.create', entity: 'FaiRecord', entityId: (x: FaiRecord) => x.id, after: (x: FaiRecord) => ({ reportNo: x.reportNo, part: x.part, result: x.result, openPoints: points }) }, async (tx) => {
      const x = await tx.faiRecord.create({
        data: {
          tenantId: ctx.tenantId, projectId, reportNo: dto.reportNo.trim(), date: new Date(dto.date), part: dto.part.trim(), result: dto.result,
          witnessed: dto.witnessed ?? false, witness: dto.witness?.trim() ?? '', location: dto.location?.trim() ?? '', notes: dto.notes?.trim() ?? '', createdById: actor.id,
        },
      });
      for (const t of points) await this.issues.insert(tx, ctx.tenantId, projectId, actor.id, { kind: 'ACTION', title: t, description: `FAI ${x.reportNo}`, ownerId: dto.ownerId, dueDate: dto.dueDate, source: 'FAI' });
      return x;
    });
    if (points.length && dto.ownerId) await this.notifications.notify(ctx.tenantId, [dto.ownerId], { kind: 'ACTION_ASSIGNED', title: `FAI 遗留项：${points.length} 项`, body: `${ctx.project.code} ${r.reportNo}`, link: `/projects/${projectId}?g=ctrl&s=issues` }, actor.id);
    return r;
  }

  async update(actor: AuthUser, projectId: string, id: string, dto: UpdateFaiDto) {
    const ctx = await this.editable(actor, projectId);
    const r = await this.record(ctx, id);
    return this.audit.tx(actor, { action: 'fai.update', entity: 'FaiRecord', entityId: () => id, before: { result: r.result, location: r.location }, after: () => dto as unknown as Prisma.InputJsonValue },
      (tx) => tx.faiRecord.update({ where: { id }, data: { date: dto.date ? new Date(dto.date) : undefined, part: dto.part?.trim(), result: dto.result, witnessed: dto.witnessed, witness: dto.witness?.trim(), location: dto.location?.trim(), notes: dto.notes?.trim() } }));
  }

  async remove(actor: AuthUser, projectId: string, id: string) {
    const ctx = await this.editable(actor, projectId);
    if (!ctx.isManager) throw new ForbiddenException('Project manager required');
    const r = await this.record(ctx, id);
    await this.audit.tx(actor, { action: 'fai.delete', entity: 'FaiRecord', entityId: () => id, before: { reportNo: r.reportNo, part: r.part, result: r.result } }, (tx) => tx.faiRecord.delete({ where: { id } }));
    return { ok: true };
  }
}
