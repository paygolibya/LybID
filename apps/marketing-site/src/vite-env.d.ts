/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_ADMIN_DASHBOARD_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
