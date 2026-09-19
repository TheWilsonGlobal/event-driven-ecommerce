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
  readonly VITE_RUSTFS_DATA_PATH: string
  readonly VITE_PROMETHEUS_URL: string
  readonly VITE_ELASTICSEARCH_HOST: string
  readonly VITE_ELASTICSEARCH_ENABLED: string
  readonly VITE_LOKI_HOST: string
  readonly VITE_LOKI_ENABLED: string
  readonly VITE_GRAFANA_URL: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
