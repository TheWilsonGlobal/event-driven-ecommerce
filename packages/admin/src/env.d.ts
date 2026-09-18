/// <reference types="vite/client" />

// Service origins injected by vite.config.ts from the repo-root .env.
interface ImportMetaEnv {
  readonly VITE_GATEWAY_URL: string
  readonly VITE_ADMIN_URL: string
  readonly VITE_CLIENT_URL: string
  readonly VITE_USER_SERVICE_URL: string
  readonly VITE_PRODUCT_SERVICE_URL: string
  readonly VITE_ORDER_SERVICE_URL: string
  readonly VITE_RUSTFS_ENDPOINT: string
  readonly VITE_RUSTFS_CONSOLE_ENDPOINT: string
  readonly VITE_RUSTFS_BUCKET: string
  readonly VITE_DB_HOST: string
  readonly VITE_DB_PORT: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
