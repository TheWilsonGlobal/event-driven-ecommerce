/**
 * Kafka event-backbone load test.
 *
 * The sibling of stressQueues.ts, and built on the same principle: hit the
 * REAL HTTP route that publishes (`POST /api/v1/orders`), not a direct kafkajs
 * producer. The interesting path is the whole one — HTTP → Fastify → Prisma
 * write → publishOrderCreated() → Kafka → two independent consumer groups —
 * and a synthetic producer would skip every part of it that can actually break
 * under load.
 *
 * ── What this characterises ────────────────────────────────────────────────
 * §7.5 of the implementation report recorded "correctness verified, throughput
 * not characterised". This measures the three numbers that were missing:
 *
 *   1. Publish throughput   orders/sec accepted, and events/sec the producer
 *                           actually got onto the broker.
 *   2. Fan-out latency      wall-clock from "last order accepted" to "both
 *                           consumer groups have caught up", which is the only
 *                           latency an operator can act on.
 *   3. Lag under load       peak consumer lag observed while the burst drains,
 *                           sampled from each consumer's own /api/v1/events.
 *
 * ── Why the numbers are all deltas ─────────────────────────────────────────
 * Every counter on /api/v1/events is PROCESS-LIFETIME (see
 * `countersAreProcessLifetime` in the contract): it resets when a service
 * restarts and is not a durable topic total. Reporting an absolute "published:
 * 412" after a burst would silently include whatever the service had already
 * done since boot. So every figure below is an explicit before→after delta,
 * captured from the same endpoint the admin Events screen reads.
 *
 * ── The honesty rules this inherits ────────────────────────────────────────
 * `lag: null` and `partitions: null` mean UNMEASURED, never zero. A run that
 * could not read lag reports it as unmeasured and says the throughput figure
 * is unverified, rather than printing a reassuring 0. Same rule the backend's
 * `['number','null']` schemas and the admin panel's `—` exist to enforce.
 *
 * Usage:
 *   pnpm --filter @ecommerce/tests run stress:events
 *   pnpm --filter @ecommerce/tests run stress:events -- --orders=500 --concurrency=50
 *
 * Requires KAFKA_ENABLED=true, a reachable broker, and ms-order (5465),
 * ms-inventory (5466) and ms-analytics (5467) running. The script refuses to
 * run — rather than reporting zeros — if Kafka is switched off, because a
 * disabled backbone produces a full set of plausible-looking zeros that are
 * indistinguishable from a broker that dropped everything.
 */

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

interface Args {
  orders: number
  concurrency: number
  orderServiceUrl: string
  inventoryServiceUrl: string
  analyticsServiceUrl: string
  /** How long to wait for both consumer groups to catch up after the burst. */
  drainTimeoutMs: number
  pollIntervalMs: number
}

function parseArgs(argv: string[]): Args {
  const get = (name: string, fallback: string) => {
    const hit = argv.find((a) => a.startsWith(`--${name}=`))
    return hit ? hit.slice(name.length + 3) : fallback
  }
  return {
    orders: Number(get('orders', '200')),
    concurrency: Number(get('concurrency', '25')),
    orderServiceUrl: get('order-url', process.env.ORDER_SERVICE_URL ?? 'http://127.0.0.1:5465'),
    inventoryServiceUrl: get(
      'inventory-url',
      process.env.INVENTORY_SERVICE_URL ?? 'http://127.0.0.1:5466'
    ),
    analyticsServiceUrl: get(
      'analytics-url',
      process.env.ANALYTICS_SERVICE_URL ?? 'http://127.0.0.1:5467'
    ),
    drainTimeoutMs: Number(get('drain-timeout-ms', '60000')),
    pollIntervalMs: Number(get('poll-interval-ms', '500')),
  }
}

// ---------------------------------------------------------------------------
// The slice of /api/v1/events this script reads. Field-for-field the contract
// in shared-messaging/src/kafka/schemas.ts — nullable stays nullable.
// ---------------------------------------------------------------------------

interface TopicSnapshot {
  name: string
  published: number
  publishFailures: number
  partitions: number | null
}

interface ConsumerSnapshot {
  groupId: string
  state: string | null
  /** null = UNMEASURED. Never coerce to 0 — see the header. */
  lag: number | null
  running: boolean
  consumed: number
  failed: number
  skipped: number
}

interface EventSnapshot {
  enabled: boolean
  connected: boolean
  brokers: string[]
  topics: TopicSnapshot[]
  consumers: ConsumerSnapshot[]
  summary: {
    topicCount: number
    published: number
    publishFailures: number
    consumed: number
    consumerFailures: number
  }
}

type SnapshotResult = EventSnapshot | { unavailable: string }

function isUnavailable(s: SnapshotResult): s is { unavailable: string } {
  return 'unavailable' in s
}

// ---------------------------------------------------------------------------
// HTTP helpers (global fetch — Node 18+, no new dependency)
// ---------------------------------------------------------------------------

function describeNetworkError(err: unknown): string {
  if (err instanceof Error) {
    const cause = (err as { cause?: { code?: string } }).cause
    return cause?.code ? `${err.message} (${cause.code})` : err.message
  }
  return String(err)
}

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

async function fetchEvents(baseUrl: string): Promise<SnapshotResult> {
  try {
    const res = await fetch(`${baseUrl}/api/v1/events`)
    if (res.status === 503) {
      const body = await res.json().catch(() => null)
      return { unavailable: body?.reason ?? 'kafka_unavailable (503)' }
    }
    if (!res.ok) {
      return { unavailable: `HTTP ${res.status}` }
    }
    return (await res.json()) as EventSnapshot
  } catch (err) {
    return { unavailable: describeNetworkError(err) }
  }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

// ---------------------------------------------------------------------------
// Load generation
// ---------------------------------------------------------------------------

/**
 * `paymentPreCaptured: true` so the order lands CONFIRMED, which publishes
 * order.created AND order.confirmed rather than order.created alone. That is
 * the fan-out worth measuring: it drives ms-inventory's reservation and
 * ms-analytics' ledger.
 *
 * Note it does NOT publish payment.captured — that comes from the payments
 * route, which this burst never calls. Two events per order, not three;
 * measured at 200 orders -> 400 published.
 */
function orderBody(seq: number) {
  const quantity = 1 + (seq % 3)
  const unitPrice = 19.99
  // `subtotal` and `totalAmount` are REQUIRED by the route schema; omitting
  // either is a bare `{"error":"Bad Request"}` with no field named, which is
  // easy to mistake for a backbone problem rather than a malformed payload.
  const subtotal = Number((unitPrice * quantity).toFixed(2))
  const taxAmount = Number((subtotal * 0.08).toFixed(2))
  return {
    customerName: `Event Load ${seq}`,
    customerEmail: `event-load-${seq}-${Date.now()}@example.test`,
    paymentPreCaptured: true,
    paymentMethod: 'credit_card',
    items: [
      {
        productId: `event-load-product-${seq % 10}`,
        sku: `SKU-EVENTLOAD-${seq % 10}`,
        title: 'Event Load Widget',
        unitPrice,
        quantity,
      },
    ],
    shippingAddress: {
      addressLine1: '1 Backbone Way',
      city: 'Throughputville',
      state: 'CA',
      postalCode: '94000',
      country: 'US',
    },
    subtotal,
    taxAmount,
    shippingAmount: 0,
    discountAmount: 0,
    totalAmount: Number((subtotal + taxAmount).toFixed(2)),
    currency: 'USD',
  }
}

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

interface BurstResult {
  accepted: number
  httpErrors: number
  /** Status code → count, so a 500 wall is distinguishable from a 429. */
  statusCounts: Record<string, number>
  elapsedMs: number
}

async function fireBurst(args: Args): Promise<BurstResult> {
  const result: BurstResult = { accepted: 0, httpErrors: 0, statusCounts: {}, elapsedMs: 0 }
  const tasks = Array.from({ length: args.orders }, (_, i) => async () => {
    const res = await postJson(`${args.orderServiceUrl}/api/v1/orders`, orderBody(i))
    const key = res.status === 0 ? 'network_error' : String(res.status)
    result.statusCounts[key] = (result.statusCounts[key] ?? 0) + 1
    if (res.ok && res.json?.id) {
      result.accepted++
    } else {
      result.httpErrors++
    }
  })

  const started = Date.now()
  await runWithConcurrency(tasks, args.concurrency)
  result.elapsedMs = Date.now() - started
  return result
}

// ---------------------------------------------------------------------------
// Drain tracking
// ---------------------------------------------------------------------------

interface LagSample {
  atMs: number
  /** groupId → lag. null entries mean unmeasured at that sample, not zero. */
  byGroup: Record<string, number | null>
}

/** Sum of a snapshot's consumed counters, or null if the source was unavailable. */
function consumedTotal(s: SnapshotResult): number | null {
  return isUnavailable(s) ? null : s.summary.consumed
}

/**
 * Polls both consumers until each reports lag 0 (caught up) or the deadline
 * passes, recording every lag sample so a peak can be reported.
 *
 * "Caught up" requires a MEASURED zero. A null lag leaves the group counted as
 * not-yet-caught-up, because an unmeasured lag is not evidence of having
 * drained — treating it as 0 would turn a broker we could not query into a
 * clean bill of health.
 */
async function waitForDrain(
  args: Args,
  expectedConsumedDelta: number,
  baselineConsumed: { inventory: number | null; analytics: number | null }
): Promise<{
  samples: LagSample[]
  caughtUpMs: number | null
  finalInventory: SnapshotResult
  finalAnalytics: SnapshotResult
}> {
  const started = Date.now()
  const deadline = started + args.drainTimeoutMs
  const samples: LagSample[] = []
  let caughtUpMs: number | null = null

  let inventory: SnapshotResult = { unavailable: 'not polled' }
  let analytics: SnapshotResult = { unavailable: 'not polled' }

  while (Date.now() < deadline) {
    ;[inventory, analytics] = await Promise.all([
      fetchEvents(args.inventoryServiceUrl),
      fetchEvents(args.analyticsServiceUrl),
    ])

    const byGroup: Record<string, number | null> = {}
    for (const snap of [inventory, analytics]) {
      if (isUnavailable(snap)) continue
      for (const c of snap.consumers) {
        byGroup[c.groupId] = c.lag
      }
    }
    samples.push({ atMs: Date.now() - started, byGroup })

    // Caught up when every known group reports a MEASURED zero lag AND the
    // consumed counters have advanced by at least what we published. The lag
    // check alone is not enough: a consumer that has not yet been assigned
    // partitions can report 0 before it has seen anything.
    const invConsumed = consumedTotal(inventory)
    const anaConsumed = consumedTotal(analytics)
    const invDelta =
      invConsumed !== null && baselineConsumed.inventory !== null
        ? invConsumed - baselineConsumed.inventory
        : null
    const anaDelta =
      anaConsumed !== null && baselineConsumed.analytics !== null
        ? anaConsumed - baselineConsumed.analytics
        : null

    const groups = Object.values(byGroup)
    const allZeroMeasured = groups.length > 0 && groups.every((l) => l === 0)
    const bothAdvanced =
      invDelta !== null &&
      anaDelta !== null &&
      invDelta >= expectedConsumedDelta &&
      anaDelta >= expectedConsumedDelta

    if (allZeroMeasured && bothAdvanced) {
      caughtUpMs = Date.now() - started
      break
    }

    await sleep(args.pollIntervalMs)
  }

  return { samples, caughtUpMs, finalInventory: inventory, finalAnalytics: analytics }
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

const UNMEASURED = '—'

function fmt(n: number | null, suffix = ''): string {
  return n === null ? UNMEASURED : `${n.toLocaleString()}${suffix}`
}

function rate(count: number, ms: number): string {
  if (ms <= 0) return UNMEASURED
  return `${(count / (ms / 1000)).toFixed(1)}/s`
}

function delta(
  before: SnapshotResult,
  after: SnapshotResult,
  field: 'published' | 'consumed'
): number | null {
  if (isUnavailable(before) || isUnavailable(after)) return null
  return after.summary[field] - before.summary[field]
}

function printSnapshotHeader(label: string, s: SnapshotResult): void {
  if (isUnavailable(s)) {
    console.log(`  ${label.padEnd(14)} UNAVAILABLE — ${s.unavailable}`)
    return
  }
  console.log(
    `  ${label.padEnd(14)} enabled=${s.enabled} connected=${s.connected} brokers=${s.brokers.join(',')}`
  )
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))

  console.log('=== Kafka event-backbone load test ===\n')
  console.log(`Orders:        ${args.orders}`)
  console.log(`Concurrency:   ${args.concurrency}`)
  console.log(`Drain timeout: ${args.drainTimeoutMs}ms\n`)

  // ---- Preflight -------------------------------------------------------
  // A disabled backbone yields a complete set of zeros that look exactly like
  // a broker which swallowed everything. Refuse rather than publish a
  // misleading run.
  console.log('Preflight:')
  const [orderPre, invPre, anaPre] = await Promise.all([
    fetchEvents(args.orderServiceUrl),
    fetchEvents(args.inventoryServiceUrl),
    fetchEvents(args.analyticsServiceUrl),
  ])
  printSnapshotHeader('ms-order', orderPre)
  printSnapshotHeader('ms-inventory', invPre)
  printSnapshotHeader('ms-analytics', anaPre)

  const reachable = [orderPre, invPre, anaPre].filter((s) => !isUnavailable(s)) as EventSnapshot[]
  if (reachable.length === 0) {
    console.error('\nABORT: no service answered /api/v1/events. Nothing to measure.')
    process.exitCode = 1
    return
  }
  if (reachable.every((s) => !s.enabled)) {
    console.error(
      '\nABORT: KAFKA_ENABLED is false on every service that answered.\n' +
        '  A disabled backbone produces a full set of zeros that are indistinguishable from\n' +
        '  a broker dropping every event, so this run would be misleading rather than useful.\n' +
        '  Set KAFKA_ENABLED=true in the repo-root .env, restart the three services, and retry.'
    )
    process.exitCode = 1
    return
  }

  const baselineConsumed = {
    inventory: consumedTotal(invPre),
    analytics: consumedTotal(anaPre),
  }

  // ---- Burst -----------------------------------------------------------
  console.log(`\nFiring ${args.orders} CONFIRMED orders at concurrency ${args.concurrency}…`)
  const burst = await fireBurst(args)

  console.log(`\n=== Publish phase ===\n`)
  console.log(`Accepted:      ${burst.accepted} / ${args.orders}`)
  console.log(`HTTP errors:   ${burst.httpErrors}`)
  console.log(`Status codes:  ${JSON.stringify(burst.statusCounts)}`)
  console.log(`Elapsed:       ${burst.elapsedMs}ms`)
  console.log(`Order rate:    ${rate(burst.accepted, burst.elapsedMs)}`)

  // A burst that accepted nothing measures the ORDER ROUTE, not the backbone.
  // Reporting "0.0/s publish throughput" here would blame Kafka for a payload
  // the route rejected — exactly the misattribution this script exists to
  // avoid. Stop and say which status codes came back.
  if (burst.accepted === 0) {
    console.error(
      `
ABORT: no order was accepted, so nothing was published and there is no throughput ` +
        `to measure.
  Status codes: ${JSON.stringify(burst.statusCounts)}
` +
        `  This is an order-route failure, not a backbone result — a 400 usually means the ` +
        `payload is missing a required field (subtotal / totalAmount).`
    )
    process.exitCode = 1
    return
  }

  // How many events each group should see is NOT uniform, and assuming it is
  // produces a false "did not catch up" on a backbone that drained perfectly:
  //
  //   POST /api/v1/orders with paymentPreCaptured:true publishes TWO events,
  //   not three - order.created and order.confirmed. payment.captured is
  //   published by the payments route (routes/payments.ts), which this burst
  //   never calls. Measured: 200 orders -> 400 published.
  //
  //   ms-inventory subscribes to ecommerce.orders.v1 only and handles
  //   order.created; order.confirmed increments `skipped`, which the contract
  //   documents as normal ("a consumer subscribes to whole topics and sees
  //   event types it ignores"). Its `consumed` therefore advances by ~1 per
  //   order, while ms-analytics - which spans all three topics - advances by
  //   more.
  //
  // So the floor is the weakest guarantee that still proves the burst landed:
  // each group must advance by at least one event per accepted order. Lag
  // reaching a MEASURED zero is what actually establishes "caught up".
  const expectedPerGroup = burst.accepted
  console.log(
    `\nWaiting for both consumer groups to catch up ` +
      `(floor: >=${expectedPerGroup} consumed each, plus a measured lag of 0)...`
  )
  const drain = await waitForDrain(args, expectedPerGroup, baselineConsumed)

  const [orderPost, invPost, anaPost] = await Promise.all([
    fetchEvents(args.orderServiceUrl),
    fetchEvents(args.inventoryServiceUrl),
    fetchEvents(args.analyticsServiceUrl),
  ])

  // ---- Report ----------------------------------------------------------
  console.log(`\n=== Fan-out report (all figures are before→after deltas) ===\n`)

  const publishedDelta = delta(orderPre, orderPost, 'published')
  const invConsumedDelta = delta(invPre, invPost, 'consumed')
  const anaConsumedDelta = delta(anaPre, anaPost, 'consumed')

  console.log(`ms-order published:      ${fmt(publishedDelta)} events`)
  console.log(`ms-inventory consumed:   ${fmt(invConsumedDelta)} events`)
  console.log(`ms-analytics consumed:   ${fmt(anaConsumedDelta)} events`)
  console.log(
    `\n  Consumed counts differ by design: ms-inventory subscribes to the orders topic only\n` +
      `  and skips event types it does not handle (order.confirmed), while ms-analytics spans\n` +
      `  all three topics. A lower number here is scope, not loss - check "skipped" below.`
  )

  if (publishedDelta !== null && burst.elapsedMs > 0) {
    console.log(`\nPublish throughput:      ${rate(publishedDelta, burst.elapsedMs)} events`)
  }

  if (drain.caughtUpMs !== null) {
    console.log(`Fan-out latency:         ${drain.caughtUpMs}ms to both groups caught up`)
    if (publishedDelta !== null) {
      console.log(
        `End-to-end throughput:   ${rate(publishedDelta, burst.elapsedMs + drain.caughtUpMs)} events ` +
          `(publish + drain)`
      )
    }
  } else {
    console.log(
      `Fan-out latency:         ${UNMEASURED} — did not observe both groups caught up within ` +
        `${args.drainTimeoutMs}ms.\n` +
        `                         This is NOT proof they are wedged; it means the run ended first.`
    )
  }

  // ---- Peak lag --------------------------------------------------------
  console.log(`\n=== Consumer lag under load ===\n`)
  const groupIds = [...new Set(drain.samples.flatMap((s) => Object.keys(s.byGroup)))]
  if (groupIds.length === 0) {
    console.log(`  ${UNMEASURED} — no consumer group was observed during the drain window.`)
  }
  for (const gid of groupIds) {
    const measured = drain.samples
      .map((s) => s.byGroup[gid])
      .filter((l): l is number => typeof l === 'number')
    const unmeasuredCount = drain.samples.length - measured.length
    if (measured.length === 0) {
      console.log(
        `  ${gid.padEnd(22)} peak lag ${UNMEASURED} (never measured in ${drain.samples.length} samples)`
      )
      continue
    }
    const peak = Math.max(...measured)
    const final = measured[measured.length - 1]
    console.log(
      `  ${gid.padEnd(22)} peak ${String(peak).padStart(6)}  final ${String(final).padStart(6)}${
        unmeasuredCount > 0
          ? `  (${unmeasuredCount}/${drain.samples.length} samples unmeasured)`
          : ''
      }`
    )
  }

  // ---- Failures --------------------------------------------------------
  console.log(`\n=== Failures ===\n`)
  for (const [label, snap] of [
    ['ms-order', orderPost],
    ['ms-inventory', invPost],
    ['ms-analytics', anaPost],
  ] as [string, SnapshotResult][]) {
    if (isUnavailable(snap)) {
      console.log(`  ${label.padEnd(14)} UNAVAILABLE — ${snap.unavailable}`)
      continue
    }
    const c = snap.consumers.reduce(
      (acc, x) => ({ failed: acc.failed + x.failed, skipped: acc.skipped + x.skipped }),
      { failed: 0, skipped: 0 }
    )
    console.log(
      `  ${label.padEnd(14)} publishFailures=${snap.summary.publishFailures} ` +
        `consumerFailures=${snap.summary.consumerFailures} skipped=${c.skipped}`
    )
  }

  // ---- Honesty footer --------------------------------------------------
  const anyUnavailable = [orderPre, invPre, anaPre, orderPost, invPost, anaPost].some(isUnavailable)
  if (anyUnavailable) {
    console.log(
      `\n⚠️  At least one /api/v1/events call was unavailable during this run — the deltas above ` +
        `are incomplete, NOT evidence that zero events flowed.`
    )
  }
  console.log(
    `\nNote: every counter above is process-lifetime and was captured as a before→after delta. ` +
      `\n      "${UNMEASURED}" means unmeasured, never zero.`
  )
}

main().catch((err) => {
  console.error('Load test crashed:', err)
  process.exitCode = 1
})
