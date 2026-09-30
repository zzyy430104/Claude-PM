import { ConflictException, Injectable } from '@nestjs/common';
import type { ProjectCtx } from './access.service.js';

/** 基线后的范围 / 预算 / 客户交期变更必须经过已批准的变更申请（8.1.3.3、8.1.3.4、8.1.3.5） */
@Injectable()
export class ChangeGuard {
  assertAllowed(ctx: ProjectCtx, _changeRequestId?: string) {
    if (!ctx.project.baselined) return;
    throw new ConflictException({
      code: 'CHANGE_REQUEST_REQUIRED',
      message: 'Project is baselined: an approved change request is required',
    });
  }
}
