-- CreateEnum
CREATE TYPE "RiskLevel3" AS ENUM ('ENTERPRISE', 'PROJECT', 'WORK_PACKAGE');
-- CreateEnum
CREATE TYPE "ObjectiveMetric" AS ENUM ('DELIVERY', 'COST', 'FAI', 'FIRST_PASS_YIELD', 'MANUAL');
-- AlterEnum
ALTER TYPE "RiskStatus" ADD VALUE 'REVIEW';
-- AlterTable
ALTER TABLE "risks" ADD COLUMN     "accept_approved_at" TIMESTAMP(3),
ADD COLUMN     "accept_approved_by_id" TEXT,
ADD COLUMN     "accept_reason" TEXT,
ADD COLUMN     "cause" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "closed_at" TIMESTAMP(3),
ADD COLUMN     "closed_by_id" TEXT,
ADD COLUMN     "contingency_plan" TEXT,
ADD COLUMN     "effect" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "level" "RiskLevel3" NOT NULL DEFAULT 'PROJECT',
ADD COLUMN     "next_review_at" DATE,
ADD COLUMN     "notified_level" TEXT,
ADD COLUMN     "objective_id" TEXT,
ADD COLUMN     "residual_impact" INTEGER,
ADD COLUMN     "residual_probability" INTEGER,
ADD COLUMN     "review_cycle_days" INTEGER,
ADD COLUMN     "strategy" TEXT,
ADD COLUMN     "trigger" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "triggered_at" TIMESTAMP(3),
ADD COLUMN     "work_package_id" TEXT,
ALTER COLUMN "project_id" DROP NOT NULL,
ALTER COLUMN "exposure_amount" SET DEFAULT 0,
ALTER COLUMN "response_cost" SET DEFAULT 0,
ALTER COLUMN "cost_benefit_analysis" SET DEFAULT '';
-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "risk_criteria" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "risk_matrix" JSONB NOT NULL DEFAULT '[[0,0,1],[0,1,2],[1,2,2]]',
ADD COLUMN     "risk_rules" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "risk_scale" INTEGER NOT NULL DEFAULT 3,
ADD COLUMN     "risk_strategies" JSONB NOT NULL DEFAULT '{}';
-- CreateTable
CREATE TABLE "risk_project_links" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "risk_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "risk_project_links_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "risk_measures" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "risk_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "owner_id" TEXT,
    "due_date" DATE,
    "cost" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "done_at" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "risk_measures_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "risk_reviews" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "risk_id" TEXT NOT NULL,
    "reviewed_by_id" TEXT NOT NULL,
    "probability" INTEGER NOT NULL,
    "impact" INTEGER NOT NULL,
    "note" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "risk_reviews_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "project_objectives" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "dimension" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "metric" "ObjectiveMetric" NOT NULL DEFAULT 'MANUAL',
    "current" TEXT NOT NULL DEFAULT '',
    "manual_state" TEXT,
    "auto" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "project_objectives_pkey" PRIMARY KEY ("id")
);
-- CreateIndex
CREATE INDEX "risk_project_links_tenant_id_project_id_idx" ON "risk_project_links"("tenant_id", "project_id");
-- CreateIndex
CREATE UNIQUE INDEX "risk_project_links_risk_id_project_id_key" ON "risk_project_links"("risk_id", "project_id");
-- CreateIndex
CREATE INDEX "risk_measures_tenant_id_risk_id_idx" ON "risk_measures"("tenant_id", "risk_id");
-- CreateIndex
CREATE INDEX "risk_reviews_tenant_id_risk_id_idx" ON "risk_reviews"("tenant_id", "risk_id");
-- CreateIndex
CREATE INDEX "project_objectives_tenant_id_project_id_idx" ON "project_objectives"("tenant_id", "project_id");
-- CreateIndex
CREATE INDEX "risks_tenant_id_level_idx" ON "risks"("tenant_id", "level");
-- AddForeignKey
ALTER TABLE "risk_project_links" ADD CONSTRAINT "risk_project_links_risk_id_fkey" FOREIGN KEY ("risk_id") REFERENCES "risks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "risk_measures" ADD CONSTRAINT "risk_measures_risk_id_fkey" FOREIGN KEY ("risk_id") REFERENCES "risks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "risk_reviews" ADD CONSTRAINT "risk_reviews_risk_id_fkey" FOREIGN KEY ("risk_id") REFERENCES "risks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 已有企业沿用 1–5 分的评价（保持原有风险的含义）；新企业默认 3 档（高 / 中 / 低）
SELECT set_config('app.bypass_rls', 'on', false);
UPDATE tenants SET risk_scale = 5, risk_matrix = '[[0,0,0,0,0],[0,0,1,1,1],[0,1,1,1,2],[0,1,1,2,2],[0,1,2,2,2]]';
SELECT set_config('app.bypass_rls', '', false);

ALTER TABLE risk_project_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE risk_project_links FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON risk_project_links
  USING (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE risk_measures ENABLE ROW LEVEL SECURITY;
ALTER TABLE risk_measures FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON risk_measures
  USING (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE risk_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE risk_reviews FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON risk_reviews
  USING (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE project_objectives ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_objectives FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON project_objectives
  USING (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true));
