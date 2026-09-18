import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// Service origins come from the repo-root .env — the same file the services
// themselves read — so a port is defined in exactly one place.
//
// Vite only exposes VITE_-prefixed vars to client code, and .env deliberately
// uses unprefixed names shared with the backend. So we read them here and
// re-expose just the handful the admin needs as VITE_-prefixed entries.
const ROOT_ENV_DIR = path.resolve(__dirname, '../..')

export default defineConfig(({ mode }) => {
  // '' = load every var regardless of prefix, not just VITE_.
  const env = loadEnv(mode, ROOT_ENV_DIR, '')

  // `loadEnv` with an empty prefix also copies the file's NODE_ENV into
  // process.env.VITE_USER_NODE_ENV, which is the flag Vite uses to pick React's
  // build. The root .env says NODE_ENV=development for the backend services, so
  // leaving it set ships the development build of React (2.4x bundle size).
  // That value is not meant for this bundle — drop it and let `mode` decide.
  delete process.env.VITE_USER_NODE_ENV

  // Fall back to the committed .env.example values so a fresh clone with no
  // .env still builds and points at the documented ports.
  const port = (name: string, fallback: string) => env[name] || fallback
  const host = env.ADMIN_BIND_HOST || 'localhost'
  const origin = (name: string, fallback: string) => `http://${host}:${port(name, fallback)}`

  const adminPort = Number(port('ADMIN_PORT', '5461'))

  // Injected into import.meta.env for src/data/serviceUrls.ts to read.
  Object.assign(process.env, {
    VITE_GATEWAY_URL: origin('API_GATEWAY_PORT', '5460'),
    VITE_ADMIN_URL: origin('ADMIN_PORT', '5461'),
    VITE_CLIENT_URL: origin('CLIENT_PORT', '5462'),
    VITE_USER_SERVICE_URL: origin('USER_SERVICE_PORT', '5463'),
    VITE_PRODUCT_SERVICE_URL: origin('PRODUCT_SERVICE_PORT', '5464'),
    VITE_ORDER_SERVICE_URL: origin('ORDER_SERVICE_PORT', '5465'),
    VITE_RUSTFS_ENDPOINT: env.RUSTFS_ENDPOINT || 'http://localhost:9000',
    VITE_RUSTFS_CONSOLE_ENDPOINT: env.RUSTFS_CONSOLE_ENDPOINT || 'http://localhost:9001',
    VITE_RUSTFS_BUCKET: env.RUSTFS_BUCKET || 'ecommerce-uploads',
    VITE_RUSTFS_DATA_PATH: env.RUSTFS_DATA_PATH || 'C:\\Hub\\RustFS',
    VITE_DB_HOST: env.DB_HOST || 'localhost',
    VITE_DB_PORT: env.DB_PORT || '5432',
  })

  return {
    plugins: [react()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    server: {
      port: adminPort,
      host: true,
    },
    preview: {
      port: adminPort,
      host: true,
    },
  }
})
