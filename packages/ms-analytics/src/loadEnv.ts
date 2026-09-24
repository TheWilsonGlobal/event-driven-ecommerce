import * as dotenv from 'dotenv'
import * as path from 'path'

/**
 * Loads `.env` before anything else in this service reads `process.env`.
 *
 * ⚠️ `import './loadEnv'` MUST stay the first local import in index.ts.
 *
 * ES module imports are hoisted: the whole import graph of index.ts is
 * evaluated before the first statement in its body. Modules that read
 * `process.env` at module scope — the Kafka consumer calls
 * `loadKafkaSettings()`, which reads KAFKA_ENABLED — therefore run BEFORE any
 * `dotenv.config()` placed in the body of index.ts.
 *
 * The symptom is silent and confusing: `.env` says KAFKA_ENABLED=true, the
 * service is restarted, and /api/v1/events still reports `enabled: false`,
 * because the consumer was constructed while the variable was still undefined.
 * No error is logged — a disabled backbone is a valid, healthy state, so
 * nothing looks wrong.
 *
 * Moving the dotenv call higher inside index.ts cannot fix this; no statement
 * in the body can precede the import graph. Only another import can, which is
 * why this is a side-effect-only module rather than an exported function.
 *
 * See shared/messaging/src/kafka/README-env-ordering.md.
 */

/** Workspace root — this service's cwd is packages/ms-analytics. */
export const REPO_ROOT = path.resolve(__dirname, '../../../')

dotenv.config({ path: path.join(REPO_ROOT, '.env') })
