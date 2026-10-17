import { validatePayload, type EventContext, type EventEnvelope } from '@ecommerce/shared-messaging'
import type {
  InventoryInsufficientPayload,
  OrderCancelledPayload,
  OrderConfirmedPayload,
  OrderCreatedPayload,
  PaymentCapturedPayload,
  PaymentFailedPayload,
  PaymentRefundedPayload,
} from '@ecommerce/shared-messaging'
import {
  bumpFunnel,
  bumpHourBucket,
  bumpPaymentOutcomes,
  bumpProductCounter,
  claimEvent,
  hourKeyOf,
  recordDuplicate,
  recordProgress,
  recordSalesLines,
  type AnalyticsStore,
  type SalesLine,
  type Tx,
} from '../aggregates/store'
import { mergeLines, type RankingSink } from '../rankings/engine'
import { KEY_ID } from '../rankings/windows'

/**
 * Applies backbone events to the analytics aggregates.
 *
 * ── Why idempotency matters MORE here than in a state machine ───────────────
 * ms-inventory's handlers drive a state machine: re-applying "reserve 3 units
 * of SKU-1 for order X" converges, because the second application finds the
 * reservation already present and does nothing. Re-delivery is self-correcting.
 *
 * An aggregate has no such property. `revenue += 49.99` applied twice yields
 * 99.98, and nothing downstream can detect that the number is wrong — it is
 * a perfectly plausible value. There is no invariant to violate, no row to
 * find already present, no later event that repairs it. The corruption is
 * silent, permanent, and grows with every rebalance.
 *
 * So EVERY handler below routes through `applyOnce`, which claims the
 * envelope's eventId in the processed_events table first and makes no
 * contribution at all when the claim fails. Kafka redelivers on rebalance, on
 * restart, and whenever an offset was not committed; this service treats that
 * as normal, not exceptional.
 *
 * ── Money comes only from events that carry money ───────────────────────────
 * `order.created.totalAmount` and `payment.captured.amount` are immutable
 * historical fact and are the ONLY revenue inputs. An event missing the field
 * it would need contributes NOTHING to revenue rather than contributing 0.
 * The two look identical in the stored total, but they are not the same claim:
 * skipping says "this event told us nothing about money", whereas a 0
 * contribution asserts "this event told us the amount was zero". The
 * difference surfaces the moment an average is taken over the contributing
 * events, and by then the evidence of which is which is gone.
 */

const CONTRIBUTES_NOTHING = undefined

/**
 * Events whose payload failed the shared schema, since this process started.
 * Process-lifetime like the consumer's own counters: a durable column would
 * need a migration of the live ms_analytics schema, which this change avoids.
 */
let rejectedEvents = 0
export const getRejectedEventCount = (): number => rejectedEvents

export interface HandlerDeps {
  store: AnalyticsStore
  log: (message: string) => void
  /** Windowed sales rank (Redis). Absent when the KV driver is not Redis. */
  rankings?: RankingSink | undefined
}

/**
 * The idempotency gate every handler runs behind.
 *
 * Runs the whole event in ONE transaction. Its first statement claims the
 * eventId (INSERT ... ON CONFLICT DO NOTHING); `apply` runs only on a
 * successful claim, then progress is recorded. A rejected claim is counted
 * (duplicatesSkipped) rather than silently dropped, so redelivery is observable
 * in the API instead of only inferable from its absence, and then the
 * transaction commits having touched no aggregate.
 *
 * ── The claim is atomic with the effect ─────────────────────────────────────
 * The NeDB version had to write the claim BEFORE `apply` (no cross-collection
 * transaction), which meant a crash or throw in `apply` left the event marked
 * processed but only partially applied. That trade-off is retired: the ledger
 * row and every counter bump commit together, so if `apply` throws the whole
 * transaction rolls back — claim included — and the event is neither counted
 * nor marked seen. A redelivery then applies it exactly once; a double count is
 * impossible because the claim row and the counters are one commit. The throw
 * is still visible as a real `failed` count on GET /api/v1/events.
 *
 * Concurrent deliveries of one eventId serialise on the primary-key row: the
 * second blocks until the first commits, then sees the conflict and skips.
 */
async function applyOnce(
  { store, log }: HandlerDeps,
  envelope: EventEnvelope,
  context: EventContext,
  apply: (tx: Tx) => Promise<void>
): Promise<'duplicate' | 'rejected' | 'applied'> {
  const outcome = await store.transaction(
    async (tx): Promise<'duplicate' | 'rejected' | 'applied'> => {
      const claimed = await claimEvent(tx, {
        id: envelope.eventId,
        eventType: envelope.eventType,
        occurredAt: envelope.occurredAt,
        topic: context.topic,
        partition: context.partition,
        offset: context.offset,
      })

      if (!claimed) {
        await recordDuplicate(tx)
        return 'duplicate'
      }

      // Plan 4.4: a payload that breaks the shared contract is claimed (so a
      // redelivery is a plain duplicate, never reprocessed) but contributes to NO
      // aggregate and is not counted as progress. Retrying could never fix it.
      const valid = validatePayload(envelope.eventType, envelope.payload)
      if (!valid.ok) {
        rejectedEvents += 1
        log(
          `Rejected malformed ${envelope.eventType} (eventId=${envelope.eventId}) at ` +
            `${context.topic}[${context.partition}]@${context.offset}: ${valid.reason}`
        )
        return 'rejected'
      }

      await apply(tx)
      await recordProgress(tx, envelope.occurredAt)
      return 'applied'
    }
  )

  if (outcome === 'duplicate') {
    log(
      `Skipped duplicate ${envelope.eventType} (eventId=${envelope.eventId}) ` +
        `redelivered at ${context.topic}[${context.partition}]@${context.offset}`
    )
  }
  return outcome
}

/**
 * A finite, non-negative money amount, or undefined.
 *
 * NaN and Infinity are rejected alongside a missing field: adding either to a
 * running total destroys the whole aggregate permanently, since NaN propagates
 * through every subsequent addition. A negative amount is rejected too — a
 * refund is its own event type, not a negative capture.
 */
function usableAmount(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return CONTRIBUTES_NOTHING
  }
  return value
}

/** A non-empty string, or undefined. Used for currency and identifiers. */
function usableString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : CONTRIBUTES_NOTHING
}

// ─── Orders ────────────────────────────────────────────────────────────────

export async function handleOrderCreated(
  deps: HandlerDeps,
  envelope: EventEnvelope,
  context: EventContext
): Promise<void> {
  const salesLines: SalesLine[] = []
  const outcome = await applyOnce(deps, envelope, context, async (tx) => {
    const payload = envelope.payload as Partial<OrderCreatedPayload>
    const amount = usableAmount(payload.totalAmount)
    const currency = usableString(payload.currency)
    const hourKey = hourKeyOf(envelope.occurredAt)

    await bumpFunnel(tx, { created: 1 })

    if (hourKey) {
      await bumpHourBucket(tx, hourKey, {
        orders: 1,
        // Revenue and its currency move together. An order whose totalAmount
        // we cannot use contributes to the ORDER COUNT (we know it happened)
        // but not to revenue (we do not know what it was worth). Splitting
        // them is the whole point of the nothing-vs-zero rule.
        ...(amount !== undefined ? { revenue: amount } : {}),
        ...(amount !== undefined && currency ? { currency } : {}),
      })
    } else {
      deps.log(
        `order.created ${envelope.eventId} has an unparseable occurredAt ` +
          `(${envelope.occurredAt}); counted in the funnel but not in any hour`
      )
    }

    // Sorted by productId so two concurrent transactions always lock the
    // product_counters rows in the same order; interleaved orders would
    // otherwise be able to deadlock each other.
    const items = (Array.isArray(payload.items) ? [...payload.items] : []).sort((a, b) =>
      String(a?.productId ?? '').localeCompare(String(b?.productId ?? ''))
    )
    for (const item of items) {
      const productId = usableString(item?.productId)
      if (!productId) {
        // Without an id there is nothing to key a counter on. Counting it
        // under a placeholder would invent a product that never existed.
        continue
      }
      const quantity = usableAmount(item?.quantity)
      const unitPrice = usableAmount(item?.unitPrice)

      await bumpProductCounter(tx, productId, {
        sku: usableString(item?.sku) ?? '',
        // timesOrdered counts APPEARANCES in distinct orders, which is what
        // this line is — one product on one order. It is incremented even when
        // quantity is unusable, because the appearance is a fact we observed.
        timesOrdered: 1,
        ...(quantity !== undefined ? { unitsOrdered: quantity } : {}),
        // Line revenue needs BOTH factors. With one missing the product is
        // credited no revenue rather than being credited zero.
        ...(quantity !== undefined && unitPrice !== undefined
          ? { revenue: quantity * unitPrice }
          : {}),
      })
    }

    // Windowed rank history. Written in this transaction so the claim guards it;
    // an unparseable occurredAt writes nothing (never filed under "now").
    const occurredMs = Date.parse(envelope.occurredAt)
    if (Number.isFinite(occurredMs)) {
      for (const item of items) {
        const productId = usableString(item?.productId)
        const quantity = usableAmount(item?.quantity)
        if (!productId || quantity === undefined || quantity <= 0) continue
        // categoryId is not part of OrderLineItem today; take it when a
        // publisher sends one, and skip the category set when it is absent.
        const rawCategory = (item as { categoryId?: unknown }).categoryId
        salesLines.push({
          productId,
          categoryId:
            typeof rawCategory === 'string' && KEY_ID.test(rawCategory) ? rawCategory : null,
          quantity,
        })
      }
      const merged = mergeLines(salesLines)
      salesLines.length = 0
      salesLines.push(...merged)
      await recordSalesLines(tx, envelope.eventId, new Date(occurredMs), merged)
    }
  })

  // After the commit, and only for a freshly applied event: a duplicate or
  // rejected delivery must not move the ranking. The sink never throws.
  if (outcome === 'applied' && deps.rankings && salesLines.length > 0) {
    await deps.rankings.recordOrder({
      occurredAt: new Date(Date.parse(envelope.occurredAt)),
      lines: salesLines,
    })
  }
}

export async function handleOrderConfirmed(
  deps: HandlerDeps,
  envelope: EventEnvelope,
  context: EventContext
): Promise<void> {
  await applyOnce(deps, envelope, context, async (tx) => {
    const hourKey = hourKeyOf(envelope.occurredAt)
    await bumpFunnel(tx, { confirmed: 1 })
    if (hourKey) {
      // Confirmation adds no revenue: order.created already banked this
      // order's totalAmount. Counting it again here would double every
      // confirmed order's contribution — the single easiest way to inflate a
      // revenue figure, since the confirmation legitimately carries a
      // totalAmount field that looks perfectly usable.
      await bumpHourBucket(tx, hourKey, { confirmed: 1 })
    }
  })
}

export async function handleOrderCancelled(
  deps: HandlerDeps,
  envelope: EventEnvelope,
  context: EventContext
): Promise<void> {
  await applyOnce(deps, envelope, context, async (tx) => {
    const hourKey = hourKeyOf(envelope.occurredAt)
    await bumpFunnel(tx, { cancelled: 1 })
    if (hourKey) {
      // Revenue is NOT decremented. The hour in which an order was created
      // genuinely saw that order created; a cancellation an hour later is a
      // separate fact belonging to a later bucket. Subtracting here would
      // silently rewrite history, and would let a bucket go negative.
      await bumpHourBucket(tx, hourKey, { cancelled: 1 })
    }
  })
}

// ─── Payments ──────────────────────────────────────────────────────────────

export async function handlePaymentCaptured(
  deps: HandlerDeps,
  envelope: EventEnvelope,
  context: EventContext
): Promise<void> {
  await applyOnce(deps, envelope, context, async (tx) => {
    const payload = envelope.payload as Partial<PaymentCapturedPayload>
    const amount = usableAmount(payload.amount)

    await bumpPaymentOutcomes(tx, {
      captured: 1,
      ...(amount !== undefined ? { capturedAmount: amount } : {}),
    })
  })
}

export async function handlePaymentFailed(
  deps: HandlerDeps,
  envelope: EventEnvelope,
  context: EventContext
): Promise<void> {
  await applyOnce(deps, envelope, context, async (tx) => {
    const payload = envelope.payload as Partial<PaymentFailedPayload>
    // A failure carries the amount that was ATTEMPTED, not one that moved. It
    // is deliberately not accumulated anywhere: summing attempted money into a
    // money field would put value in a total that no one was ever charged.
    void payload
    await bumpPaymentOutcomes(tx, { failed: 1 })
  })
}

export async function handlePaymentRefunded(
  deps: HandlerDeps,
  envelope: EventEnvelope,
  context: EventContext
): Promise<void> {
  await applyOnce(deps, envelope, context, async (tx) => {
    const payload = envelope.payload as Partial<PaymentRefundedPayload>
    const amount = usableAmount(payload.amount)

    await bumpPaymentOutcomes(tx, {
      refunded: 1,
      ...(amount !== undefined ? { refundedAmount: amount } : {}),
    })
  })
}

// ─── Inventory ─────────────────────────────────────────────────────────────

export async function handleInventoryReserved(
  deps: HandlerDeps,
  envelope: EventEnvelope,
  context: EventContext
): Promise<void> {
  await applyOnce(deps, envelope, context, async (tx) => {
    await bumpFunnel(tx, { reserved: 1 })
  })
}

/**
 * inventory.released is consumed but contributes to no aggregate today.
 *
 * It is registered anyway rather than left unhandled, because an unhandled
 * type increments the consumer's `skipped` counter — which would make a
 * normal, expected event look like a message this service failed to
 * understand. Claiming it also records it in processed_events, so the log of
 * what was seen stays complete.
 */
export async function handleInventoryReleased(
  deps: HandlerDeps,
  envelope: EventEnvelope,
  context: EventContext
): Promise<void> {
  await applyOnce(deps, envelope, context, async () => {
    // Intentionally no aggregate contribution — a release is the undo of a
    // reservation, and the funnel counts what HAPPENED, not the net position.
  })
}

export async function handleInventoryInsufficient(
  deps: HandlerDeps,
  envelope: EventEnvelope,
  context: EventContext
): Promise<void> {
  await applyOnce(deps, envelope, context, async (tx) => {
    const payload = envelope.payload as Partial<InventoryInsufficientPayload>
    const shortfalls = Array.isArray(payload.shortfalls) ? payload.shortfalls.length : 0
    await bumpFunnel(tx, { insufficient: 1 })
    deps.log(
      `inventory.insufficient for order ${payload.orderId ?? 'unknown'} ` +
        `(${shortfalls} short line(s))`
    )
  })
}

/**
 * Referenced only so the payload types this service reads stay imported and
 * therefore checked against the shared contract. Without it `noUnusedLocals`
 * would force the type imports out, and a breaking change to
 * OrderCancelledPayload or OrderConfirmedPayload would stop being a compile
 * error here — which is exactly the drift these shared types exist to prevent.
 */
export type ConsumedPayloads =
  | OrderCreatedPayload
  | OrderConfirmedPayload
  | OrderCancelledPayload
  | PaymentCapturedPayload
  | PaymentFailedPayload
  | PaymentRefundedPayload
  | InventoryInsufficientPayload
