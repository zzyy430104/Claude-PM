-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "ai_config" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "ai_key_enc" TEXT;

-- CreateTable
CREATE TABLE "ai_usages" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "project_id" TEXT,
    "scenario" TEXT NOT NULL,
    "model" TEXT NOT NULL DEFAULT '',
    "input_chars" INTEGER NOT NULL DEFAULT 0,
    "prompt_tokens" INTEGER NOT NULL DEFAULT 0,
    "completion_tokens" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'OK',
    "error" TEXT,
    "output" JSONB,
    "adopted" BOOLEAN,
    "adopted_at" TIMESTAMP(3),
    "entity_type" TEXT,
    "entity_id" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_usages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_usages_tenant_id_createdAt_idx" ON "ai_usages"("tenant_id", "createdAt");

-- CreateIndex
CREATE INDEX "ai_usages_tenant_id_entity_type_entity_id_idx" ON "ai_usages"("tenant_id", "entity_type", "entity_id");


ALTER TABLE ai_usages ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_usages FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON ai_usages
  USING (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true));
