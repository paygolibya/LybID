-- Phase 0 RLS setup — see the "Multi-tenancy" section of the Phase 0 plan.
--
-- 1. Runtime role. The app connects as this (RUNTIME_DATABASE_URL), never as
--    the owner (DATABASE_URL) — Postgres exempts table owners from RLS by
--    default, so a non-owner role is required for the policies below to
--    actually apply.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'lybid_app') THEN
    CREATE ROLE lybid_app WITH LOGIN PASSWORD 'lybid_app_dev_password';
  END IF;
END
$$;

GRANT CONNECT ON DATABASE lybid TO lybid_app;
GRANT USAGE ON SCHEMA public TO lybid_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO lybid_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO lybid_app;

-- 2. tenants
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants FORCE ROW LEVEL SECURITY;

CREATE POLICY tenants_admin_all ON tenants
  USING (current_setting('app.is_admin', true) = 'true')
  WITH CHECK (current_setting('app.is_admin', true) = 'true');

CREATE POLICY tenants_tenant_self_select ON tenants
  FOR SELECT
  USING (id::text = current_setting('app.tenant_id', true));

CREATE POLICY tenants_auth_bootstrap_select ON tenants
  FOR SELECT
  USING (current_setting('app.auth_bootstrap', true) = 'true');

-- 3. api_keys
ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_keys FORCE ROW LEVEL SECURITY;

CREATE POLICY api_keys_admin_all ON api_keys
  USING (current_setting('app.is_admin', true) = 'true')
  WITH CHECK (current_setting('app.is_admin', true) = 'true');

CREATE POLICY api_keys_tenant_select ON api_keys
  FOR SELECT
  USING ("tenantId"::text = current_setting('app.tenant_id', true));

CREATE POLICY api_keys_auth_bootstrap_select ON api_keys
  FOR SELECT
  USING (current_setting('app.auth_bootstrap', true) = 'true');

-- platform_admin_users and audit_logs intentionally have NO RLS — neither is
-- tenant-scoped (see Phase 0 plan: "every tenant-scoped table"). They're
-- protected by role-level GRANTs only.
