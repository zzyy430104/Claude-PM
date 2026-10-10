-- CreateEnum
CREATE TYPE "GateStatus" AS ENUM ('OPEN', 'DECIDED');

-- CreateEnum
CREATE TYPE "GateDecision" AS ENUM ('APPROVED', 'CONDITIONAL', 'REJECTED');

-- CreateEnum
CREATE TYPE "IssueKind" AS ENUM ('ISSUE', 'ACTION');

-- CreateEnum
CREATE TYPE "IssueStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "ChangeType" AS ENUM ('SCOPE', 'SCHEDULE', 'BUDGET', 'DELIVERY_DATE', 'TECHNICAL', 'OTHER');

-- CreateEnum
CREATE TYPE "ChangeStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'IMPLEMENTED', 'VERIFIED', 'CLOSED');

-- CreateEnum
CREATE TYPE "RiskKind" AS ENUM ('RISK', 'OPPORTUNITY');

-- CreateEnum
CREATE TYPE "RiskStatus" AS ENUM ('OPEN', 'MITIGATING', 'OCCURRED', 'CLOSED');

-- CreateTable
CREATE TABLE "gate_reviews" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "phase_id" TEXT NOT NULL,
    "status" "GateStatus" NOT NULL DEFAULT 'OPEN',
    "decision" "GateDecision",
    "checklistResults" JSONB NOT NULL DEFAULT '[]',
    "attendees" JSONB NOT NULL DEFAULT '[]',
    "notes" TEXT,
    "decisionNote" TEXT,
    "decided_by_id" TEXT,
    "decidedAt" TIMESTAMP(3),
    "override_authorized_by_id" TEXT,
    "overrideReason" TEXT,
    "escalated" BOOLEAN NOT NULL DEFAULT false,
    "created_by_id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gate_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_reviews" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "reviewDate" DATE NOT NULL,
    "attendees" JSONB NOT NULL DEFAULT '[]',
    "performance" JSONB NOT NULL,
    "notes" TEXT,
    "escalations" TEXT,
    "reported_to_id" TEXT,
    "reportedAt" TIMESTAMP(3),
    "created_by_id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "issues" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "kind" "IssueKind" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" "IssueStatus" NOT NULL DEFAULT 'OPEN',
    "owner_id" TEXT,
    "dueDate" DATE,
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "gate_review_id" TEXT,
    "project_review_id" TEXT,
    "risk_id" TEXT,
    "phase_id" TEXT,
    "closedAt" TIMESTAMP(3),
    "closed_by_id" TEXT,
    "closureNote" TEXT,
    "created_by_id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "issues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "change_requests" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "type" "ChangeType" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "triggeredByFailure" BOOLEAN NOT NULL DEFAULT false,
    "causeAnalysis" TEXT,
    "impactAnalysis" TEXT,
    "verificationPlan" TEXT,
    "technicalImpact" JSONB,
    "proposed" JSONB,
    "customerNotifiedAt" TIMESTAMP(3),
    "customerAgreedAt" TIMESTAMP(3),
    "status" "ChangeStatus" NOT NULL DEFAULT 'DRAFT',
    "requested_by_id" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3),
    "decided_by_id" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "implemented_by_id" TEXT,
    "implementedAt" TIMESTAMP(3),
    "verified_by_id" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "effectivenessNote" TEXT,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "change_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "risks" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "kind" "RiskKind" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "probability" INTEGER NOT NULL,
    "impact" INTEGER NOT NULL,
    "exposure_amount" DECIMAL(14,2) NOT NULL,
    "response_cost" DECIMAL(14,2) NOT NULL,
    "cost_benefit_analysis" TEXT NOT NULL,
    "owner_id" TEXT,
    "status" "RiskStatus" NOT NULL DEFAULT 'OPEN',
    "closureNote" TEXT,
    "lastReviewedAt" TIMESTAMP(3),
    "created_by_id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "risks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "gate_reviews_tenant_id_project_id_idx" ON "gate_reviews"("tenant_id", "project_id");

-- CreateIndex
CREATE INDEX "gate_reviews_phase_id_idx" ON "gate_reviews"("phase_id");

-- CreateIndex
CREATE INDEX "project_reviews_tenant_id_project_id_idx" ON "project_reviews"("tenant_id", "project_id");

-- CreateIndex
CREATE INDEX "issues_tenant_id_project_id_status_idx" ON "issues"("tenant_id", "project_id", "status");

-- CreateIndex
CREATE INDEX "change_requests_tenant_id_project_id_idx" ON "change_requests"("tenant_id", "project_id");

-- CreateIndex
CREATE UNIQUE INDEX "change_requests_project_id_code_key" ON "change_requests"("project_id", "code");

-- CreateIndex
CREATE INDEX "risks_tenant_id_project_id_idx" ON "risks"("tenant_id", "project_id");
