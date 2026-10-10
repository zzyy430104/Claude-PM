-- CreateEnum
CREATE TYPE "CommentEntity" AS ENUM ('WORK_PACKAGE', 'RISK', 'CHANGE', 'NONCONFORMITY', 'DELIVERABLE');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "email_prefs" JSONB NOT NULL DEFAULT '{}';

-- CreateTable
CREATE TABLE "comments" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "entity_type" "CommentEntity" NOT NULL,
    "entity_id" TEXT NOT NULL,
    "author_id" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "mentions" JSONB NOT NULL DEFAULT '[]',
    "deleted_at" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "comments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "comments_tenant_id_project_id_entity_type_entity_id_idx" ON "comments"("tenant_id", "project_id", "entity_type", "entity_id");


ALTER TABLE comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE comments FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON comments
  USING (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true));
