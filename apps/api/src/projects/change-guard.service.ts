import { ConflictException, Injectable } from '@nestjs/common';
import { ChangeStatus, ChangeType } from '../generated/prisma/enums.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { ProjectCtx } from './access.service.js';

/**
 * 基线后的范围 / 预算 / 客户交期变更必须经过已批准的变更申请（8.1.3.3、8.1.3.4、8.1.3.5）。
 * 预算、交期、日期由变更申请“实施”时写入，直接修改一律拒绝；
 * 范围（WBS 增删）可以引用已批准、尚未实施的范围变更申请。
 */
@Injectable()
export class ChangeGuard {
  constructor(private readonly prisma: PrismaService) {}

  async assertAllowed(ctx: ProjectCtx, changeRequestId?: string): Promise<void> {
    if (!ctx.project.baselined) return;
    if (changeRequestId) {
      const cr = await this.prisma.changeRequest.findFirst({
        where: {
          id: changeRequestId,
          projectId: ctx.project.id,
          tenantId: ctx.tenantId,
          type: ChangeType.SCOPE,
          status: ChangeStatus.APPROVED,
        },
      });
      if (cr) return;
    }
    throw new ConflictException({
      code: 'CHANGE_REQUEST_REQUIRED',
      message: 'Project is baselined: an approved change request is required',
    });
  }
}
