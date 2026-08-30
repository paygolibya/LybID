-- Phase 3 RLS — businesses, business_documents, business_document_extractions.
--
-- Mirrors the applicants/documents/document_extractions RLS migration
-- exactly (20260829161059_applicants_documents_rls) — these three tables
-- are created and updated BY the tenant itself via its own API key, so
-- tenant mode needs explicit INSERT/SELECT/UPDATE policies, not just
-- SELECT — and deliberately NOT a single FOR ALL, since that would also
-- grant DELETE, which isn't in scope (retention/deletion is an explicit
-- Phase 8 decision). Admin keeps FOR ALL (including DELETE, for
-- ops/support).

-- businesses
ALTER TABLE businesses ENABLE ROW LEVEL SECURITY;
ALTER TABLE businesses FORCE ROW LEVEL SECURITY;

CREATE POLICY businesses_admin_all ON businesses
  USING (current_setting('app.is_admin', true) = 'true')
  WITH CHECK (current_setting('app.is_admin', true) = 'true');

CREATE POLICY businesses_tenant_insert ON businesses
  FOR INSERT
  WITH CHECK ("tenantId"::text = current_setting('app.tenant_id', true));

CREATE POLICY businesses_tenant_select ON businesses
  FOR SELECT
  USING ("tenantId"::text = current_setting('app.tenant_id', true));

CREATE POLICY businesses_tenant_update ON businesses
  FOR UPDATE
  USING ("tenantId"::text = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId"::text = current_setting('app.tenant_id', true));

-- business_documents
ALTER TABLE business_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE business_documents FORCE ROW LEVEL SECURITY;

CREATE POLICY business_documents_admin_all ON business_documents
  USING (current_setting('app.is_admin', true) = 'true')
  WITH CHECK (current_setting('app.is_admin', true) = 'true');

CREATE POLICY business_documents_tenant_insert ON business_documents
  FOR INSERT
  WITH CHECK ("tenantId"::text = current_setting('app.tenant_id', true));

CREATE POLICY business_documents_tenant_select ON business_documents
  FOR SELECT
  USING ("tenantId"::text = current_setting('app.tenant_id', true));

CREATE POLICY business_documents_tenant_update ON business_documents
  FOR UPDATE
  USING ("tenantId"::text = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId"::text = current_setting('app.tenant_id', true));

-- business_document_extractions
ALTER TABLE business_document_extractions ENABLE ROW LEVEL SECURITY;
ALTER TABLE business_document_extractions FORCE ROW LEVEL SECURITY;

CREATE POLICY business_document_extractions_admin_all ON business_document_extractions
  USING (current_setting('app.is_admin', true) = 'true')
  WITH CHECK (current_setting('app.is_admin', true) = 'true');

CREATE POLICY business_document_extractions_tenant_insert ON business_document_extractions
  FOR INSERT
  WITH CHECK ("tenantId"::text = current_setting('app.tenant_id', true));

CREATE POLICY business_document_extractions_tenant_select ON business_document_extractions
  FOR SELECT
  USING ("tenantId"::text = current_setting('app.tenant_id', true));

CREATE POLICY business_document_extractions_tenant_update ON business_document_extractions
  FOR UPDATE
  USING ("tenantId"::text = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId"::text = current_setting('app.tenant_id', true));

-- Grant the new tables to the runtime role (Phase 0's rls_setup migration
-- granted ALL PRIVILEGES ON ALL TABLES + set a default-privileges rule for
-- future tables, so this GRANT is redundant in practice, but explicit here
-- in case the default-privileges rule is ever narrowed).
GRANT SELECT, INSERT, UPDATE, DELETE ON businesses, business_documents, business_document_extractions TO lybid_app;
