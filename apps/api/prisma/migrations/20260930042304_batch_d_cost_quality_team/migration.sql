-- CreateEnum
CREATE TYPE "NcSeverity" AS ENUM ('MINOR', 'MAJOR', 'CRITICAL');

-- CreateEnum
CREATE TYPE "NcStatus" AS ENUM ('OPEN', 'ANALYSIS', 'ACTION', 'VERIFICATION', 'CLOSED');

-- CreateEnum
CREATE TYPE "NcSource" AS ENUM ('INSPECTION', 'AUDIT', 'CUSTOMER', 'SUPPLIER', 'OTHER');

-- CreateEnum
CREATE TYPE "CommKind" AS ENUM ('MEETING', 'CUSTOMER', 'SUPPLIER', 'INTERNAL');

-- CreateEnum
CREATE TYPE "TrainingStatus" AS ENUM ('PLANNED', 'DONE');

-- CreateTable
CREATE TABLE "cost_accounts" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "budget" DECIMAL(14,2) NOT NULL,
    "estimate_to_complete" DECIMAL(14,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cost_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cost_entries" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "entryDate" DATE NOT NULL,
    "description" TEXT NOT NULL,
    "created_by_id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cost_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quality_plans" (
    "project_id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "objectives" TEXT NOT NULL DEFAULT '',
    "procedures" TEXT NOT NULL DEFAULT '',
    "activities" JSONB NOT NULL DEFAULT '[]',
    "version" INTEGER NOT NULL DEFAULT 1,
    "approved_by_id" TEXT,
    "approvedAt" TIMESTAMP(3),
    "updated_by_id" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "quality_plans_pkey" PRIMARY KEY ("project_id")
);

-- CreateTable
CREATE TABLE "nonconformities" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "severity" "NcSeverity" NOT NULL,
    "source" "NcSource" NOT NULL,
    "status" "NcStatus" NOT NULL DEFAULT 'OPEN',
    "phase_id" TEXT,
    "work_package_id" TEXT,
    "detected_by_id" TEXT NOT NULL,
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "containment" TEXT,
    "rootCause" TEXT,
    "correctiveAction" TEXT,
    "preventiveAction" TEXT,
    "action_owner_id" TEXT,
    "actionDueDate" DATE,
    "actionCompletedAt" TIMESTAMP(3),
    "effectivenessNote" TEXT,
    "change_request_id" TEXT,
    "verified_by_id" TEXT,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "nonconformities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "communication_plans" (
    "project_id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "channels" JSONB NOT NULL DEFAULT '[]',
    "notes" TEXT NOT NULL DEFAULT '',
    "version" INTEGER NOT NULL DEFAULT 1,
    "updated_by_id" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "communication_plans_pkey" PRIMARY KEY ("project_id")
);

-- CreateTable
CREATE TABLE "communication_logs" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "kind" "CommKind" NOT NULL,
    "log_date" DATE NOT NULL,
    "subject" TEXT NOT NULL,
    "participants" TEXT NOT NULL DEFAULT '',
    "summary" TEXT NOT NULL,
    "created_by_id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "communication_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trainings" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "dueDate" DATE,
    "status" "TrainingStatus" NOT NULL DEFAULT 'PLANNED',
    "completedAt" TIMESTAMP(3),
    "created_by_id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trainings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "cost_accounts_tenant_id_project_id_idx" ON "cost_accounts"("tenant_id", "project_id");

-- CreateIndex
CREATE UNIQUE INDEX "cost_accounts_project_id_code_key" ON "cost_accounts"("project_id", "code");

-- CreateIndex
CREATE INDEX "cost_entries_tenant_id_project_id_idx" ON "cost_entries"("tenant_id", "project_id");

-- CreateIndex
CREATE INDEX "nonconformities_tenant_id_project_id_status_idx" ON "nonconformities"("tenant_id", "project_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "nonconformities_project_id_code_key" ON "nonconformities"("project_id", "code");

-- CreateIndex
CREATE INDEX "communication_logs_tenant_id_project_id_idx" ON "communication_logs"("tenant_id", "project_id");

-- CreateIndex
CREATE INDEX "trainings_tenant_id_project_id_idx" ON "trainings"("tenant_id", "project_id");

-- AddForeignKey
ALTER TABLE "cost_entries" ADD CONSTRAINT "cost_entries_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "cost_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
