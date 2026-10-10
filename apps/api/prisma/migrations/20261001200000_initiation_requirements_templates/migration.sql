-- CreateEnum
CREATE TYPE "ProjectType" AS ENUM ('A', 'B', 'C');

-- CreateEnum
CREATE TYPE "InitiationStatus" AS ENUM ('DRAFT', 'COSIGN', 'PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "ApprovalRoleKind" AS ENUM ('INITIATOR', 'APPROVER', 'COSIGNER', 'PLAN_APPROVER');

-- CreateEnum
CREATE TYPE "RequirementChangeStatus" AS ENUM ('DRAFT', 'PENDING', 'APPROVED', 'REJECTED');

-- AlterTable
ALTER TABLE "projects" ADD COLUMN     "initiation_id" TEXT,
ADD COLUMN     "plan_outdated" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "plan_submitted_at" TIMESTAMP(3),
ADD COLUMN     "requirement_version" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "type" "ProjectType" NOT NULL DEFAULT 'B';

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "allow_direct_project" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "require_cosign" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "work_packages" ADD COLUMN     "functional_role_id" TEXT,
ADD COLUMN     "is_purchase" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "approval_assignments" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "kind" "ApprovalRoleKind" NOT NULL,
    "user_id" TEXT NOT NULL,
    "basis" TEXT NOT NULL DEFAULT '',
    "valid_from" DATE,
    "valid_to" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "approval_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "initiations" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "project_code" TEXT NOT NULL DEFAULT '',
    "name" TEXT NOT NULL,
    "type" "ProjectType" NOT NULL DEFAULT 'B',
    "risk_level" "RiskLevel" NOT NULL DEFAULT 'MEDIUM',
    "product_family" TEXT NOT NULL DEFAULT '',
    "proposed_pm_id" TEXT,
    "customer" TEXT NOT NULL DEFAULT '',
    "contract_no" TEXT NOT NULL DEFAULT '',
    "contract_amount" DECIMAL(14,2),
    "start_date" DATE,
    "requirements" JSONB NOT NULL DEFAULT '{}',
    "status" "InitiationStatus" NOT NULL DEFAULT 'DRAFT',
    "applicant_id" TEXT NOT NULL,
    "submitted_at" TIMESTAMP(3),
    "decided_by_id" TEXT,
    "decided_at" TIMESTAMP(3),
    "decision_note" TEXT,
    "project_id" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "initiations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "initiation_opinions" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "initiation_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "agree" BOOLEAN NOT NULL,
    "opinion" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "initiation_opinions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_requirement_versions" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "data" JSONB NOT NULL,
    "reason" TEXT NOT NULL,
    "approved_by_id" TEXT NOT NULL,
    "approved_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "change_id" TEXT,

    CONSTRAINT "project_requirement_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "requirement_changes" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "from_version" INTEGER NOT NULL,
    "status" "RequirementChangeStatus" NOT NULL DEFAULT 'DRAFT',
    "applicant_id" TEXT NOT NULL,
    "submitted_at" TIMESTAMP(3),
    "decided_by_id" TEXT,
    "decided_at" TIMESTAMP(3),
    "decision_note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "requirement_changes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "optional_work_packages" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "duration_days" INTEGER NOT NULL,
    "suggested_phase" TEXT NOT NULL DEFAULT '',
    "role_name" TEXT NOT NULL DEFAULT '',
    "deliverable" TEXT NOT NULL DEFAULT '',
    "types" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "optional_work_packages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plan_type_templates" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "type" "ProjectType" NOT NULL,
    "items" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "plan_type_templates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "approval_assignments_tenant_id_idx" ON "approval_assignments"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "approval_assignments_tenant_id_kind_user_id_key" ON "approval_assignments"("tenant_id", "kind", "user_id");

-- CreateIndex
CREATE INDEX "initiations_tenant_id_idx" ON "initiations"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "initiations_tenant_id_code_key" ON "initiations"("tenant_id", "code");

-- CreateIndex
CREATE INDEX "initiation_opinions_tenant_id_idx" ON "initiation_opinions"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "initiation_opinions_initiation_id_user_id_key" ON "initiation_opinions"("initiation_id", "user_id");

-- CreateIndex
CREATE INDEX "project_requirement_versions_tenant_id_project_id_idx" ON "project_requirement_versions"("tenant_id", "project_id");

-- CreateIndex
CREATE UNIQUE INDEX "project_requirement_versions_project_id_version_key" ON "project_requirement_versions"("project_id", "version");

-- CreateIndex
CREATE INDEX "requirement_changes_tenant_id_project_id_idx" ON "requirement_changes"("tenant_id", "project_id");

-- CreateIndex
CREATE UNIQUE INDEX "requirement_changes_tenant_id_code_key" ON "requirement_changes"("tenant_id", "code");

-- CreateIndex
CREATE INDEX "optional_work_packages_tenant_id_idx" ON "optional_work_packages"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "optional_work_packages_tenant_id_name_key" ON "optional_work_packages"("tenant_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "plan_type_templates_tenant_id_type_key" ON "plan_type_templates"("tenant_id", "type");

-- AddForeignKey
ALTER TABLE "initiation_opinions" ADD CONSTRAINT "initiation_opinions_initiation_id_fkey" FOREIGN KEY ("initiation_id") REFERENCES "initiations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 已有企业补上默认的可选工作包库（启用行级安全之前插入）
INSERT INTO "optional_work_packages" ("id", "tenant_id", "name", "duration_days", "suggested_phase", "role_name", "deliverable", "types")
SELECT gen_random_uuid()::text, t."id", l.name, l.dur, l.phase, l.role, l.deliv, l.types
FROM "tenants" t CROSS JOIN (VALUES
  ('软件开发与验证', 40, '产品设计开发', '技术', '软件版本及测试报告', ARRAY['A']::text[]),
  ('EMC / 环境试验', 15, '产品设计开发', '质量', '试验报告', ARRAY['A']::text[]),
  ('型式试验', 20, '设计冻结或 FAI 之后', '质量', '型式试验报告', ARRAY['A','B']::text[]),
  ('第三方认证（如 CRCC、防火 EN 45545）', 40, '量产前', '质量', '认证证书', ARRAY['A','B']::text[]),
  ('特殊过程确认（焊接、涂装、粘接等）', 10, '工艺设计开发 / 技术准备', '工艺', '过程确认记录', ARRAY['A','B','C']::text[]),
  ('包装方案设计与验证', 5, '工艺设计开发 / 技术准备', '物流', '包装规范', ARRAY['A','B']::text[]),
  ('使用维护手册编写', 10, '设计冻结 / 技术准备之后', '技术', '手册', ARRAY['A','B']::text[]),
  ('客户监造或驻厂检验', 20, '量产', '质量', '监造记录', ARRAY['A','B']::text[]),
  ('备品备件供货', 15, '量产', '采购', '备件清单', ARRAY['A','B']::text[]),
  ('现场安装调试', 10, '交付', '售后', '调试报告', ARRAY['A','B']::text[]),
  ('用户培训', 3, '交付', '技术', '培训记录', ARRAY['A','B']::text[])
) AS l(name, dur, phase, role, deliv, types);

ALTER TABLE approval_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE approval_assignments FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON approval_assignments
  USING (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE initiations ENABLE ROW LEVEL SECURITY;
ALTER TABLE initiations FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON initiations
  USING (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE initiation_opinions ENABLE ROW LEVEL SECURITY;
ALTER TABLE initiation_opinions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON initiation_opinions
  USING (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE project_requirement_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_requirement_versions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON project_requirement_versions
  USING (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE requirement_changes ENABLE ROW LEVEL SECURITY;
ALTER TABLE requirement_changes FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON requirement_changes
  USING (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE optional_work_packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE optional_work_packages FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON optional_work_packages
  USING (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE plan_type_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE plan_type_templates FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON plan_type_templates
  USING (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true));
