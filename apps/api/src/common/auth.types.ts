import { Role } from '../generated/prisma/enums.js';

/** 通过 JWT 校验后挂在 request.user 上的当前用户 */
export interface AuthUser {
  id: string;
  /** 平台管理员为 null */
  tenantId: string | null;
  role: Role;
  email: string;
  name: string;
  /** 管理员设置或重置密码后为 true，前端据此强制改密 */
  mustChangePassword?: boolean;
}

/** 租户内操作必须有 tenantId；平台管理员不能访问租户业务数据 */
export function requireTenantId(user: AuthUser): string {
  if (!user.tenantId) {
    throw new Error('Tenant context required');
  }
  return user.tenantId;
}
