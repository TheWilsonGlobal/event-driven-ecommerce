# Why each service has a `loadEnv` module imported first

`KAFKA_ENABLED` (and every other `.env` key read at module scope) is resolved
when a module is **evaluated**, not when a function on it is first called.

ES module imports are hoisted: the entire import graph of `src/index.ts` is
evaluated top to bottom **before** the first statement in the body of `index.ts`
runs. So this ordering — which every service originally had — is a bug:

```ts
import { eventProducer } from './events' // ← evaluates producer.ts NOW,
//   which calls loadKafkaSettings(),
//   which reads process.env.KAFKA_ENABLED

dotenv.config({ path: path.resolve(REPO_ROOT, '.env') }) // ← too late
```

`loadKafkaSettings()` sees `process.env.KAFKA_ENABLED === undefined` and returns
`enabled: false`, regardless of what `.env` says. The symptom is an admin UI
that reports Kafka as disabled after the operator has set `KAFKA_ENABLED=true`
and restarted — the file is right, the process never read it.

Verified directly: with `KAFKA_ENABLED=true` on disk, `eventProducer.enabled`
was `false` while `process.env.KAFKA_ENABLED` read `"true"` immediately after
the `dotenv.config()` call.

## The fix

Each service has a `src/loadEnv.ts` whose only job is the `dotenv.config()`
calls, and `index.ts` imports it **before every other local import**:

```ts
import './loadEnv' // ← must stay first
import { eventProducer } from './events'
```

A side-effect-only import is used rather than moving the `dotenv.config()` calls
upward inside `index.ts`, because import hoisting means no placement inside the
body can ever precede the import graph. Only another import can.

`import './loadEnv'` has no bindings, so formatters and `organize-imports`
tooling leave its position alone — but if you add an import above it, the bug
comes back silently. That is what the comment in each `loadEnv.ts` guards.
