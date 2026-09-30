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
  actorName: string | null;
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

export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH';
export const RISK_LABELS: Record<RiskLevel, string> = { LOW: '低', MEDIUM: '中', HIGH: '高' };

export type ProjectRole = 'PROJECT_MANAGER' | 'PROJECT_QUALITY_MANAGER' | 'WORK_PACKAGE_OWNER' | 'FUNCTION_MANAGER' | 'MEMBER';
export const PROJECT_ROLE_LABELS: Record<ProjectRole, string> = {
  PROJECT_MANAGER: '项目经理',
  PROJECT_QUALITY_MANAGER: '项目质量经理',
  WORK_PACKAGE_OWNER: '工作包负责人',
  FUNCTION_MANAGER: '职能经理',
  MEMBER: '成员',
};
export const PROJECT_ROLES = Object.keys(PROJECT_ROLE_LABELS) as ProjectRole[];

export interface Permissions {
  manage: boolean;
  quality: boolean;
  ccb: boolean;
  topManagement: boolean;
}

export interface Project {
  id: string;
  code: string;
  name: string;
  description: string | null;
  riskLevel: RiskLevel;
  status: 'PLANNING' | 'ACTIVE' | 'CLOSED' | 'CANCELLED';
  baselined: boolean;
  startDate: string;
  endDate: string;
  customerDeliveryDate: string | null;
  budget: string | null;
  reviewIntervalDays: number;
  permissions?: Permissions;
}

export const PROJECT_STATUS_LABELS: Record<Project['status'], string> = {
  PLANNING: '策划中',
  ACTIVE: '执行中',
  CLOSED: '已关闭',
  CANCELLED: '已取消',
};

export interface Phase {
  id: string;
  name: string;
  order: number;
  status: 'PLANNED' | 'ACTIVE' | 'CLOSED';
  checklist: string[];
  mandatoryRoles: ProjectRole[];
}

export interface Member {
  id: string;
  userId: string;
  projectRole: ProjectRole;
  isCcb: boolean;
  appointment: string | null;
  competencies: string | null;
  active: boolean;
  user: { id: string; name: string; email: string } | null;
}

export type WpStatus = 'NOT_STARTED' | 'IN_PROGRESS' | 'DONE' | 'VERIFIED';
export const WP_STATUS_LABELS: Record<WpStatus, string> = {
  NOT_STARTED: '未开始',
  IN_PROGRESS: '进行中',
  DONE: '已完成',
  VERIFIED: '已核验',
};

export interface WorkPackage {
  id: string;
  parentId: string | null;
  phaseId: string | null;
  code: string;
  name: string;
  ownerId: string | null;
  durationDays: number;
  percentComplete: number;
  status: WpStatus;
  isLeaf: boolean;
  scheduledStart: string;
  scheduledEnd: string;
  startOffsetDays: number;
  endOffsetDays: number;
  critical: boolean;
  totalFloatDays: number | null;
}

export interface Dependency {
  id: string;
  predecessorId: string;
  successorId: string;
}

export interface WbsResponse {
  items: WorkPackage[];
  dependencies: Dependency[];
  projectDurationDays: number;
  projectedEnd: string;
  exceedsPlannedEnd: boolean;
}

export interface PhaseTemplate {
  id: string;
  name: string;
  phases: { name: string; checklist: string[]; mandatoryRoles: ProjectRole[] }[];
}

export interface Deliverable {
  id: string;
  name: string;
  kind: 'INTERNAL' | 'CUSTOMER_APPROVAL' | 'EXTERNAL_PROVIDER' | 'CUSTOMER_SUPPLIED';
  supplier: string | null;
  dueDate: string | null;
  status: 'PLANNED' | 'SUBMITTED' | 'ACCEPTED' | 'REJECTED';
  phaseId: string | null;
}
export const DELIVERABLE_KIND_LABELS: Record<Deliverable['kind'], string> = {
  INTERNAL: '内部交付物',
  CUSTOMER_APPROVAL: '需客户批准',
  EXTERNAL_PROVIDER: '外部供方交付物',
  CUSTOMER_SUPPLIED: '客户提供物',
};
export const DELIVERABLE_STATUS_LABELS: Record<Deliverable['status'], string> = {
  PLANNED: '计划中',
  SUBMITTED: '已提交',
  ACCEPTED: '已接受',
  REJECTED: '被拒绝',
};
