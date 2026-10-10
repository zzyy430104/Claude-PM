-- 行级安全（第二道租户隔离）：数据库只放行与会话变量 app.tenant_id 一致的行。
-- app.bypass_rls = 'on' 仅用于登录、注册、平台管理员操作等没有租户上下文的场景；
-- 两个变量都没设置时一行也看不到（默认拒绝）。
-- 表所有者也受约束（FORCE）；超级用户和 BYPASSRLS 角色不受约束，生产环境必须用普通角色连接。

ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON audit_logs
  USING (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE baselines ENABLE ROW LEVEL SECURITY;
ALTER TABLE baselines FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON baselines
  USING (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE change_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE change_requests FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON change_requests
  USING (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE communication_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE communication_logs FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON communication_logs
  USING (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE communication_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE communication_plans FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON communication_plans
  USING (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE config_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE config_items FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON config_items
  USING (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE cost_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE cost_accounts FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON cost_accounts
  USING (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE cost_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE cost_entries FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON cost_entries
  USING (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE deliverables ENABLE ROW LEVEL SECURITY;
ALTER TABLE deliverables FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON deliverables
  USING (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE document_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_versions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON document_versions
  USING (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON documents
  USING (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE gate_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE gate_reviews FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON gate_reviews
  USING (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE issues ENABLE ROW LEVEL SECURITY;
ALTER TABLE issues FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON issues
  USING (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE lessons ENABLE ROW LEVEL SECURITY;
ALTER TABLE lessons FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON lessons
  USING (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE nonconformities ENABLE ROW LEVEL SECURITY;
ALTER TABLE nonconformities FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON nonconformities
  USING (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON notifications
  USING (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE phase_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE phase_templates FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON phase_templates
  USING (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE phases ENABLE ROW LEVEL SECURITY;
ALTER TABLE phases FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON phases
  USING (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE project_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_members FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON project_members
  USING (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE project_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_plans FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON project_plans
  USING (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE project_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_reviews FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON project_reviews
  USING (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON projects
  USING (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE quality_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE quality_plans FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON quality_plans
  USING (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE risks ENABLE ROW LEVEL SECURITY;
ALTER TABLE risks FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON risks
  USING (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE tenders ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenders FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tenders
  USING (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE trainings ENABLE ROW LEVEL SECURITY;
ALTER TABLE trainings FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON trainings
  USING (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON users
  USING (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE work_packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_packages FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON work_packages
  USING (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE wp_dependencies ENABLE ROW LEVEL SECURITY;
ALTER TABLE wp_dependencies FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON wp_dependencies
  USING (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = current_setting('app.tenant_id', true));
