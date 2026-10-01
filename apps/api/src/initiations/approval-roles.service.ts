import { BadRequestException, Injectable } from '@nestjs/common';
import { ApprovalRoleKind, Role } from '../generated/prisma/enums.js';
import { AuditService } from '../audit/audit.service.js';
import { requireTenantId } from '../common/auth.types.js';
import type { AuthUser } from '../common/auth.types.js';
import { PrismaService } from '../prisma/prisma.service.js';

/** 没有专门指定时的默认人选：按企业角色 */
const DEFAULT_ROLES: Record<ApprovalRoleKind, Role[]> = {
  INITIATOR: [Role.TENANT_ADMIN, Role.TOP_MANAGEMENT, Role.PROJECT_MANAGER],
  APPROVER: [Role.TOP_MANAGEMENT],
  COSIGNER: [],
  PLAN_APPROVER: [Role.TOP_MANAGEMENT],
};

export interface AssignmentInput { userId: string; basis?: string; validFrom?: string | null; validTo?: string | null }

/**
 * 立项与审批角色：立项申请人、立项批准人、会签人、计划批准人。
 * 企业在“用户与角色 → 立项与审批角色”里指定，附授权依据和有效期；某类没有指定时按企业角色默认（见 DEFAULT_ROLES）。
 */
@Injectable()
export class ApprovalRolesService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  list(actor: AuthUser) {
    return this.prisma.approvalAssignment.findMany({ where: { tenantId: requireTenantId(actor) }, orderBy: [{ kind: 'asc' }, { createdAt: 'asc' }] });
  }

  /** 某类角色当前有效的人员 */
  async usersFor(tenantId: string, kind: ApprovalRoleKind, today = new Date()): Promise<string[]> {
    const day = today.toISOString().slice(0, 10);
    const rows = await this.prisma.approvalAssignment.findMany({ where: { tenantId, kind } });
    if (rows.length) {
      const valid = rows.filter((r) => (!r.validFrom || r.validFrom.toISOString().slice(0, 10) <= day) && (!r.validTo || r.validTo.toISOString().slice(0, 10) >= day));
      const users = await this.prisma.user.findMany({ where: { tenantId, active: true, id: { in: valid.map((r) => r.userId) } }, select: { id: true } });
      // 计划批准人也包括立项批准人
      const extra = kind === ApprovalRoleKind.PLAN_APPROVER ? await this.usersFor(tenantId, ApprovalRoleKind.APPROVER, today) : [];
      return [...new Set([...users.map((u) => u.id), ...extra])];
    }
    const roles = DEFAULT_ROLES[kind];
    const users = roles.length ? await this.prisma.user.findMany({ where: { tenantId, active: true, role: { in: roles } }, select: { id: true } }) : [];
    const extra = kind === ApprovalRoleKind.PLAN_APPROVER ? await this.usersFor(tenantId, ApprovalRoleKind.APPROVER, today) : [];
    return [...new Set([...users.map((u) => u.id), ...extra])];
  }

  async has(actor: AuthUser, kind: ApprovalRoleKind) {
    return (await this.usersFor(requireTenantId(actor), kind)).includes(actor.id);
  }

  async mine(actor: AuthUser) {
    const [initiator, approver, cosigner, planApprover] = await Promise.all(
      [ApprovalRoleKind.INITIATOR, ApprovalRoleKind.APPROVER, ApprovalRoleKind.COSIGNER, ApprovalRoleKind.PLAN_APPROVER].map((k) => this.has(actor, k)),
    );
    return { initiator, approver, cosigner, planApprover };
  }

  /** 整组替换某类角色的人员 */
  async replace(actor: AuthUser, kind: ApprovalRoleKind, entries: AssignmentInput[]) {
    const tenantId = requireTenantId(actor);
    const ids = [...new Set(entries.map((e) => e.userId))];
    if (ids.length !== entries.length) throw new BadRequestException('Duplicate user');
    const users = await this.prisma.user.count({ where: { tenantId, id: { in: ids }, active: true } });
    if (users !== ids.length) throw new BadRequestException('Unknown user');
    for (const e of entries) {
      if (e.validFrom && e.validTo && e.validTo < e.validFrom) throw new BadRequestException('validTo must not be before validFrom');
    }
    const before = (await this.prisma.approvalAssignment.findMany({ where: { tenantId, kind } })).map((r) => r.userId);
    await this.audit.tx(
      actor,
      { action: 'approvalRoles.replace', entity: 'ApprovalRole', entityId: () => kind, before: { users: before }, after: () => ({ users: ids, entries: entries.map((e) => ({ ...e })) }) },
      async (tx) => {
        await tx.approvalAssignment.deleteMany({ where: { tenantId, kind } });
        if (entries.length) {
          await tx.approvalAssignment.createMany({
            data: entries.map((e) => ({
              tenantId, kind, userId: e.userId, basis: e.basis?.trim() ?? '',
              validFrom: e.validFrom ? new Date(e.validFrom) : null, validTo: e.validTo ? new Date(e.validTo) : null,
            })),
          });
        }
      },
    );
    return this.prisma.approvalAssignment.findMany({ where: { tenantId, kind } });
  }
}
