-- CreateEnum
CREATE TYPE "PurchaseStatus" AS ENUM ('PLANNED', 'ORDERED', 'PARTIAL', 'RECEIVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "FaiResult" AS ENUM ('PASS', 'CONDITIONAL', 'FAIL');

-- CreateEnum
CREATE TYPE "HandoverStatus" AS ENUM ('DRAFT', 'PENDING', 'CONFIRMED');

-- AlterTable
ALTER TABLE "cost_commitments" ADD COLUMN     "purchase_item_id" TEXT;

-- CreateTable
CREATE TABLE "purchase_plans" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "approved_at" TIMESTAMP(3),
    "approved_by_id" TEXT,
    "dirty" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "purchase_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_items" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "supplier" TEXT NOT NULL DEFAULT '',
    "quantity" TEXT NOT NULL DEFAULT '',
    "need_date" DATE,
    "order_by" DATE,
    "long_lead" BOOLEAN NOT NULL DEFAULT false,
    "work_package_id" TEXT,
    "account_id" TEXT,
    "amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "status" "PurchaseStatus" NOT NULL DEFAULT 'PLANNED',
    "order_no" TEXT,
    "ordered_at" DATE,
    "received_pct" INTEGER NOT NULL DEFAULT 0,
    "received_at" DATE,
    "settled_at" TIMESTAMP(3),
    "notes" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "purchase_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fai_records" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "report_no" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "part" TEXT NOT NULL,
    "result" "FaiResult" NOT NULL,
    "witnessed" BOOLEAN NOT NULL DEFAULT false,
    "witness" TEXT NOT NULL DEFAULT '',
    "location" TEXT NOT NULL DEFAULT '',
    "notes" TEXT NOT NULL DEFAULT '',
    "created_by_id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fai_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "handovers" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "date" DATE,
    "from_id" TEXT,
    "receiver_id" TEXT,
    "external_name" TEXT NOT NULL DEFAULT '',
    "warranty_from" DATE,
    "warranty_to" DATE,
    "documents" JSONB NOT NULL DEFAULT '[]',
    "open_issues" TEXT NOT NULL DEFAULT '',
    "status" "HandoverStatus" NOT NULL DEFAULT 'DRAFT',
    "submitted_at" TIMESTAMP(3),
    "confirmed_at" TIMESTAMP(3),
    "confirmed_by_id" TEXT,
    "confirm_note" TEXT NOT NULL DEFAULT '',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "handovers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "purchase_plans_project_id_key" ON "purchase_plans"("project_id");

-- CreateIndex
CREATE INDEX "purchase_plans_tenant_id_idx" ON "purchase_plans"("tenant_id");

-- CreateIndex
CREATE INDEX "purchase_items_tenant_id_project_id_idx" ON "purchase_items"("tenant_id", "project_id");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_items_project_id_code_key" ON "purchase_items"("project_id", "code");

-- CreateIndex
CREATE INDEX "fai_records_tenant_id_project_id_idx" ON "fai_records"("tenant_id", "project_id");

-- CreateIndex
CREATE UNIQUE INDEX "fai_records_project_id_report_no_key" ON "fai_records"("project_id", "report_no");

-- CreateIndex
CREATE UNIQUE INDEX "handovers_project_id_key" ON "handovers"("project_id");

-- CreateIndex
CREATE INDEX "handovers_tenant_id_idx" ON "handovers"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "cost_commitments_purchase_item_id_key" ON "cost_commitments"("purchase_item_id");


ALTER TABLE purchase_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_plans FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON purchase_plans
  USING (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE purchase_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_items FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON purchase_items
  USING (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE fai_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE fai_records FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON fai_records
  USING (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE handovers ENABLE ROW LEVEL SECURITY;
ALTER TABLE handovers FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON handovers
  USING (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true));
