-- CreateEnum
CREATE TYPE "LessonKind" AS ENUM ('GOOD_PRACTICE', 'LESSON');

-- CreateEnum
CREATE TYPE "ConfigKind" AS ENUM ('HARDWARE', 'SOFTWARE', 'DOCUMENT', 'TOOL');

-- CreateEnum
CREATE TYPE "BaselineType" AS ENUM ('AS_DESIGNED', 'AS_BUILT', 'AS_MAINTAINED');

-- CreateEnum
CREATE TYPE "TenderStatus" AS ENUM ('DRAFT', 'IN_REVIEW', 'APPROVED', 'REJECTED', 'WON', 'LOST');

-- AlterTable
ALTER TABLE "projects" ADD COLUMN     "tender_id" TEXT;

-- CreateTable
CREATE TABLE "documents" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "folder" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "current_version" INTEGER NOT NULL DEFAULT 1,
    "created_by_id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_versions" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "file_name" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "storage_path" TEXT NOT NULL,
    "comment" TEXT,
    "uploaded_by_id" TEXT NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lessons" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "kind" "LessonKind" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "recommendation" TEXT NOT NULL,
    "phase_id" TEXT,
    "created_by_id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lessons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "config_items" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "parent_id" TEXT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "ConfigKind" NOT NULL,
    "safety_related" BOOLEAN NOT NULL DEFAULT false,
    "lowest_level" BOOLEAN NOT NULL DEFAULT false,
    "revision" TEXT NOT NULL DEFAULT 'A',
    "serial_number" TEXT,
    "batch_number" TEXT,
    "obsolete" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "config_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "baselines" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "type" "BaselineType" NOT NULL,
    "name" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "created_by_id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "baselines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenders" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "customer" TEXT NOT NULL,
    "status" "TenderStatus" NOT NULL DEFAULT 'DRAFT',
    "requirements" TEXT NOT NULL DEFAULT '',
    "riskAssessment" TEXT NOT NULL DEFAULT '',
    "risk_exposure" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "knowledgeInputs" TEXT NOT NULL DEFAULT '',
    "deliverablesPlan" TEXT NOT NULL DEFAULT '',
    "estimated_cost" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "offer_price" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "resourcePlan" TEXT NOT NULL DEFAULT '',
    "created_by_id" TEXT NOT NULL,
    "decided_by_id" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "converted_project_id" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "documents_tenant_id_project_id_idx" ON "documents"("tenant_id", "project_id");

-- CreateIndex
CREATE UNIQUE INDEX "documents_project_id_folder_name_key" ON "documents"("project_id", "folder", "name");

-- CreateIndex
CREATE UNIQUE INDEX "document_versions_document_id_version_key" ON "document_versions"("document_id", "version");

-- CreateIndex
CREATE INDEX "lessons_tenant_id_idx" ON "lessons"("tenant_id");

-- CreateIndex
CREATE INDEX "lessons_project_id_idx" ON "lessons"("project_id");

-- CreateIndex
CREATE INDEX "config_items_tenant_id_project_id_idx" ON "config_items"("tenant_id", "project_id");

-- CreateIndex
CREATE UNIQUE INDEX "config_items_project_id_code_key" ON "config_items"("project_id", "code");

-- CreateIndex
CREATE INDEX "baselines_tenant_id_project_id_idx" ON "baselines"("tenant_id", "project_id");

-- CreateIndex
CREATE UNIQUE INDEX "tenders_tenant_id_code_key" ON "tenders"("tenant_id", "code");

-- AddForeignKey
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
