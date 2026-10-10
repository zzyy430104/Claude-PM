-- CreateEnum
CREATE TYPE "EvaluationStatus" AS ENUM ('DRAFT', 'SUBMITTED');

-- AlterEnum
ALTER TYPE "ApprovalRoleKind" ADD VALUE 'HR';

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "perf_config" JSONB NOT NULL DEFAULT '{}';

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "department_id" TEXT;

-- CreateTable
CREATE TABLE "departments" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "head_id" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "departments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_performances" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "aspects" JSONB,
    "aspects_reason" TEXT,
    "actual_delivery" DATE,
    "manual_scores" JSONB NOT NULL DEFAULT '{}',
    "adjusted_score" INTEGER,
    "adjust_reason" TEXT,
    "comment" TEXT,
    "confirmed_at" TIMESTAMP(3),
    "confirmed_by_id" TEXT,
    "snapshot" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_performances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "member_evaluations" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "evaluator_id" TEXT NOT NULL,
    "role_name" TEXT NOT NULL DEFAULT '',
    "reference" JSONB NOT NULL DEFAULT '{}',
    "scores" JSONB NOT NULL DEFAULT '{}',
    "score" INTEGER NOT NULL DEFAULT 0,
    "grade" TEXT NOT NULL DEFAULT '',
    "comment" TEXT NOT NULL DEFAULT '',
    "status" "EvaluationStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 0,
    "submitted_at" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "member_evaluations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "departments_tenant_id_idx" ON "departments"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "departments_tenant_id_name_key" ON "departments"("tenant_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "project_performances_project_id_key" ON "project_performances"("project_id");

-- CreateIndex
CREATE INDEX "project_performances_tenant_id_idx" ON "project_performances"("tenant_id");

-- CreateIndex
CREATE INDEX "member_evaluations_tenant_id_user_id_idx" ON "member_evaluations"("tenant_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "member_evaluations_project_id_user_id_key" ON "member_evaluations"("project_id", "user_id");


ALTER TABLE departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE departments FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON departments
  USING (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE project_performances ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_performances FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON project_performances
  USING (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE member_evaluations ENABLE ROW LEVEL SECURITY;
ALTER TABLE member_evaluations FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON member_evaluations
  USING (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true));
