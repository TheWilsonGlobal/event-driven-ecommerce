/// <reference types="vitest/config" />
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
    // Fallbacks moved off 9000/9001 to 6380/6381 on 2026-09-22, matching
    // infra-hub -- which owns the container these values describe.
    VITE_RUSTFS_ENDPOINT: env.RUSTFS_ENDPOINT || 'http://localhost:6380',
    VITE_RUSTFS_CONSOLE_ENDPOINT: env.RUSTFS_CONSOLE_ENDPOINT || 'http://localhost:6381',
    VITE_RUSTFS_BUCKET: env.RUSTFS_BUCKET || 'ecommerce-uploads',
    VITE_RUSTFS_DATA_PATH: env.RUSTFS_DATA_PATH || 'C:\\Hub\\RustFS',
    VITE_PROMETHEUS_URL: `http://${host}:${port('PROMETHEUS_PORT', '9090')}`,
    VITE_ELASTICSEARCH_HOST: env.ELASTICSEARCH_HOST || 'http://localhost:9200',
    VITE_ELASTICSEARCH_ENABLED: String(env.ELASTICSEARCH_ENABLED !== 'false'),
    VITE_LOKI_HOST: env.LOKI_HOST || 'http://localhost:3100',
    VITE_LOKI_ENABLED: String(env.LOKI_ENABLED !== 'false'),
    // Grafana itself is not configured in this repo's own .env — it's owned
    // by the infra-hub repo, whose docker-compose.yml maps host 3005 ->
    // container 3000 by default (GRAFANA_PORT there overrides it). Read
    // from an optional GRAFANA_PORT here too, so setting it in this repo's
    // own .env (to match a customized infra-hub) still works.
    VITE_GRAFANA_URL: `http://${host}:${port('GRAFANA_PORT', '3005')}`,
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
    test: {
      environment: 'jsdom',
      setupFiles: ['./src/test/setup.ts'],
      globals: true,
      css: false,
    },
  }
})
