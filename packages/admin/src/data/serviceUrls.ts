// Single source of truth for every service origin this admin app talks to.
//
// The values are injected at build time by vite.config.ts from the repo-root
// `.env` — the same file the services themselves read — so a port is changed in
// exactly one place. Nothing here is hardcoded; import from this module rather
// than writing a literal origin in a component.
//
// Note: the API gateway does NOT proxy the queue/cache introspection routes,
// so those calls go straight to ms-order.

export const GATEWAY_URL = import.meta.env.VITE_GATEWAY_URL
export const ADMIN_URL = import.meta.env.VITE_ADMIN_URL
export const CLIENT_URL = import.meta.env.VITE_CLIENT_URL
export const USER_SERVICE_URL = import.meta.env.VITE_USER_SERVICE_URL
export const PRODUCT_SERVICE_URL = import.meta.env.VITE_PRODUCT_SERVICE_URL
export const ORDER_SERVICE_URL = import.meta.env.VITE_ORDER_SERVICE_URL

/** Object storage (RustFS / S3-compatible) — API endpoint and web console. */
export const RUSTFS_ENDPOINT = import.meta.env.VITE_RUSTFS_ENDPOINT
export const RUSTFS_CONSOLE_ENDPOINT = import.meta.env.VITE_RUSTFS_CONSOLE_ENDPOINT
export const RUSTFS_BUCKET = import.meta.env.VITE_RUSTFS_BUCKET

/** Host dir backing the RustFS bind mount. Owned by the infra-hub repo. */
export const RUSTFS_DATA_PATH = import.meta.env.VITE_RUSTFS_DATA_PATH
export const RUSTFS_BUCKET_URL = `${RUSTFS_ENDPOINT}/${RUSTFS_BUCKET}`

/** Primary relational database, shown read-only in the Persistence panel. */
export const DB_HOST = import.meta.env.VITE_DB_HOST
export const DB_PORT = import.meta.env.VITE_DB_PORT

/** Port-only views, for panels that display a port rather than an origin. */
export const ADMIN_PORT = new URL(ADMIN_URL).port
export const GATEWAY_PORT = new URL(GATEWAY_URL).port
export const CLIENT_PORT = new URL(CLIENT_URL).port
export const USER_SERVICE_PORT = new URL(USER_SERVICE_URL).port
export const PRODUCT_SERVICE_PORT = new URL(PRODUCT_SERVICE_URL).port
export const ORDER_SERVICE_PORT = new URL(ORDER_SERVICE_URL).port

/** Host:port for the order service, for use in operator-facing error text. */
export const ORDER_SERVICE_AUTHORITY = new URL(ORDER_SERVICE_URL).host
