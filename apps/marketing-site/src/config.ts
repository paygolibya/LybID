// Build-time origin for @lybid/admin-dashboard — same pattern as that
// app's own VITE_API_BASE_URL (see its api-client.ts): this marketing
// site is deployed alongside one specific self-hosted LybID instance, so
// it's a build-time env var, not something resolved at runtime.
export const ADMIN_DASHBOARD_URL =
  (import.meta.env.VITE_ADMIN_DASHBOARD_URL as string | undefined) ?? 'http://localhost:5174';

export const ADMIN_DASHBOARD_LOGIN_URL = `${ADMIN_DASHBOARD_URL}/login`;
