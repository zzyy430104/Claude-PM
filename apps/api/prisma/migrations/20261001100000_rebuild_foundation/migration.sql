-- 投标管理整体删除：投标是独立的销售流程，不在本系统内
DROP TABLE IF EXISTS "tenders";
DROP TYPE IF EXISTS "TenderStatus";
ALTER TABLE "projects" DROP COLUMN IF EXISTS "tender_id";
DELETE FROM "notifications" WHERE "kind" IN ('TENDER_SUBMITTED', 'TENDER_DECIDED');

-- 系统名称（品牌）
ALTER TABLE "tenants" ADD COLUMN "system_name" TEXT NOT NULL DEFAULT 'Claude-PM';

-- 职能角色字典
ALTER TABLE "users" ADD COLUMN "functional_role_id" TEXT;

CREATE TABLE "functional_roles" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "functional_roles_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "functional_roles_tenant_id_name_key" ON "functional_roles"("tenant_id", "name");
CREATE INDEX "functional_roles_tenant_id_idx" ON "functional_roles"("tenant_id");

-- 已有企业补上默认角色
INSERT INTO "functional_roles" ("id", "tenant_id", "name", "sort_order")
SELECT gen_random_uuid()::text, t."id", r.name, r.ord
FROM "tenants" t
CROSS JOIN (VALUES ('项目经理', 1), ('技术', 2), ('设计', 3), ('工艺', 4), ('质量', 5), ('生产', 6), ('采购', 7), ('计划', 8), ('物流', 9), ('仓库', 10), ('售后', 11)) AS r(name, ord);

ALTER TABLE functional_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE functional_roles FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON functional_roles
  USING (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true));

