// Single source of truth for every service origin this admin app talks to.
//
// The values are injected at build time by vite.config.ts from the repo-root
// `.env` — the same file the services themselves read — so a port is changed in
// exactly one place. Nothing here is hardcoded; import from this module rather
// than writing a literal origin in a component.
//
// Note: the API gateway does NOT proxy the queue/cache introspection routes,
// so those calls go straight to the owning service — ms-order for both queues
// and cache, ms-product for its own queues only (it has no cache endpoints).

export const GATEWAY_URL = import.meta.env.VITE_GATEWAY_URL
export const ADMIN_URL = import.meta.env.VITE_ADMIN_URL
export const CLIENT_URL = import.meta.env.VITE_CLIENT_URL
export const USER_SERVICE_URL = import.meta.env.VITE_USER_SERVICE_URL
export const PRODUCT_SERVICE_URL = import.meta.env.VITE_PRODUCT_SERVICE_URL
export const ORDER_SERVICE_URL = import.meta.env.VITE_ORDER_SERVICE_URL
/** Event-backbone consumers. Both serve their own /api/v1/events. */
export const INVENTORY_SERVICE_URL = import.meta.env.VITE_INVENTORY_SERVICE_URL
export const ANALYTICS_SERVICE_URL = import.meta.env.VITE_ANALYTICS_SERVICE_URL

/** Object storage (RustFS / S3-compatible) — API endpoint and web console. */
export const RUSTFS_ENDPOINT = import.meta.env.VITE_RUSTFS_ENDPOINT
export const RUSTFS_CONSOLE_ENDPOINT = import.meta.env.VITE_RUSTFS_CONSOLE_ENDPOINT
export const RUSTFS_BUCKET = import.meta.env.VITE_RUSTFS_BUCKET

/** Host dir backing the RustFS bind mount. Owned by the infra-hub repo. */
export const RUSTFS_DATA_PATH = import.meta.env.VITE_RUSTFS_DATA_PATH
export const RUSTFS_BUCKET_URL = `${RUSTFS_ENDPOINT}/${RUSTFS_BUCKET}`

/**
 * Observability backends. None of these run in this repo's own
 * docker-compose — Prometheus/Loki/Grafana are provisioned by the
 * infra-hub repo, Elasticsearch is optional (search falls back to an
 * in-memory scan in ms-product when it's unreachable). Every service
 * still exposes real endpoints for these regardless of whether the
 * backend itself is currently running, so cards can probe honestly.
 */
export const PROMETHEUS_URL = import.meta.env.VITE_PROMETHEUS_URL
export const ELASTICSEARCH_HOST = import.meta.env.VITE_ELASTICSEARCH_HOST
export const ELASTICSEARCH_ENABLED = import.meta.env.VITE_ELASTICSEARCH_ENABLED === 'true'
export const LOKI_HOST = import.meta.env.VITE_LOKI_HOST
export const LOKI_ENABLED = import.meta.env.VITE_LOKI_ENABLED === 'true'
/** Dashboards for the three backends above. Owned by infra-hub (host 3005 by default). */
export const GRAFANA_URL = import.meta.env.VITE_GRAFANA_URL

/**
 * Kafka event backbone. The broker is owned by infra-hub (profile `kafka`) and
 * is OPTIONAL — `KAFKA_ENABLED=false` is the repo default. When disabled the
 * services answer /api/v1/events with 200 + `enabled:false`, which the admin
 * must render as a configured state, never as an outage.
 */
export const KAFKA_ENABLED = import.meta.env.VITE_KAFKA_ENABLED === 'true'
export const KAFKA_BROKERS = import.meta.env.VITE_KAFKA_BROKERS
/** Redpanda Console — 9102 (infra-hub's 910x block), not 8080/8090. */
export const REDPANDA_CONSOLE_URL = import.meta.env.VITE_REDPANDA_CONSOLE_URL

/** Port-only views, for panels that display a port rather than an origin. */
export const ADMIN_PORT = new URL(ADMIN_URL).port
export const GATEWAY_PORT = new URL(GATEWAY_URL).port
export const CLIENT_PORT = new URL(CLIENT_URL).port
export const USER_SERVICE_PORT = new URL(USER_SERVICE_URL).port
export const PRODUCT_SERVICE_PORT = new URL(PRODUCT_SERVICE_URL).port
export const ORDER_SERVICE_PORT = new URL(ORDER_SERVICE_URL).port
export const INVENTORY_SERVICE_PORT = new URL(INVENTORY_SERVICE_URL).port
export const ANALYTICS_SERVICE_PORT = new URL(ANALYTICS_SERVICE_URL).port
export const RUSTFS_PORT = new URL(RUSTFS_ENDPOINT).port
export const RUSTFS_CONSOLE_PORT = new URL(RUSTFS_CONSOLE_ENDPOINT).port

/** Host:port for the order/product services, for use in operator-facing error text. */
export const ORDER_SERVICE_AUTHORITY = new URL(ORDER_SERVICE_URL).host
export const INVENTORY_SERVICE_AUTHORITY = new URL(INVENTORY_SERVICE_URL).host
export const ANALYTICS_SERVICE_AUTHORITY = new URL(ANALYTICS_SERVICE_URL).host
export const PRODUCT_SERVICE_AUTHORITY = new URL(PRODUCT_SERVICE_URL).host
