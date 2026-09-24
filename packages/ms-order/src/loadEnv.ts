import * as dotenv from 'dotenv'
import * as path from 'path'

/**
 * Loads `.env` before anything else in this service reads `process.env`.
 *
 * ⚠️ `import './loadEnv'` MUST stay the first local import in index.ts.
 *
 * ES module imports are hoisted: the whole import graph of index.ts is
 * evaluated before the first statement in its body. Modules that read
 * `process.env` at module scope — `events/producer.ts` calls
 * `loadKafkaSettings()`, which reads KAFKA_ENABLED — therefore run BEFORE any
 * `dotenv.config()` placed in the body of index.ts.
 *
 * The symptom is silent and confusing: `.env` says KAFKA_ENABLED=true, the
 * service is restarted, and /api/v1/events still reports `enabled: false`,
 * because the producer was constructed while the variable was still undefined.
 * No error is logged — a disabled backbone is a valid, healthy state, so
 * nothing looks wrong.
 *
 * Moving the dotenv calls higher inside index.ts cannot fix this; no statement
 * in the body can precede the import graph. Only another import can, which is
 * why this is a side-effect-only module rather than an exported function.
 *
 * See shared/messaging/src/kafka/README-env-ordering.md.
 */

/** Workspace root — this service's cwd is packages/ms-order. */
export const REPO_ROOT = path.resolve(__dirname, '../../../')

// Package-local .env first: dotenv never overrides an already-set key, so the
// SQLite DATABASE_URL this service's Prisma schema needs wins over the root
// .env's Postgres DATABASE_URL (which other, non-Prisma consumers read).
dotenv.config({ path: path.resolve(__dirname, '../.env') })
dotenv.config({ path: path.resolve(REPO_ROOT, '.env') })
