-- Phase 4 RLS — applicant_decisions, business_decisions.
--
-- Mirrors the applicants/documents RLS migration exactly
-- (20260829161059_applicants_documents_rls) — these tables are created by
-- the tenant itself via its own API key, so tenant mode needs explicit
-- INSERT/SELECT/UPDATE policies, not just SELECT — and deliberately NOT a
-- single FOR ALL, since that would also grant DELETE, which isn't in scope
-- (retention/deletion is an explicit Phase 8 decision). Admin keeps FOR ALL
-- (including DELETE, for ops/support). Tenant UPDATE is included for
-- consistency with every prior tenant-owned table's RLS, even though the
-- app code only ever INSERTs decision rows (append-only history) — same
-- posture document_extractions' RLS already took.

-- applicant_decisions
ALTER TABLE applicant_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE applicant_decisions FORCE ROW LEVEL SECURITY;

CREATE POLICY applicant_decisions_admin_all ON applicant_decisions
  USING (current_setting('app.is_admin', true) = 'true')
  WITH CHECK (current_setting('app.is_admin', true) = 'true');

CREATE POLICY applicant_decisions_tenant_insert ON applicant_decisions
  FOR INSERT
  WITH CHECK ("tenantId"::text = current_setting('app.tenant_id', true));

CREATE POLICY applicant_decisions_tenant_select ON applicant_decisions
  FOR SELECT
  USING ("tenantId"::text = current_setting('app.tenant_id', true));

CREATE POLICY applicant_decisions_tenant_update ON applicant_decisions
  FOR UPDATE
  USING ("tenantId"::text = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId"::text = current_setting('app.tenant_id', true));

-- business_decisions
ALTER TABLE business_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE business_decisions FORCE ROW LEVEL SECURITY;

CREATE POLICY business_decisions_admin_all ON business_decisions
  USING (current_setting('app.is_admin', true) = 'true')
  WITH CHECK (current_setting('app.is_admin', true) = 'true');

CREATE POLICY business_decisions_tenant_insert ON business_decisions
  FOR INSERT
  WITH CHECK ("tenantId"::text = current_setting('app.tenant_id', true));

CREATE POLICY business_decisions_tenant_select ON business_decisions
  FOR SELECT
  USING ("tenantId"::text = current_setting('app.tenant_id', true));

CREATE POLICY business_decisions_tenant_update ON business_decisions
  FOR UPDATE
  USING ("tenantId"::text = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId"::text = current_setting('app.tenant_id', true));

-- Grant the new tables to the runtime role (Phase 0's rls_setup migration
-- granted ALL PRIVILEGES ON ALL TABLES + set a default-privileges rule for
-- future tables, so this GRANT is redundant in practice, but explicit here
-- in case the default-privileges rule is ever narrowed).
GRANT SELECT, INSERT, UPDATE, DELETE ON applicant_decisions, business_decisions TO lybid_app;
