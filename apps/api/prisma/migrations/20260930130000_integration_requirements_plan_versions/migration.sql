-- CreateEnum
CREATE TYPE "RequirementCategory" AS ENUM ('TIME', 'COMMERCIAL', 'TECHNICAL', 'REGULATORY', 'OTHER');

-- CreateEnum
CREATE TYPE "RequirementStatus" AS ENUM ('OPEN', 'VERIFIED', 'NOT_APPLICABLE');

-- AlterTable
ALTER TABLE "cost_entries" ADD COLUMN     "work_package_id" TEXT;

-- AlterTable
ALTER TABLE "projects" ADD COLUMN     "gate_review_wbs_level" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "work_packages" ADD COLUMN     "cost_account_id" TEXT,
ADD COLUMN     "deliverable_id" TEXT,
ADD COLUMN     "external_provider" TEXT,
ADD COLUMN     "long_lead" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "resource_days" DECIMAL(10,1);

-- CreateTable
CREATE TABLE "requirements" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "category" "RequirementCategory" NOT NULL,
    "source" TEXT NOT NULL DEFAULT '',
    "verification_method" TEXT NOT NULL DEFAULT '',
    "deliverable_id" TEXT,
    "status" "RequirementStatus" NOT NULL DEFAULT 'OPEN',
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "requirements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plan_versions" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "change_request_id" TEXT,
    "note" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "created_by_id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "plan_versions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "requirements_tenant_id_project_id_idx" ON "requirements"("tenant_id", "project_id");

-- CreateIndex
CREATE UNIQUE INDEX "requirements_project_id_code_key" ON "requirements"("project_id", "code");

-- CreateIndex
CREATE INDEX "plan_versions_tenant_id_project_id_idx" ON "plan_versions"("tenant_id", "project_id");

-- CreateIndex
CREATE UNIQUE INDEX "plan_versions_project_id_version_key" ON "plan_versions"("project_id", "version");

-- AddForeignKey
ALTER TABLE "work_packages" ADD CONSTRAINT "work_packages_cost_account_id_fkey" FOREIGN KEY ("cost_account_id") REFERENCES "cost_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_packages" ADD CONSTRAINT "work_packages_deliverable_id_fkey" FOREIGN KEY ("deliverable_id") REFERENCES "deliverables"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "requirements" ADD CONSTRAINT "requirements_deliverable_id_fkey" FOREIGN KEY ("deliverable_id") REFERENCES "deliverables"("id") ON DELETE SET NULL ON UPDATE CASCADE;


ALTER TABLE requirements ENABLE ROW LEVEL SECURITY;
ALTER TABLE requirements FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON requirements
  USING (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE plan_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE plan_versions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON plan_versions
  USING (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true));
