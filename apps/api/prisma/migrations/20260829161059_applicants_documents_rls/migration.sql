-- Phase 1 RLS — applicants, documents, document_extractions.
--
-- Unlike Phase 0's api_keys/tenants (tenant-mode is read-only there —
-- only admins issue/revoke keys or create tenants), these three tables are
-- created and updated BY the tenant itself via its own API key. So tenant
-- mode needs explicit INSERT/SELECT/UPDATE policies, not just SELECT — and
-- deliberately NOT a single FOR ALL, since that would also grant DELETE,
-- which isn't in scope (retention/deletion is an explicit Phase 8 decision).
-- Admin keeps FOR ALL (including DELETE, for ops/support).

-- applicants
ALTER TABLE applicants ENABLE ROW LEVEL SECURITY;
ALTER TABLE applicants FORCE ROW LEVEL SECURITY;

CREATE POLICY applicants_admin_all ON applicants
  USING (current_setting('app.is_admin', true) = 'true')
  WITH CHECK (current_setting('app.is_admin', true) = 'true');

CREATE POLICY applicants_tenant_insert ON applicants
  FOR INSERT
  WITH CHECK ("tenantId"::text = current_setting('app.tenant_id', true));

CREATE POLICY applicants_tenant_select ON applicants
  FOR SELECT
  USING ("tenantId"::text = current_setting('app.tenant_id', true));

CREATE POLICY applicants_tenant_update ON applicants
  FOR UPDATE
  USING ("tenantId"::text = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId"::text = current_setting('app.tenant_id', true));

-- documents
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents FORCE ROW LEVEL SECURITY;

CREATE POLICY documents_admin_all ON documents
  USING (current_setting('app.is_admin', true) = 'true')
  WITH CHECK (current_setting('app.is_admin', true) = 'true');

CREATE POLICY documents_tenant_insert ON documents
  FOR INSERT
  WITH CHECK ("tenantId"::text = current_setting('app.tenant_id', true));

CREATE POLICY documents_tenant_select ON documents
  FOR SELECT
  USING ("tenantId"::text = current_setting('app.tenant_id', true));

CREATE POLICY documents_tenant_update ON documents
  FOR UPDATE
  USING ("tenantId"::text = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId"::text = current_setting('app.tenant_id', true));

-- document_extractions
ALTER TABLE document_extractions ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_extractions FORCE ROW LEVEL SECURITY;

CREATE POLICY document_extractions_admin_all ON document_extractions
  USING (current_setting('app.is_admin', true) = 'true')
  WITH CHECK (current_setting('app.is_admin', true) = 'true');

CREATE POLICY document_extractions_tenant_insert ON document_extractions
  FOR INSERT
  WITH CHECK ("tenantId"::text = current_setting('app.tenant_id', true));

CREATE POLICY document_extractions_tenant_select ON document_extractions
  FOR SELECT
  USING ("tenantId"::text = current_setting('app.tenant_id', true));

CREATE POLICY document_extractions_tenant_update ON document_extractions
  FOR UPDATE
  USING ("tenantId"::text = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId"::text = current_setting('app.tenant_id', true));

-- Grant the new tables to the runtime role (Phase 0's rls_setup migration
-- granted ALL PRIVILEGES ON ALL TABLES + set a default-privileges rule for
-- future tables, so this GRANT is redundant in practice, but explicit here
-- in case the default-privileges rule is ever narrowed).
GRANT SELECT, INSERT, UPDATE, DELETE ON applicants, documents, document_extractions TO lybid_app;
