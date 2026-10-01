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

export interface FunctionalRole { id: string; name: string; sortOrder: number; active: boolean; rate?: string | number }
export interface UserRow {
  id: string;
  email: string;
  name: string;
  role: Role;
  functionalRoleId?: string | null;
  departmentId?: string | null;
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
  gateReviewWbsLevel?: number;
  permissions?: Permissions;
  type?: ProjectType;
  initiationId?: string | null;
  requirementVersion?: number;
  planOutdated?: boolean;
  planSubmittedAt?: string | null;
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
  optionalRoles?: ProjectRole[];
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
  budget: string | null;
  costAccountId: string | null;
  deliverableId: string | null;
  resourceDays: string | null;
  externalProvider: string | null;
  longLead: boolean;
  isMilestone?: boolean;
  functionalRoleId?: string | null;
  isPurchase?: boolean;
  /** 按客户交期倒排的最晚开始日 */
  latestStart?: string | null;
  startTooLate?: boolean;
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
  calendarDays?: number;
  projectedEnd: string;
  exceedsPlannedEnd: boolean;
  /** 客户交期（由项目要求带来）与差距：正数 = 晚几个工作日 */
  requiredEnd?: string | null;
  gapDays?: number | null;
}

export interface PhaseTemplate {
  id: string;
  name: string;
  phases: { name: string; checklist: string[]; mandatoryRoles: ProjectRole[]; optionalRoles?: ProjectRole[] }[];
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
  wbsLevel?: number;
  wbsGroups?: { id: string; code: string; name: string; leaves: number; done: number; verified: number }[];
  deliverables?: { id: string; name: string; kind: string; status: 'PLANNED' | 'SUBMITTED' | 'ACCEPTED' | 'REJECTED' }[];
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
    evm?: { spi: number | null; cpi: number | null };
    triangle?: { quality: Dimension; schedule: Dimension; cost: Dimension };
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
  technicalImpact?: { deliveredParts?: string; customerSpec?: string; documents?: string; requirements?: string; revalidation?: string } | null;
  customerNotifiedAt: string | null;
  customerAgreedAt: string | null;
  requestedById: string;
  implementedById: string | null;
  decisionNote: string | null;
  effectivenessNote: string | null;
}

export type RiskLevelKey = 'ENTERPRISE' | 'PROJECT' | 'WORK_PACKAGE';
export type Importance = 'LOW' | 'MEDIUM' | 'HIGH';
export type RiskWho = 'OWNER' | 'PM' | 'MANAGEMENT';
export interface RiskRule { approve: RiskWho; close: RiskWho; accept: 'REASON' | 'REASON_PLAN' | 'REASON_PLAN_APPROVAL'; notify: RiskWho[]; reviewDays: number }
export interface RiskMeasureRow { id: string; title: string; ownerId: string | null; dueDate: string | null; done: boolean; cost: number; issue: boolean }
export interface RiskRow {
  id: string;
  kind: 'RISK' | 'OPPORTUNITY';
  level: RiskLevelKey;
  projectId: string | null;
  title: string;
  description?: string | null;
  probability: number;
  impact: number;
  score: number;
  importance: Importance;
  residualImportance: Importance | null;
  rule: RiskRule;
  exposureAmount: string;
  responseCost: string;
  expectedValue: number;
  netBenefitOfResponse: number;
  costBenefitAnalysis: string;
  status: 'OPEN' | 'MITIGATING' | 'REVIEW' | 'OCCURRED' | 'CLOSED';
  ownerId: string | null;
  openActions: number;
  closedActions: number;
  overdueMeasures: number;
  maturityLevel?: string | null;
  functionalReviewers?: string | null;
  budgetRecovery?: string | null;
  workPackageId: string | null;
  objectiveId: string | null;
  cause: string;
  effect: string;
  strategy: string | null;
  acceptReason: string | null;
  contingencyPlan: string | null;
  acceptApprovedById: string | null;
  acceptApprovedAt: string | null;
  trigger: string;
  triggeredAt: string | null;
  reviewCycleDays: number | null;
  nextReviewAt: string | null;
  reviewDue: boolean;
  residualProbability: number | null;
  residualImpact: number | null;
  closureNote: string | null;
  closedAt: string | null;
  measures: RiskMeasureRow[];
  projects: { id: string; code: string; name: string }[];
  issues: { id: string; title: string; status: string }[];
}
export interface RiskWarning { riskId: string; title: string; importance: Importance; kind: string; message: string; severity: 'red' | 'amber'; ownerId: string | null }
export interface RiskReviewRow { id: string; probability: number; impact: number; note: string; reviewedById: string; createdAt: string; reviewedBy?: { name: string } }
export interface RiskSettings {
  scale: 3 | 5;
  matrix: number[][];
  criteria: Record<string, string[]>;
  strategies: { RISK: string[]; OPPORTUNITY: string[] };
  rules: Record<string, RiskRule>;
}
export interface Objective {
  id: string; dimension: string; name: string; target: string; metric: 'DELIVERY' | 'COST' | 'FAI' | 'FIRST_PASS_YIELD' | 'MANUAL'; auto: boolean;
  current: string | null; manualState: 'GREEN' | 'AMBER' | 'RED' | null;
  currentText: string | null; metricState: string; state: 'GREEN' | 'AMBER' | 'RED' | 'GREY'; highRisk: boolean;
  risks: { id: string; kind: string; title: string; importance: Importance; status: string }[];
}
export const RISK_STATUS_LABELS = { OPEN: '识别', MITIGATING: '应对中', REVIEW: '待复评', OCCURRED: '已发生', CLOSED: '已关闭' } as const;
export const RISK_LEVEL_LABELS: Record<RiskLevelKey, string> = { ENTERPRISE: '企业级', PROJECT: '项目级', WORK_PACKAGE: '工作包级' };
export const IMPORTANCE_LABELS: Record<Importance, string> = { LOW: '低', MEDIUM: '中', HIGH: '高' };
export const RISK_WHO_LABELS: Record<RiskWho, string> = { OWNER: '责任人', PM: '项目经理', MANAGEMENT: '管理层' };
export const ACCEPT_NEED_LABELS = { REASON: '写明理由', REASON_PLAN: '理由 + 应急预案', REASON_PLAN_APPROVAL: '理由 + 应急预案 + 管理层确认' } as const;

export interface CostAccountRow {
  id: string; code: string; name: string; budget: number; actual: number; etc: number;
  etcIsManual: boolean; eac: number; variance: number; overrun: boolean;
}
export interface CostSummary {
  projectBudget: number | null; allocated: number; unallocated: number | null;
  actual: number; eac: number; variance: number | null; overrun: boolean; accounts: CostAccountRow[];
}
export interface CostEntryRow { id: string; accountId: string; workPackageId?: string | null; amount: string; entryDate: string; description: string }

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
export interface DashboardProject {
  id: string; code: string; name: string; status: string; riskLevel: RiskLevel; activePhase: string | null;
  health: 'RED' | 'AMBER' | 'GREEN'; reasons: string[];
  progress: { planned: number; actual: number; projectedEnd: string; plannedEnd: string };
  openIssues: number; overdueActions: number; highRisks: number; openNonconformities: number; pendingChanges: number;
  cost: { budget: number | null; eac: number; overrun: boolean } | null;
  lastReviewDate: string | null; reviewOverdue: boolean;
  triangle?: { quality: Health; schedule: Health; cost: Health }; spi?: number | null; cpi?: number | null;
}
export interface Dashboard { totals: { projects: number; red: number; amber: number; green: number }; projects: DashboardProject[] }
export interface Todo { kind: string; title: string; projectId: string; projectCode: string; link: string; dueDate: string | null }
export interface NotificationRow { id: string; kind: string; title: string; body: string; link: string | null; readAt: string | null; createdAt: string }

export type RequirementCategory = 'TIME' | 'COMMERCIAL' | 'TECHNICAL' | 'REGULATORY' | 'OTHER';
export type RequirementStatus = 'OPEN' | 'VERIFIED' | 'NOT_APPLICABLE';
export const REQ_CATEGORY_LABELS: Record<RequirementCategory, string> = {
  TIME: '时间', COMMERCIAL: '商务', TECHNICAL: '技术', REGULATORY: '法规', OTHER: '其他',
};
export const REQ_STATUS_LABELS: Record<RequirementStatus, string> = { OPEN: '未验证', VERIFIED: '已验证', NOT_APPLICABLE: '不适用' };
export interface Requirement {
  id: string; code: string; title: string; category: RequirementCategory; source: string;
  verificationMethod: string; deliverableId: string | null; status: RequirementStatus; note: string | null;
}
export interface PlanVersion {
  id: string; version: number; note: string; changeRequestId: string | null; createdAt: string;
  snapshot: {
    project: { startDate: string; endDate: string; customerDeliveryDate: string | null; budget: string | null };
    workPackages: { id: string; code: string; name: string; start: string; end: string; durationDays: number; budget: string | null; isLeaf: boolean }[];
  };
}

export type Health = 'RED' | 'AMBER' | 'GREEN';
export interface Dimension { health: Health; reasons: string[] }
export interface Performance {
  baselineVersion: number | null;
  thresholds: { amber: number; red: number };
  evm: { basis: 'WORK_PACKAGE_BUDGET' | 'DURATION'; bac: number; pv: number; ev: number; ac: number; spi: number | null; cpi: number | null; eac: number | null; budget: number | null };
  schedule: {
    baselineEnd: string | null; projectedEnd: string; plannedEnd: string; customerDate: string | null; slipDays: number;
    slips: { id: string; code: string; name: string; baselineEnd: string; currentEnd: string; slipDays: number; critical: boolean }[];
  };
  quality: {
    requirements: number; uncoveredRequirements: number; verifiedRequirements: number;
    deliverables: number; acceptedDeliverables: number; rejectedDeliverables: number; overdueDeliverables: number;
    openNonconformities: number; criticalNonconformities: number; majorNonconformities: number;
  };
  triangle: { quality: Dimension; schedule: Dimension; cost: Dimension };
}

export interface WbsTemplate { id: string; name: string; items: { code: string; name: string; parentCode?: string; durationDays: number; isMilestone?: boolean }[] }
export interface ResourceLoad {
  weeks: { start: string; capacity: number }[];
  people: { userId: string; name: string; load: number[]; overloadedWeeks: number; items: { project: string; code: string; name: string; days: number }[] }[];
}
export interface CalendarSettings { systemName: string; companyName: string; evmAmber: number; evmRed: number; workWeek: number[]; holidays: string[]; extraWorkdays: string[]; requireCosign?: boolean; allowDirectProject?: boolean }

export interface SwotReview { id: string; reviewDate: string; participants: string; strengths: string; weaknesses: string; opportunities: string; threats: string; actions: string }
export interface DeviationNotice { id: string; dimension: 'QUALITY' | 'SCHEDULE' | 'COST'; noticeDate: string; audience: string; impact: string; countermeasures: string }
export interface Stakeholder { id: string; name: string; organization: string; role: string; influence: 'HIGH' | 'MEDIUM' | 'LOW'; interest: 'HIGH' | 'MEDIUM' | 'LOW'; expectations: string; communication: string }
export const LEVEL_LABELS = { HIGH: '高', MEDIUM: '中', LOW: '低' } as const;
export const DIMENSION_LABELS = { QUALITY: '质量', SCHEDULE: '进度', COST: '成本' } as const;

// —— 立项、项目要求、计划批准、计划模板 ——
export type ProjectType = 'A' | 'B' | 'C';
export const PROJECT_TYPE_LABELS: Record<ProjectType, string> = { A: 'A 类 · 含产品设计开发', B: 'B 类 · 基于客户合同', C: 'C 类 · 按库存计划' };
export const PROJECT_TYPE_HINTS: Record<ProjectType, string> = {
  A: '客户合同 + 设计开发；FAI 必做',
  B: '不含设计开发；量产前技术准备；FAI 可选',
  C: '无客户合同；以入库代替交付；FAI 可选',
};
export interface Requirements {
  deliveryDate?: string;
  milestones: { name: string; date: string }[];
  deliverables: { name: string; quantity: string; kind: 'PRODUCT' | 'DOCUMENT' }[];
  stockLines: { product: string; quantity: number; date: string }[];
  quality: { standards: string[]; special: string; acceptance: string; fai: boolean; faiReason: string; customerWitness: boolean; drawingApproval: boolean; rams: boolean };
  cost: { cap: number; target?: number };
  longLead: boolean;
  risks: { text: string; kind: 'RISK' | 'OPPORTUNITY' }[];
}
export function emptyRequirements(): Requirements {
  return {
    milestones: [], deliverables: [], stockLines: [], risks: [], longLead: false,
    quality: { standards: [], special: '', acceptance: '', fai: true, faiReason: '', customerWitness: false, drawingApproval: false, rams: false },
    cost: { cap: 0 },
  };
}
export type InitiationStatus = 'DRAFT' | 'COSIGN' | 'PENDING' | 'APPROVED' | 'REJECTED' | 'WITHDRAWN';
export const INITIATION_STATUS_LABELS: Record<InitiationStatus, string> = {
  DRAFT: '草稿', COSIGN: '待会签', PENDING: '待审批', APPROVED: '已批准', REJECTED: '驳回', WITHDRAWN: '已撤回',
};
export interface InitiationOpinion { id: string; userId: string; agree: boolean; opinion: string; createdAt: string }
export interface Initiation {
  id: string; code: string; projectCode: string; name: string; type: ProjectType; riskLevel: RiskLevel; productFamily: string;
  proposedPmId: string | null; customer: string; contractNo: string; contractAmount: string | null; startDate: string | null;
  requirements: Requirements; status: InitiationStatus; applicantId: string; submittedAt: string | null;
  decidedById: string | null; decidedAt: string | null; decisionNote: string | null; projectId: string | null; createdAt: string;
  opinions: InitiationOpinion[];
  problems?: string[];
  cosigners?: string[];
  can?: { edit: boolean; submit: boolean; withdraw: boolean; cosign: boolean; decide: boolean };
}
export type ApprovalRoleKind = 'INITIATOR' | 'APPROVER' | 'COSIGNER' | 'PLAN_APPROVER' | 'HR';
export const APPROVAL_ROLE_LABELS: Record<ApprovalRoleKind, string> = {
  INITIATOR: '立项申请人', COSIGNER: '会签人', APPROVER: '立项批准人', PLAN_APPROVER: '计划批准人', HR: '人事',
};
export const APPROVAL_ROLE_DEFAULTS: Record<ApprovalRoleKind, string> = {
  INITIATOR: '未指定时：企业管理员、最高管理层、项目经理',
  COSIGNER: '未指定时：没有会签人（开启会签前请先指定）',
  APPROVER: '未指定时：最高管理层',
  PLAN_APPROVER: '未指定时：最高管理层；立项批准人也可批准计划',
  HR: '未指定时：没有人事（项目绩效评价单发给人事前请先指定）',
};
export interface ApprovalAssignment { id: string; kind: ApprovalRoleKind; userId: string; basis: string; validFrom: string | null; validTo: string | null }
export interface MyApprovalRoles { initiator: boolean; approver: boolean; cosigner: boolean; planApprover: boolean }
export type RequirementChangeStatus = 'DRAFT' | 'PENDING' | 'APPROVED' | 'REJECTED';
export const RC_STATUS_LABELS: Record<RequirementChangeStatus, string> = { DRAFT: '草稿', PENDING: '待审批', APPROVED: '已批准', REJECTED: '驳回' };
export interface RequirementChange {
  id: string; projectId: string; code: string; reason: string; data: Requirements & { type?: ProjectType }; fromVersion: number;
  status: RequirementChangeStatus; applicantId: string; submittedAt: string | null; decidedAt: string | null; decisionNote: string | null; createdAt: string;
  project?: { id: string; code: string; name: string; type?: ProjectType; requirementVersion?: number } | null;
  current?: (Requirements & { type?: ProjectType }) | null;
  can?: { edit: boolean; decide: boolean };
}
export interface RequirementVersion { id: string; version: number; data: Requirements & { type?: ProjectType }; reason: string; approvedById: string; approvedAt: string; changeId: string | null }
export interface PlanCheck { key: string; ok: boolean; message: string }
export interface PlanApprovalStatus {
  needsApproval: boolean; submittedAt: string | null; outdated: boolean; baselined: boolean; checks: PlanCheck[]; ok: boolean;
  can: { submit: boolean; approve: boolean; selfApprove: boolean };
}
export interface PlanTemplateRow {
  code: string; name: string; group?: true; phase?: string | null;
  durationDays?: number; predecessors?: string[]; role?: string; deliverable?: string; milestone?: boolean; condition?: string;
}
export interface PlanTemplate { type: ProjectType; custom: boolean; updatedAt: string | null; items: PlanTemplateRow[] }
export interface OptionalWorkPackage { id: string; name: string; durationDays: number; suggestedPhase: string; roleName: string; deliverable: string; types: ProjectType[]; active: boolean }

// —— 成本与质量的策划、执行与控制 ——
export type CostState = '' | 'AMBER' | 'RED';
export interface WpCost {
  id: string; code: string; name: string; ownerId: string | null; percentComplete: number; isMilestone: boolean;
  role: { id: string; name: string; rate: number } | null;
  personDays: number; rate: number; rateOverride: number | null; rateReason: string | null; labor: number;
  lines: { id: string; accountId: string; description: string; amount: number }[];
  budget: number; actual: number; commitment: number; etc: number; etcManual: boolean; eac: number; state: CostState;
}
export interface CostPlan {
  cap: number | null; target: number | null; accSum: number; wpSum: number; eac: number; alarm: string | null;
  accounts: { id: string; code: string; name: string; isLabor: boolean; budget: number; wpTotal: number }[];
  workPackages: WpCost[];
  checks: PlanCheck[];
}
export type InspectionResult = 'PENDING' | 'PASS' | 'FAIL' | 'NA';
export const INSPECTION_RESULT_LABELS: Record<InspectionResult, string> = { PENDING: '待检', PASS: '合格', FAIL: '不合格', NA: '不适用' };
export interface InspectionItem {
  id: string; workPackageId: string; name: string; category: string; requirement: string; method: string; record: string;
  verifierId: string | null; isKey: boolean; result: InspectionResult; firstResult: InspectionResult | null; recordNo: string; resultNote: string;
  resultAt: string | null; ncId: string | null;
  workPackage?: { code: string; name: string; ownerId: string | null; status: WpStatus };
}
export interface InspectionStats {
  total: number; key: number; keyWithoutVerifier: number; done: number; pending: number; failed: number; firstPassYield: number | null;
  workPackages: number; missing: { id: string; code: string; name: string }[];
}
export interface InspectionTemplate { id: string; name: string; category: string; requirement: string; method: string; record: string; active: boolean }

// ───── 第 5C 章：项目绩效评价 ─────
export interface Department { id: string; name: string; headId: string | null; active: boolean }
export interface PerfAspect { key: string; name: string; weight: number }
export interface PerfConfig {
  aspects: PerfAspect[];
  rules: { latePerDay: number; faiNotFirstPass: number; majorNc: number; criticalNc: number; customerNc: number; fpyTarget: number; fpyPerPct: number; capScore: number; overTargetPerPct: number; overCapPerPct: number };
  memberDims: string[];
  grades: { excellent: number; good: number; pass: number };
  visibility: { memberSelf: boolean; deptHead: boolean; hr: boolean };
}
export interface AspectResult { key: string; name: string; weight: number; auto: boolean; target: string; actual: string; score: number | null; estimate?: boolean }
export interface MemberReference { workPackages: number; done: number; onTimeRate: number | null; firstPassYield: number | null; overruns: number; overdueActions: number; text: string }
export interface MemberEvalRow {
  userId: string; name: string; roleName: string; reference: MemberReference | null; scores: Record<string, number>; score: number | null; grade: string | null;
  comment: string; status: 'DRAFT' | 'SUBMITTED'; version: number; submittedAt: string | null; editable: boolean;
}
export interface ProjectEvaluation {
  config: { aspects: PerfAspect[]; memberDims: string[]; grades: PerfConfig['grades'] };
  pm: null | {
    managers: { id: string; name: string }[]; aspects: AspectResult[]; total: number | null; complete: boolean; score: number | null; grade: string | null;
    adjustedScore: number | null; adjustReason: string | null; comment: string | null; aspectsReason: string | null; customAspects: boolean; actualDelivery: string | null;
    confirmedAt: string | null;
  };
  members: MemberEvalRow[];
  can: { evaluate: boolean; manage: boolean; setWeights: boolean; export: boolean };
}
export interface EvaluationSheet {
  kind: 'PM' | 'MEMBER'; id: string; project: { id: string; code: string; name: string; status: string }; userId: string; name: string; department: string; roleName: string;
  score: number; grade: string; comment: string; submittedAt: string | null;
  aspects?: AspectResult[]; adjustReason?: string | null; reference?: MemberReference; scores?: Record<string, number>; evaluator?: string; version?: number;
}

// ───── 第 3 步：采购计划、FAI、售后交接 ─────
export type PurchaseStatus = 'PLANNED' | 'ORDERED' | 'PARTIAL' | 'RECEIVED' | 'CANCELLED';
export const PURCHASE_STATUS_LABELS: Record<PurchaseStatus, string> = { PLANNED: '未下单', ORDERED: '已下单', PARTIAL: '部分到货', RECEIVED: '已到货', CANCELLED: '已取消' };
export interface PurchaseItemRow {
  id: string; code: string; name: string; supplier: string; quantity: string; needDate: string | null; orderBy: string | null; longLead: boolean;
  workPackageId: string | null; accountId: string | null; amount: number; status: PurchaseStatus; orderNo: string | null; orderedAt: string | null;
  receivedPct: number; receivedAt: string | null; settledAt: string | null; notes: string; overdue: boolean; wp: { id: string; code: string; name: string } | null;
}
export interface PurchasePlanView {
  plan: { version: number; approvedAt: string | null; approvedBy: string | null; dirty: boolean };
  items: PurchaseItemRow[];
  stats: { items: number; workPackages: number; longLead: number; longLeadOrdered: number; receivedPct: number; overdue: string[]; committed: number };
  checks: { ok: boolean; message: string }[];
  workPackages: { id: string; code: string; name: string; isPurchase: boolean }[];
  accounts: { id: string; code: string; name: string }[];
  canEdit: boolean; canApprove: boolean;
}
export type FaiResult = 'PASS' | 'CONDITIONAL' | 'FAIL';
export const FAI_RESULT_LABELS: Record<FaiResult, string> = { PASS: '通过', CONDITIONAL: '有条件通过', FAIL: '不通过' };
export interface FaiRecordRow {
  id: string; reportNo: string; date: string; part: string; result: FaiResult; witnessed: boolean; witness: string; location: string; notes: string; createdBy: string;
  actions: { id: string; title: string; status: string }[];
}
export interface FaiView {
  requirement: { fai: boolean; faiReason: string; customerWitness: boolean; version: number } | null;
  records: FaiRecordRow[]; firstPass: boolean | null; state: 'GREY' | 'GREEN' | 'AMBER' | 'RED'; text: string; canEdit: boolean;
}
export interface HandoverView {
  handover: {
    id: string; status: 'DRAFT' | 'PENDING' | 'CONFIRMED'; date: string | null; receiverId: string | null; externalName: string; warrantyFrom: string | null; warrantyTo: string | null;
    documents: string[]; openIssues: string; from: string | null; receiver: string | null; submittedAt: string | null; confirmedAt: string | null; confirmNote: string;
  };
  defaultDocuments: string[]; required: boolean;
  can: { edit: boolean; submit: boolean; withdraw: boolean; confirm: boolean };
}
