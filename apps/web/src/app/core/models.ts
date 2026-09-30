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
  /** 管理员设置或重置的密码，必须先改掉 */
  mustChangePassword?: boolean;
}

export interface UserRow {
  id: string;
  email: string;
  name: string;
  role: Role;
  active: boolean;
  mustChangePassword?: boolean;
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

export interface GateReview {
  id: string;
  phaseId: string;
  status: 'OPEN' | 'DECIDED';
  decision: 'APPROVED' | 'CONDITIONAL' | 'REJECTED' | null;
  checklistResults: { item: string; passed: boolean; comment?: string }[];
  attendees: string[];
  notes: string | null;
  decisionNote: string | null;
  overrideAuthorizedById: string | null;
  overrideReason: string | null;
  escalated: boolean;
  createdAt: string;
  decidedAt: string | null;
}
export const DECISION_LABELS = { APPROVED: '通过', CONDITIONAL: '有条件通过', REJECTED: '拒绝' } as const;

export interface Readiness {
  checklistFailed: string[];
  pendingWorkPackages: { id: string; code: string; name: string }[];
  pendingDeliverables: { id: string; name: string }[];
  priorOpenIssues: { id: string; title: string }[];
}

export interface Issue {
  id: string;
  kind: 'ISSUE' | 'ACTION';
  title: string;
  description: string | null;
  status: 'OPEN' | 'CLOSED';
  ownerId: string | null;
  dueDate: string | null;
  source: string;
  closureNote: string | null;
}
export const ISSUE_SOURCE_LABELS: Record<string, string> = { GATE: '关口评审', PROJECT_REVIEW: '项目评审', RISK: '风险应对', MANUAL: '手工登记' };

export interface ProjectReview {
  id: string;
  reviewDate: string;
  attendees: string[];
  notes: string | null;
  escalations: string | null;
  reportedToId: string | null;
  performance: {
    progress: { plannedPercent: number; actualPercent: number; varianceDays: number; projectedEnd: string; exceedsPlannedEnd: boolean; plannedEnd: string };
    openIssues: { id: string; title: string; kind: string }[];
    overdueActions: number;
    openRisks: { id: string; title: string; score: number; kind: string }[];
    budget: string | null;
  };
}

export type ChangeType = 'SCOPE' | 'SCHEDULE' | 'BUDGET' | 'DELIVERY_DATE' | 'TECHNICAL' | 'OTHER';
export type ChangeStatus = 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'IMPLEMENTED' | 'VERIFIED' | 'CLOSED';
export const CHANGE_TYPE_LABELS: Record<ChangeType, string> = {
  SCOPE: '范围', SCHEDULE: '进度', BUDGET: '预算', DELIVERY_DATE: '客户交期', TECHNICAL: '技术', OTHER: '其他',
};
export const CHANGE_STATUS_LABELS: Record<ChangeStatus, string> = {
  DRAFT: '草稿', SUBMITTED: '待审批', APPROVED: '已批准', REJECTED: '已驳回', IMPLEMENTED: '已实施', VERIFIED: '已验证', CLOSED: '已关闭',
};
export interface ChangeRequest {
  id: string;
  code: string;
  type: ChangeType;
  status: ChangeStatus;
  title: string;
  description: string;
  reason: string;
  triggeredByFailure: boolean;
  causeAnalysis: string | null;
  impactAnalysis: string | null;
  proposed: { budget?: number; customerDeliveryDate?: string; startDate?: string; endDate?: string } | null;
  customerNotifiedAt: string | null;
  customerAgreedAt: string | null;
  requestedById: string;
  implementedById: string | null;
  decisionNote: string | null;
  effectivenessNote: string | null;
}

export interface RiskRow {
  id: string;
  kind: 'RISK' | 'OPPORTUNITY';
  title: string;
  probability: number;
  impact: number;
  score: number;
  exposureAmount: string;
  responseCost: string;
  expectedValue: number;
  netBenefitOfResponse: number;
  costBenefitAnalysis: string;
  status: 'OPEN' | 'MITIGATING' | 'OCCURRED' | 'CLOSED';
  ownerId: string | null;
  openActions: number;
  closedActions: number;
}
export const RISK_STATUS_LABELS = { OPEN: '未处理', MITIGATING: '应对中', OCCURRED: '已发生', CLOSED: '已关闭' } as const;

export interface CostAccountRow {
  id: string; code: string; name: string; budget: number; actual: number; etc: number;
  etcIsManual: boolean; eac: number; variance: number; overrun: boolean;
}
export interface CostSummary {
  projectBudget: number | null; allocated: number; unallocated: number | null;
  actual: number; eac: number; variance: number | null; overrun: boolean; accounts: CostAccountRow[];
}
export interface CostEntryRow { id: string; accountId: string; amount: string; entryDate: string; description: string }

export type NcStatus = 'OPEN' | 'ANALYSIS' | 'ACTION' | 'VERIFICATION' | 'CLOSED';
export const NC_STATUS_LABELS: Record<NcStatus, string> = { OPEN: '已登记', ANALYSIS: '原因分析', ACTION: '措施执行', VERIFICATION: '有效性验证', CLOSED: '已关闭' };
export const NC_SEVERITY_LABELS = { MINOR: '轻微', MAJOR: '重大', CRITICAL: '严重' } as const;
export const NC_SOURCE_LABELS = { INSPECTION: '检验', AUDIT: '审核', CUSTOMER: '客户', SUPPLIER: '供方', OTHER: '其他' } as const;
export interface Nonconformity {
  id: string; code: string; title: string; description: string;
  severity: keyof typeof NC_SEVERITY_LABELS; source: keyof typeof NC_SOURCE_LABELS; status: NcStatus;
  containment: string | null; rootCause: string | null; correctiveAction: string | null; preventiveAction: string | null;
  actionOwnerId: string | null; actionDueDate: string | null; effectivenessNote: string | null;
}
export interface QualityActivity { kind: 'QA' | 'QC'; name: string; method?: string; frequency?: string }
export interface QualityPlan { objectives: string; procedures: string; activities: QualityActivity[]; version: number; approvedAt: string | null }

export interface CommLog { id: string; kind: 'MEETING' | 'CUSTOMER' | 'SUPPLIER' | 'INTERNAL'; logDate: string; subject: string; participants: string; summary: string }
export const COMM_KIND_LABELS = { MEETING: '会议', CUSTOMER: '客户沟通', SUPPLIER: '供方沟通', INTERNAL: '内部沟通' } as const;
export interface CommChannel { audience: string; channel: string; frequency: string }
export interface CommPlan { channels: CommChannel[]; notes: string; version: number }
export interface TrainingRow { id: string; userId: string; title: string; dueDate: string | null; status: 'PLANNED' | 'DONE' }

export interface DocRow { id: string; folder: string; name: string; currentVersion: number; latest: { fileName: string; size: number; uploadedAt: string; sha256: string } | null }
export interface DocVersion { id: string; version: number; fileName: string; size: number; sha256: string; comment: string | null; uploadedAt: string }
export interface Lesson { id: string; kind: 'GOOD_PRACTICE' | 'LESSON'; title: string; description: string; recommendation: string; project?: { code: string; name: string } | null }
export interface ConfigItemRow { id: string; parentId: string | null; code: string; name: string; kind: string; safetyRelated: boolean; lowestLevel: boolean; revision: string; serialNumber: string | null; batchNumber: string | null }
export interface BaselineRow { id: string; type: string; name: string; createdAt: string; itemCount: number }
export interface ConfigStatus { baseline: { name: string } | null; added: string[]; removed: string[]; changed: { code: string; from: string; to: string }[]; safetyRelatedItems: number }
export type TenderStatus = 'DRAFT' | 'IN_REVIEW' | 'APPROVED' | 'REJECTED' | 'WON' | 'LOST';
export const TENDER_STATUS_LABELS: Record<TenderStatus, string> = { DRAFT: '编制中', IN_REVIEW: '待审批', APPROVED: '已批准', REJECTED: '已驳回', WON: '已中标', LOST: '未中标' };
export interface Tender {
  id: string; code: string; title: string; customer: string; status: TenderStatus;
  requirements: string; riskAssessment: string; riskExposure: string; knowledgeInputs: string;
  deliverablesPlan: string; estimatedCost: string; offerPrice: string; resourcePlan: string;
  decisionNote: string | null; convertedProjectId: string | null;
}

export interface DashboardProject {
  id: string; code: string; name: string; status: string; riskLevel: RiskLevel; activePhase: string | null;
  health: 'RED' | 'AMBER' | 'GREEN'; reasons: string[];
  progress: { planned: number; actual: number; projectedEnd: string; plannedEnd: string };
  openIssues: number; overdueActions: number; highRisks: number; openNonconformities: number; pendingChanges: number;
  cost: { budget: number | null; eac: number; overrun: boolean } | null;
  lastReviewDate: string | null; reviewOverdue: boolean;
}
export interface Dashboard { totals: { projects: number; red: number; amber: number; green: number }; projects: DashboardProject[] }
export interface Todo { kind: string; title: string; projectId: string; projectCode: string; link: string; dueDate: string | null }
export interface NotificationRow { id: string; kind: string; title: string; body: string; link: string | null; readAt: string | null; createdAt: string }
