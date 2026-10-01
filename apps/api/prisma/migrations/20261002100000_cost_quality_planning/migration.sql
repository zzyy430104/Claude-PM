-- CreateEnum
CREATE TYPE "InspectionResult" AS ENUM ('PENDING', 'PASS', 'FAIL', 'NA');
-- AlterTable
ALTER TABLE "cost_accounts" ADD COLUMN     "is_labor" BOOLEAN NOT NULL DEFAULT false;
-- AlterTable
ALTER TABLE "functional_roles" ADD COLUMN     "rate" DECIMAL(10,2) NOT NULL DEFAULT 0;
-- AlterTable
ALTER TABLE "projects" ADD COLUMN     "cost_alert" TEXT;
-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "inspection_categories" TEXT[] DEFAULT ARRAY['产品', '过程', '文件', '评审', '试验']::TEXT[];
-- AlterTable
ALTER TABLE "work_packages" ADD COLUMN     "cost_alert" TEXT,
ADD COLUMN     "estimate_to_complete" DECIMAL(14,2),
ADD COLUMN     "labor_rate" DECIMAL(10,2),
ADD COLUMN     "labor_rate_reason" TEXT;
-- CreateTable
CREATE TABLE "wp_cost_lines" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "work_package_id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "amount" DECIMAL(14,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "wp_cost_lines_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "cost_commitments" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "work_package_id" TEXT,
    "account_id" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "description" TEXT NOT NULL,
    "entry_date" DATE NOT NULL,
    "created_by_id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "cost_commitments_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "inspection_items" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "work_package_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "requirement" TEXT NOT NULL DEFAULT '',
    "method" TEXT NOT NULL DEFAULT '',
    "record" TEXT NOT NULL DEFAULT '',
    "verifier_id" TEXT,
    "is_key" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "result" "InspectionResult" NOT NULL DEFAULT 'PENDING',
    "first_result" "InspectionResult",
    "record_no" TEXT NOT NULL DEFAULT '',
    "result_note" TEXT NOT NULL DEFAULT '',
    "result_at" TIMESTAMP(3),
    "result_by_id" TEXT,
    "nc_id" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "inspection_items_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "inspection_templates" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "requirement" TEXT NOT NULL DEFAULT '',
    "method" TEXT NOT NULL DEFAULT '',
    "record" TEXT NOT NULL DEFAULT '',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "inspection_templates_pkey" PRIMARY KEY ("id")
);
-- CreateIndex
CREATE INDEX "wp_cost_lines_tenant_id_project_id_idx" ON "wp_cost_lines"("tenant_id", "project_id");
-- CreateIndex
CREATE INDEX "cost_commitments_tenant_id_project_id_idx" ON "cost_commitments"("tenant_id", "project_id");
-- CreateIndex
CREATE INDEX "inspection_items_tenant_id_project_id_idx" ON "inspection_items"("tenant_id", "project_id");
-- CreateIndex
CREATE INDEX "inspection_items_work_package_id_idx" ON "inspection_items"("work_package_id");
-- CreateIndex
CREATE INDEX "inspection_templates_tenant_id_idx" ON "inspection_templates"("tenant_id");
-- CreateIndex
CREATE UNIQUE INDEX "inspection_templates_tenant_id_name_key" ON "inspection_templates"("tenant_id", "name");
-- AddForeignKey
ALTER TABLE "wp_cost_lines" ADD CONSTRAINT "wp_cost_lines_work_package_id_fkey" FOREIGN KEY ("work_package_id") REFERENCES "work_packages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "inspection_items" ADD CONSTRAINT "inspection_items_work_package_id_fkey" FOREIGN KEY ("work_package_id") REFERENCES "work_packages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 职能角色标准费率（元 / 人天）的默认值，企业可在“企业设置”里改
SELECT set_config('app.bypass_rls', 'on', false);
UPDATE functional_roles SET rate = CASE name
  WHEN '项目经理' THEN 1600 WHEN '技术' THEN 1400 WHEN '设计' THEN 1400 WHEN '工艺' THEN 1200 WHEN '质量' THEN 1200
  WHEN '生产' THEN 800 WHEN '采购' THEN 1000 WHEN '计划' THEN 1000 WHEN '物流' THEN 800 WHEN '仓库' THEN 700 WHEN '售后' THEN 900
  ELSE rate END;

-- 企业检验项库：常用检验 / 验证项
INSERT INTO inspection_templates (id, tenant_id, name, category, requirement, method, record)
SELECT gen_random_uuid()::text, t.id, v.name, v.category, v.requirement, v.method, v.record
FROM tenants t CROSS JOIN (VALUES
  ('尺寸检验', '产品', '图纸尺寸及公差', '卡尺 / 三坐标', '检验报告'),
  ('焊缝检验', '产品', 'EN 15085-2 对应等级', 'VT / MT / UT', '焊缝检验报告'),
  ('材质证明审核', '文件', 'EN 10204 3.1', '审核证书', '材质证明'),
  ('特殊过程确认', '过程', '焊接、涂装、粘接工艺评定有效', 'WPS / PQR 审核', '工艺评定记录'),
  ('设计评审', '评审', '输入输出一致，问题已关闭', '评审会', '评审记录'),
  ('型式试验', '试验', '按技术协议试验大纲', '第三方试验', '试验报告'),
  ('供应商首件', '产品', '供方 FAI 合格', '来料检验', '供方 FAI 报告'),
  ('客户确认', '评审', '客户书面确认', '签字确认单', '确认单')
) AS v(name, category, requirement, method, record);
SELECT set_config('app.bypass_rls', '', false);

ALTER TABLE wp_cost_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE wp_cost_lines FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON wp_cost_lines
  USING (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE cost_commitments ENABLE ROW LEVEL SECURITY;
ALTER TABLE cost_commitments FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON cost_commitments
  USING (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE inspection_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE inspection_items FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON inspection_items
  USING (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE inspection_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE inspection_templates FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON inspection_templates
  USING (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true));
