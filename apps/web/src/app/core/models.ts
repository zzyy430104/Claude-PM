export type Role =
  | 'PLATFORM_ADMIN'
  | 'TENANT_ADMIN'
  | 'TOP_MANAGEMENT'
  | 'FUNCTION_MANAGER'
  | 'PROJECT_MANAGER'
  | 'PROJECT_QUALITY_MANAGER'
  | 'WORK_PACKAGE_OWNER'
  | 'MEMBER';

export const ROLE_LABELS: Record<Role, string> = {
  PLATFORM_ADMIN: '平台管理员',
  TENANT_ADMIN: '企业管理员',
  TOP_MANAGEMENT: '最高管理层',
  FUNCTION_MANAGER: '职能经理',
  PROJECT_MANAGER: '项目经理',
  PROJECT_QUALITY_MANAGER: '项目质量经理',
  WORK_PACKAGE_OWNER: '工作包负责人',
  MEMBER: '成员（只读）',
};

/** 企业内可分配的角色（不含平台管理员） */
export const TENANT_ROLES = (Object.keys(ROLE_LABELS) as Role[]).filter(
  (r) => r !== 'PLATFORM_ADMIN',
);

export interface CurrentUser {
  id: string;
  tenantId: string | null;
  role: Role;
  email: string;
  name: string;
}

export interface UserRow {
  id: string;
  email: string;
  name: string;
  role: Role;
  active: boolean;
  createdAt: string;
}

export interface AuditRow {
  id: string;
  actorId: string | null;
  action: string;
  entity: string;
  entityId: string;
  before: unknown;
  after: unknown;
  createdAt: string;
}

export interface TenantRow {
  id: string;
  slug: string;
  name: string;
  active: boolean;
  createdAt: string;
}

export interface Tokens {
  accessToken: string;
  refreshToken: string;
}
