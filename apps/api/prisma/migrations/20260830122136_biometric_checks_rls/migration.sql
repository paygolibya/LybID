-- Phase 2 RLS — biometric_checks.
--
-- Mirrors applicants/documents exactly: tenants create these rows via their
-- own API key (not admin-only, unlike Phase 0's api_keys/tenants), so
-- explicit tenant INSERT/SELECT/UPDATE policies, not FOR ALL — DELETE isn't
-- in scope. Admin keeps FOR ALL.

ALTER TABLE biometric_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE biometric_checks FORCE ROW LEVEL SECURITY;

CREATE POLICY biometric_checks_admin_all ON biometric_checks
  USING (current_setting('app.is_admin', true) = 'true')
  WITH CHECK (current_setting('app.is_admin', true) = 'true');

CREATE POLICY biometric_checks_tenant_insert ON biometric_checks
  FOR INSERT
  WITH CHECK ("tenantId"::text = current_setting('app.tenant_id', true));

CREATE POLICY biometric_checks_tenant_select ON biometric_checks
  FOR SELECT
  USING ("tenantId"::text = current_setting('app.tenant_id', true));

CREATE POLICY biometric_checks_tenant_update ON biometric_checks
  FOR UPDATE
  USING ("tenantId"::text = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId"::text = current_setting('app.tenant_id', true));

GRANT SELECT, INSERT, UPDATE, DELETE ON biometric_checks TO lybid_app;
