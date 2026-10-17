#!/usr/bin/env node
/**
 * Runs the Prisma CLI with the repo-root .env loaded.
 *
 * Prisma only auto-loads a .env sitting next to the schema or the package, and
 * the Postgres URLs live in the repo-root .env (single source for every
 * service). dotenv never overrides keys already in the environment, so CI can
 * still inject real values.
 *
 *   node ../scripts/prisma-env.js migrate deploy
 */
const path = require('path')
const { spawnSync } = require('child_process')
require(require.resolve('dotenv', { paths: [process.cwd()] })).config({
  path: path.resolve(__dirname, '../../.env'),
})

// Same derivation as shared-database's applyServiceUrlDefaults: the connection base is
// written once (SUPABASE_DB_URL); explicit per-service values still win.
if (process.env.SUPABASE_DB_URL) {
  const base = process.env.SUPABASE_DB_URL.trim().replace(/\/+$/, '')
  const db = process.env.SUPABASE_DB_NAME || 'postgres'
  for (const s of ['user', 'order', 'product', 'inventory', 'analytics']) {
    const url = `${base}/${db}?schema=ms_${s}`
    process.env[`${s.toUpperCase()}_DATABASE_URL`] ||= url
    process.env[`${s.toUpperCase()}_DIRECT_URL`] ||= url
  }
}

const bin = require.resolve('prisma/build/index.js', { paths: [process.cwd()] })
const r = spawnSync(process.execPath, [bin, ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: process.env,
})
process.exit(r.status ?? 1)
