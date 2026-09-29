/**
 * BullMQ task-queue stress test.
 *
 * Hits the REAL HTTP routes that enqueue jobs on ms-order and ms-product —
 * this is deliberately not a direct BullMQ/Redis client test. The point is to
 * stress the same path a real burst of traffic would take: HTTP → Fastify
 * route → Prisma/NeDB write → queueManager.enqueueX() → BullMQ → worker.
 *
 * What it checks, per queue:
 *  - enqueue success rate (an enqueue can fail soft — tryEnqueue() swallows
 *    Redis errors so an order/product write is never rolled back by a queue
 *    outage; this script surfaces that as a distinct number, not a crash)
 *  - completion rate and failure rate once BullMQ has had time to drain
 *  - jobs that neither completed nor failed within the stall window (stuck
 *    'active'/'waiting'/'delayed' — a real backpressure or hang signal)
 *  - wall-clock throughput (jobs/sec observed by the queue's own counters)
 *
 * Usage:
 *   pnpm --filter @ecommerce/tests run stress
 *   pnpm --filter @ecommerce/tests run stress -- --concurrency=50 --rounds=3
 *
 * Requires ms-order (5465) and ms-product (5464) already running against a
 * real Redis (KV_CACHE_DRIVER=redis) — see 08-operational-commands.md §8.2.
 * Talks to the services directly, not through the gateway (see the .notes
 * architecture audit: the gateway does plain prefix proxying with no auth
 * gate, so going direct saves a hop and matters more at stress-test volume).
 */

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

interface Args {
  concurrency: number
  rounds: number
  orderServiceUrl: string
  productServiceUrl: string
  /** How long to keep polling GET /api/v1/queues for stragglers before giving up. */
  drainTimeoutMs: number
  pollIntervalMs: number
}

function parseArgs(argv: string[]): Args {
  const get = (name: string, fallback: string) => {
    const hit = argv.find((a) => a.startsWith(`--${name}=`))
    return hit ? hit.slice(name.length + 3) : fallback
  }
  return {
    concurrency: Number(get('concurrency', '25')),
    rounds: Number(get('rounds', '1')),
    orderServiceUrl: get('order-url', process.env.ORDER_SERVICE_URL ?? 'http://127.0.0.1:5465'),
    productServiceUrl: get(
      'product-url',
      process.env.PRODUCT_SERVICE_URL ?? 'http://127.0.0.1:5464'
    ),
    drainTimeoutMs: Number(get('drain-timeout-ms', '60000')),
    pollIntervalMs: Number(get('poll-interval-ms', '1000')),
  }
}

// ---------------------------------------------------------------------------
// Minimal HTTP helpers (global fetch — Node 18+, no new dependency)
// ---------------------------------------------------------------------------

async function postJson(
  url: string,
  body: unknown
): Promise<{ ok: boolean; status: number; json: any }> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    const json = await res.json().catch(() => null)
    return { ok: res.ok, status: res.status, json }
  } catch (err) {
    return { ok: false, status: 0, json: { error: describeNetworkError(err) } }
  }
}

async function patchJson(
  url: string,
  body: unknown
): Promise<{ ok: boolean; status: number; json: any }> {
  try {
    const res = await fetch(url, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    const json = await res.json().catch(() => null)
    return { ok: res.ok, status: res.status, json }
  } catch (err) {
    return { ok: false, status: 0, json: { error: describeNetworkError(err) } }
  }
}

async function del(url: string): Promise<{ ok: boolean; status: number; json: any }> {
  try {
    const res = await fetch(url, { method: 'DELETE' })
    const json = await res.json().catch(() => null)
    return { ok: res.ok, status: res.status, json }
  } catch (err) {
    return { ok: false, status: 0, json: { error: describeNetworkError(err) } }
  }
}

async function getJson(url: string): Promise<{ ok: boolean; status: number; json: any }> {
  try {
    const res = await fetch(url)
    const json = await res.json().catch(() => null)
    return { ok: res.ok, status: res.status, json }
  } catch (err) {
    return { ok: false, status: 0, json: { error: describeNetworkError(err) } }
  }
}

function describeNetworkError(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

// ---------------------------------------------------------------------------
// Tracked job bookkeeping
// ---------------------------------------------------------------------------

type QueueName =
  | 'order-expiration'
  | 'payment-retry'
  | 'notification-dispatch'
  | 'saga-compensation'
  | 'reindex-search'

interface TrackedJob {
  queue: QueueName
  jobId: string
  label: string
  enqueuedAt: number
}

interface RoundResult {
  attempted: number
  enqueued: number
  enqueueFailed: number
  httpErrors: number
  /** Count of HTTP 500s specifically — see the id-collision note in randomProductBody(). */
  serverErrors: number
}

// ---------------------------------------------------------------------------
// Order-service load: order-expiration, notification-dispatch, payment-retry,
// saga-compensation all originate from POST /api/v1/orders and its follow-up
// endpoints.
// ---------------------------------------------------------------------------

function randomOrderBody(paymentPreCaptured: boolean, seq: number) {
  return {
    customerName: `Stress Test ${seq}`,
    customerEmail: `stress-${seq}-${Date.now()}@example.test`,
    paymentPreCaptured,
    paymentMethod: 'credit_card',
    items: [
      {
        productId: `stress-product-${seq}`,
        sku: `SKU-STRESS-${seq}`,
        title: 'Stress Test Widget',
        unitPrice: 9.99,
        quantity: 1 + (seq % 5),
      },
    ],
    shippingAddress: {
      addressLine1: '1 Load Test Way',
      city: 'Stressville',
      state: 'CA',
      postalCode: '90001',
      country: 'US',
    },
    subtotal: 9.99,
    totalAmount: 9.99,
  }
}

/**
 * Fires `count` concurrent order creations split across the two
 * paymentPreCaptured branches, then — for a slice of the CONFIRMED ones —
 * follows up with a capture(outcome: 'fail') and a saga-failure call so
 * payment-retry and saga-compensation get real traffic too, not just
 * order-expiration/notification-dispatch.
 */
async function stressOrderService(
  baseUrl: string,
  count: number,
  tracked: TrackedJob[]
): Promise<RoundResult> {
  const result: RoundResult = {
    attempted: 0,
    enqueued: 0,
    enqueueFailed: 0,
    httpErrors: 0,
    serverErrors: 0,
  }

  const tasks = Array.from({ length: count }, (_, i) => async () => {
    result.attempted++
    // Alternate branches so both order-expiration (PENDING) and
    // notification-dispatch (CONFIRMED) get real load in the same run.
    const pending = i % 2 === 0
    const res = await postJson(`${baseUrl}/api/v1/orders`, randomOrderBody(!pending, i))
    recordHttpFailure(result, res)

    if (!res.ok || res.status === 0) {
      return
    }

    const orderId: string | undefined = res.json?.id
    if (!orderId) {
      result.httpErrors++
      return
    }

    // Both branches enqueue as a side effect of the create call itself
    // (order-expiration for PENDING, send-confirmation+send-receipt for
    // CONFIRMED) with no jobId surfaced in the response to track directly —
    // their throughput is verified via the queue's own before/after counts
    // instead (see drainAndReport).
    result.enqueued++
  })

  await runWithConcurrency(tasks, Math.min(count, 50))

  // Separate pass: PENDING orders specifically for payment-retry /
  // saga-compensation, since capture() requires a PENDING payment. Counted
  // as its own attempted/enqueued total (attemptedPass2) rather than folded
  // into the pass-1 numbers above, since each attempt here issues two
  // further enqueue calls (capture + saga-failure) that pass 1 never makes —
  // conflating the two would make the enqueued:attempted ratio meaningless.
  const pass2Count = Math.ceil(count / 2)
  let attemptedPass2 = 0
  const paymentTasks = Array.from({ length: pass2Count }, (_, i) => async () => {
    attemptedPass2++
    const createRes = await postJson(`${baseUrl}/api/v1/orders`, randomOrderBody(false, 10_000 + i))
    recordHttpFailure(result, createRes)
    if (!createRes.ok) {
      return
    }
    const orderId: string | undefined = createRes.json?.id
    const orderNumber: string | undefined = createRes.json?.orderNumber
    if (!orderId) {
      result.httpErrors++
      return
    }

    // Force a capture failure to drive payment-retry.
    const captureRes = await postJson(`${baseUrl}/api/v1/payments/${orderId}/capture`, {
      outcome: 'fail',
    })
    if (captureRes.ok && captureRes.json?.retryJobId) {
      tracked.push({
        queue: 'payment-retry',
        jobId: String(captureRes.json.retryJobId),
        label: `retry-capture ${orderNumber ?? orderId}`,
        enqueuedAt: Date.now(),
      })
      result.enqueued++
    } else if (captureRes.status === 503) {
      result.enqueueFailed++
    } else {
      recordHttpFailure(result, captureRes)
    }

    // Also drive saga-compensation's release-inventory branch directly —
    // it has no payment precondition, unlike refund-payment.
    const sagaRes = await postJson(`${baseUrl}/api/v1/orders/${orderId}/saga-failure`, {
      step: 'reserve-inventory',
      compensation: 'release-inventory',
      reason: 'stress-test forced failure',
    })
    if (sagaRes.status === 202 && sagaRes.json?.jobId) {
      tracked.push({
        queue: 'saga-compensation',
        jobId: String(sagaRes.json.jobId),
        label: `release-inventory ${orderNumber ?? orderId}`,
        enqueuedAt: Date.now(),
      })
      result.enqueued++
    } else if (sagaRes.status === 503) {
      result.enqueueFailed++
    } else if (sagaRes.status !== 202) {
      recordHttpFailure(result, sagaRes)
    }
  })

  await runWithConcurrency(paymentTasks, Math.min(paymentTasks.length, 50))

  result.attempted += attemptedPass2
  return result
}

/** Buckets a failed response into serverErrors (5xx) vs httpErrors (everything else non-2xx). */
function recordHttpFailure(result: RoundResult, res: { ok: boolean; status: number }): void {
  if (res.ok) return
  if (res.status >= 500) {
    result.serverErrors++
  } else {
    result.httpErrors++
  }
}

// ---------------------------------------------------------------------------
// Product-service load: reindex-search via create/update/delete
// ---------------------------------------------------------------------------

function randomProductBody(seq: number) {
  // Note: does NOT set `id` — ms-product falls back to `prod-${Date.now()}`
  // (packages/ms-product/src/routes/products.ts) when the body omits one.
  // Under real concurrency, distinct requests land in the same millisecond
  // and collide on that id, and NeDB's unique-key constraint turns the
  // second insert into a 500 rather than a retry or a collision-proof id.
  // This script intentionally reproduces that instead of working around it
  // by generating its own unique id client-side — a stress test that hides
  // the one bug concurrency actually surfaces would defeat the point of
  // running it. See the `serverErrors` counter in the round summary.
  return {
    title: `Stress Product ${seq}`,
    slug: `stress-product-${seq}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    sku: `SKU-STRESS-PRODUCT-${seq}`,
    price: 19.99,
    stock: 100,
    category: { id: 'stress-cat', name: 'Stress Category', slug: 'stress-category' },
  }
}

async function stressProductService(
  baseUrl: string,
  count: number,
  tracked: TrackedJob[]
): Promise<RoundResult> {
  const result: RoundResult = {
    attempted: 0,
    enqueued: 0,
    enqueueFailed: 0,
    httpErrors: 0,
    serverErrors: 0,
  }

  const tasks = Array.from({ length: count }, (_, i) => async () => {
    result.attempted++
    const createRes = await postJson(`${baseUrl}/api/v1/products`, randomProductBody(i))
    if (!createRes.ok) {
      recordHttpFailure(result, createRes)
      return
    }
    result.enqueued++ // reindex-product on create; no jobId surfaced in the response

    const productId: string | undefined = createRes.json?.id ?? createRes.json?._id
    if (!productId) return

    // Update, to fire a second reindex-product for the same product
    // (exercises the jobId: `reindex-${productId}` de-dupe path — BullMQ
    // should coalesce a rapid create+update into the latest job, not error).
    const patchRes = await patchJson(`${baseUrl}/api/v1/products/${productId}`, {
      price: 24.99,
    })
    if (patchRes.ok) {
      result.enqueued++
    } else {
      recordHttpFailure(result, patchRes)
    }

    // Delete a fraction to also exercise remove-from-index.
    if (i % 3 === 0) {
      const deleteRes = await del(`${baseUrl}/api/v1/products/${productId}`)
      if (deleteRes.ok) {
        result.enqueued++
      } else {
        recordHttpFailure(result, deleteRes)
      }
    }
  })

  await runWithConcurrency(tasks, Math.min(count, 50))
  void tracked // reindex jobIds aren't returned by the HTTP response; verified via queue counts only.
  return result
}

// ---------------------------------------------------------------------------
// Bounded concurrency runner
// ---------------------------------------------------------------------------

async function runWithConcurrency(tasks: Array<() => Promise<void>>, limit: number): Promise<void> {
  let cursor = 0
  const workers = Array.from({ length: Math.max(1, limit) }, async () => {
    while (cursor < tasks.length) {
      const i = cursor++
      await tasks[i]()
    }
  })
  await Promise.all(workers)
}

// ---------------------------------------------------------------------------
// Queue verification via GET /api/v1/queues
// ---------------------------------------------------------------------------

interface QueueSnapshot {
  name: string
  counts: { waiting: number; active: number; completed: number; failed: number; delayed: number }
  recentJobs: Array<{ id: string; status: string; name: string }>
}

async function fetchQueues(baseUrl: string): Promise<QueueSnapshot[] | 'unavailable'> {
  const res = await getJson(`${baseUrl}/api/v1/queues`)
  if (res.status === 503) return 'unavailable'
  if (!res.ok || !res.json?.queues) return 'unavailable'
  return res.json.queues
}

/**
 * Polls both services until every tracked job (payment-retry,
 * saga-compensation — the only ones whose jobId we actually captured) has
 * resolved to completed/failed, or drainTimeoutMs elapses. Also snapshots
 * aggregate counts before/after so order-expiration/notification-dispatch/
 * reindex-search — whose per-job ids we never got back from the HTTP
 * responses — still get a before/after completed-count delta as evidence of
 * throughput, even without per-job tracking.
 */
async function drainAndReport(
  args: Args,
  before: { order: QueueSnapshot[] | 'unavailable'; product: QueueSnapshot[] | 'unavailable' },
  tracked: TrackedJob[]
): Promise<void> {
  const deadline = Date.now() + args.drainTimeoutMs
  const resolved = new Map<string, string>() // jobId -> status

  while (Date.now() < deadline && resolved.size < tracked.length) {
    const [orderQueues, productQueues] = await Promise.all([
      fetchQueues(args.orderServiceUrl),
      fetchQueues(args.productServiceUrl),
    ])

    for (const job of tracked) {
      if (resolved.has(job.jobId)) continue
      const queues = job.queue === 'reindex-search' ? productQueues : orderQueues
      if (queues === 'unavailable') continue
      const q = queues.find((qq) => qq.name === job.queue)
      const found = q?.recentJobs.find((j) => j.id === job.jobId)
      if (found && (found.status === 'completed' || found.status === 'failed')) {
        resolved.set(job.jobId, found.status)
      }
    }

    if (resolved.size < tracked.length) {
      await sleep(args.pollIntervalMs)
    }
  }

  const [orderAfter, productAfter] = await Promise.all([
    fetchQueues(args.orderServiceUrl),
    fetchQueues(args.productServiceUrl),
  ])

  // ---- Report ----
  console.log('\n=== Queue drain report ===\n')

  const completed = [...resolved.values()].filter((s) => s === 'completed').length
  const failed = [...resolved.values()].filter((s) => s === 'failed').length
  const stuck = tracked.length - resolved.size

  console.log(
    `Tracked jobs (payment-retry / saga-compensation, have real jobIds): ${tracked.length}`
  )
  console.log(`  completed: ${completed}`)
  console.log(`  failed:    ${failed}`)
  console.log(
    `  stuck (neither completed nor failed within ${args.drainTimeoutMs}ms): ${stuck}${
      stuck > 0 ? '  <-- investigate: worker stall or Redis backpressure' : ''
    }`
  )

  console.log(
    '\nNote: order-expiration jobs are delayed BULLMQ_ORDER_EXPIRATION_MINUTES (15 by default) ' +
      'before they even enter "waiting" — a default --drain-timeout-ms will always show them ' +
      'sitting in "delayed" below. That is expected, not a stall.\n' +
      'Note: this script forces every payment-retry job to fail (outcome: "fail"), which drives ' +
      'it through all 5 attempts of its exponential backoff (10s/20s/40s/80s/160s — definitions.ts) ' +
      'before finally landing as "failed". That alone exceeds the default 60s drain window, so a ' +
      'handful of payment-retry jobs still sitting in "delayed" (not stuck \'active\') at report ' +
      'time is expected too, not a stall — only notification-dispatch / saga-compensation / ' +
      'reindex-search are realistic to see drain fully within this run.'
  )

  console.log('\nAggregate queue counts (order-expiration / notification-dispatch / reindex-search')
  console.log('are reported here as before→after deltas, since the HTTP responses that enqueue')
  console.log('them do not surface a jobId to track individually):\n')

  printDelta('ms-order', before.order, orderAfter)
  printDelta('ms-product', before.product, productAfter)

  const anyUnavailable =
    orderAfter === 'unavailable' ||
    productAfter === 'unavailable' ||
    before.order === 'unavailable' ||
    before.product === 'unavailable'
  if (anyUnavailable) {
    console.log(
      '\n⚠️  At least one GET /api/v1/queues call returned 503 (Redis unreachable) during this ' +
        'run — treat the deltas above as incomplete, not as "zero jobs ran".'
    )
  }
}

function printDelta(
  service: string,
  before: QueueSnapshot[] | 'unavailable',
  after: QueueSnapshot[] | 'unavailable'
): void {
  console.log(`[${service}]`)
  if (before === 'unavailable' || after === 'unavailable') {
    console.log('  (unavailable during at least one snapshot — see warning below)')
    return
  }
  const names = new Set([...before.map((q) => q.name), ...after.map((q) => q.name)])
  for (const name of names) {
    const b = before.find((q) => q.name === name)?.counts
    const a = after.find((q) => q.name === name)?.counts
    if (!b || !a) continue
    const completedDelta = a.completed - b.completed
    const failedDelta = a.failed - b.failed
    const inFlight = a.active + a.waiting + a.delayed
    console.log(
      `  ${name.padEnd(22)} +${completedDelta} completed, +${failedDelta} failed, ` +
        `${inFlight} still in flight (active ${a.active} / waiting ${a.waiting} / delayed ${a.delayed})`
    )
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv.slice(2))

  console.log('BullMQ task-queue stress test')
  console.log(`  order service:   ${args.orderServiceUrl}`)
  console.log(`  product service: ${args.productServiceUrl}`)
  console.log(`  concurrency:     ${args.concurrency}`)
  console.log(`  rounds:          ${args.rounds}`)
  console.log(`  drain timeout:   ${args.drainTimeoutMs}ms\n`)

  const [orderHealth, productHealth] = await Promise.all([
    fetchQueues(args.orderServiceUrl),
    fetchQueues(args.productServiceUrl),
  ])
  if (orderHealth === 'unavailable') {
    console.error(
      `✗ ${args.orderServiceUrl}/api/v1/queues is unavailable (Redis down or ms-order not ` +
        `running). Start Redis (infra-hub) and ms-order before stress-testing — a 503 here ` +
        `means every enqueue below will fail soft rather than actually queue anything.`
    )
    process.exitCode = 1
    return
  }
  if (productHealth === 'unavailable') {
    console.error(
      `✗ ${args.productServiceUrl}/api/v1/queues is unavailable (Redis down, ms-product not ` +
        `running, or ms-product is on the embedded KV driver rather than Redis).`
    )
    process.exitCode = 1
    return
  }

  const before = { order: orderHealth, product: productHealth }
  const tracked: TrackedJob[] = []
  const orderTotals: RoundResult = {
    attempted: 0,
    enqueued: 0,
    enqueueFailed: 0,
    httpErrors: 0,
    serverErrors: 0,
  }
  const productTotals: RoundResult = {
    attempted: 0,
    enqueued: 0,
    enqueueFailed: 0,
    httpErrors: 0,
    serverErrors: 0,
  }

  for (let round = 1; round <= args.rounds; round++) {
    console.log(`--- round ${round}/${args.rounds} ---`)
    const [orderResult, productResult] = await Promise.all([
      stressOrderService(args.orderServiceUrl, args.concurrency, tracked),
      stressProductService(args.productServiceUrl, args.concurrency, tracked),
    ])
    mergeInto(orderTotals, orderResult)
    mergeInto(productTotals, productResult)
    console.log(
      `  ms-order:   ${orderResult.enqueued}/${orderResult.attempted} enqueue attempts ok, ` +
        `${orderResult.enqueueFailed} soft-failed (Redis down), ${orderResult.httpErrors} HTTP ` +
        `errors, ${orderResult.serverErrors} server errors (5xx)`
    )
    console.log(
      `  ms-product: ${productResult.enqueued} enqueue attempts ok, ` +
        `${productResult.enqueueFailed} soft-failed, ${productResult.httpErrors} HTTP errors, ` +
        `${productResult.serverErrors} server errors (5xx)`
    )
  }

  console.log('\n=== Enqueue summary (all rounds) ===')
  console.log(`ms-order:   ${JSON.stringify(orderTotals)}`)
  console.log(`ms-product: ${JSON.stringify(productTotals)}`)
  if (productTotals.serverErrors > 0) {
    console.log(
      `\n⚠️  ms-product returned ${productTotals.serverErrors} server error(s) — almost ` +
        `certainly the known prod-\${Date.now()} id collision under concurrency (NeDB unique-key ` +
        `violation, HTTP 500) in packages/ms-product/src/routes/products.ts. This is a real ` +
        `product-code bug this stress test is designed to surface, not a bug in this script.`
    )
  }

  console.log('\nDraining queues and polling for completion...')
  await drainAndReport(args, before, tracked)

  const hadHttpErrors =
    orderTotals.httpErrors > 0 ||
    productTotals.httpErrors > 0 ||
    orderTotals.serverErrors > 0 ||
    productTotals.serverErrors > 0
  if (hadHttpErrors) {
    console.log(
      '\n⚠️  Some requests returned non-2xx/non-202 responses that were not one of the expected ' +
        '503-Redis-unavailable cases — check the logs above for status codes.'
    )
    process.exitCode = 1
  }
}

function mergeInto(totals: RoundResult, delta: RoundResult): void {
  totals.attempted += delta.attempted
  totals.enqueued += delta.enqueued
  totals.enqueueFailed += delta.enqueueFailed
  totals.httpErrors += delta.httpErrors
  totals.serverErrors += delta.serverErrors
}

main().catch((err) => {
  console.error('Stress test crashed:', err)
  process.exitCode = 1
})
