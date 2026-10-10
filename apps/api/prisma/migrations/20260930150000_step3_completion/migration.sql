-- CreateEnum
CREATE TYPE "DeviationDimension" AS ENUM ('QUALITY', 'SCHEDULE', 'COST');

-- AlterTable
ALTER TABLE "phases" ADD COLUMN     "optional_roles" JSONB NOT NULL DEFAULT '[]';

-- AlterTable
ALTER TABLE "risks" ADD COLUMN     "budget_recovery" DECIMAL(14,2),
ADD COLUMN     "functional_reviewers" TEXT,
ADD COLUMN     "maturity_level" TEXT;

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "extra_workdays" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "holidays" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "work_week" INTEGER[] DEFAULT ARRAY[1, 2, 3, 4, 5]::INTEGER[];

-- AlterTable
ALTER TABLE "work_packages" ADD COLUMN     "is_milestone" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "wbs_templates" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "items" JSONB NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wbs_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "swot_reviews" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "review_date" DATE NOT NULL,
    "participants" TEXT NOT NULL,
    "strengths" TEXT NOT NULL DEFAULT '',
    "weaknesses" TEXT NOT NULL DEFAULT '',
    "opportunities" TEXT NOT NULL DEFAULT '',
    "threats" TEXT NOT NULL DEFAULT '',
    "actions" TEXT NOT NULL DEFAULT '',
    "created_by_id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "swot_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deviation_notices" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "dimension" "DeviationDimension" NOT NULL,
    "notice_date" DATE NOT NULL,
    "audience" TEXT NOT NULL,
    "impact" TEXT NOT NULL,
    "countermeasures" TEXT NOT NULL,
    "created_by_id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "deviation_notices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stakeholders" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "organization" TEXT NOT NULL DEFAULT '',
    "role" TEXT NOT NULL DEFAULT '',
    "influence" TEXT NOT NULL DEFAULT 'MEDIUM',
    "interest" TEXT NOT NULL DEFAULT 'MEDIUM',
    "expectations" TEXT NOT NULL DEFAULT '',
    "communication" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stakeholders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "wbs_templates_tenant_id_name_key" ON "wbs_templates"("tenant_id", "name");

-- CreateIndex
CREATE INDEX "swot_reviews_tenant_id_project_id_idx" ON "swot_reviews"("tenant_id", "project_id");

-- CreateIndex
CREATE INDEX "deviation_notices_tenant_id_project_id_idx" ON "deviation_notices"("tenant_id", "project_id");

-- CreateIndex
CREATE INDEX "stakeholders_tenant_id_project_id_idx" ON "stakeholders"("tenant_id", "project_id");


ALTER TABLE wbs_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE wbs_templates FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON wbs_templates
  USING (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE swot_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE swot_reviews FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON swot_reviews
  USING (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE deviation_notices ENABLE ROW LEVEL SECURITY;
ALTER TABLE deviation_notices FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON deviation_notices
  USING (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE stakeholders ENABLE ROW LEVEL SECURITY;
ALTER TABLE stakeholders FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON stakeholders
  USING (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true));
