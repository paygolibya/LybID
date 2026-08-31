-- Phase 5 RLS — usage_records.
--
-- Mirrors the standard tenant-owned-table RLS pattern exactly (see
-- 20260829161059_applicants_documents_rls) — admin FOR ALL, tenant explicit
-- INSERT/SELECT/UPDATE (not a single FOR ALL, which would also grant
-- DELETE — retention/deletion is an explicit Phase 8 decision). App code
-- only ever INSERTs usage_records (an append-only ledger, written by the
-- worker on the tenant's behalf when a Document/BusinessDocument finishes
-- processing) — tenant UPDATE is included anyway for consistency with
-- every prior tenant-owned table's RLS, same posture document_extractions'
-- RLS already took.

ALTER TABLE usage_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_records FORCE ROW LEVEL SECURITY;

CREATE POLICY usage_records_admin_all ON usage_records
  USING (current_setting('app.is_admin', true) = 'true')
  WITH CHECK (current_setting('app.is_admin', true) = 'true');

CREATE POLICY usage_records_tenant_insert ON usage_records
  FOR INSERT
  WITH CHECK ("tenantId"::text = current_setting('app.tenant_id', true));

CREATE POLICY usage_records_tenant_select ON usage_records
  FOR SELECT
  USING ("tenantId"::text = current_setting('app.tenant_id', true));

CREATE POLICY usage_records_tenant_update ON usage_records
  FOR UPDATE
  USING ("tenantId"::text = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId"::text = current_setting('app.tenant_id', true));

-- Grant the new table to the runtime role (Phase 0's rls_setup migration
-- granted ALL PRIVILEGES ON ALL TABLES + set a default-privileges rule for
-- future tables, so this GRANT is redundant in practice, but explicit here
-- in case the default-privileges rule is ever narrowed).
GRANT SELECT, INSERT, UPDATE, DELETE ON usage_records TO lybid_app;
