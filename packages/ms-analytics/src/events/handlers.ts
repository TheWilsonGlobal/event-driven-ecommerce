import type { EventContext, EventEnvelope } from '@ecommerce/shared-messaging'
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
  type AnalyticsStore,
} from '../aggregates/store'

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
 * envelope's eventId in the processed_events collection first and makes no
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

export interface HandlerDeps {
  store: AnalyticsStore
  log: (message: string) => void
}

/**
 * The idempotency gate every handler runs behind.
 *
 * Claims the eventId, runs `apply` only on a successful claim, then records
 * progress. A rejected claim is counted (duplicatesSkipped) rather than
 * silently dropped, so redelivery is observable in the API instead of only
 * inferable from its absence.
 *
 * Note the ordering: the claim is written BEFORE `apply` runs. If `apply`
 * then throws, the event is marked processed but was only partially applied.
 * That is the deliberate trade — the alternative (claim after apply) makes a
 * crash between the two re-apply the whole contribution, which is exactly the
 * double-count this gate exists to prevent. A partial application is a bounded
 * error in one aggregate; a double count is an unbounded one that compounds.
 * The throw is visible as a real `failed` count on GET /api/v1/events.
 */
async function applyOnce(
  { store, log }: HandlerDeps,
  envelope: EventEnvelope,
  context: EventContext,
  apply: () => Promise<void>
): Promise<void> {
  const claimed = await claimEvent(store, {
    id: envelope.eventId,
    eventType: envelope.eventType,
    occurredAt: envelope.occurredAt,
    processedAt: new Date().toISOString(),
    topic: context.topic,
    partition: context.partition,
    offset: context.offset,
  })

  if (!claimed) {
    await recordDuplicate(store)
    log(
      `Skipped duplicate ${envelope.eventType} (eventId=${envelope.eventId}) ` +
        `redelivered at ${context.topic}[${context.partition}]@${context.offset}`
    )
    return
  }

  await apply()
  await recordProgress(store, envelope.occurredAt)
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
  await applyOnce(deps, envelope, context, async () => {
    const payload = envelope.payload as Partial<OrderCreatedPayload>
    const amount = usableAmount(payload.totalAmount)
    const currency = usableString(payload.currency)
    const hourKey = hourKeyOf(envelope.occurredAt)

    await bumpFunnel(deps.store, { created: 1 })

    if (hourKey) {
      await bumpHourBucket(deps.store, hourKey, {
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

    const items = Array.isArray(payload.items) ? payload.items : []
    for (const item of items) {
      const productId = usableString(item?.productId)
      if (!productId) {
        // Without an id there is nothing to key a counter on. Counting it
        // under a placeholder would invent a product that never existed.
        continue
      }
      const quantity = usableAmount(item?.quantity)
      const unitPrice = usableAmount(item?.unitPrice)

      await bumpProductCounter(deps.store, productId, {
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
  })
}

export async function handleOrderConfirmed(
  deps: HandlerDeps,
  envelope: EventEnvelope,
  context: EventContext
): Promise<void> {
  await applyOnce(deps, envelope, context, async () => {
    const hourKey = hourKeyOf(envelope.occurredAt)
    await bumpFunnel(deps.store, { confirmed: 1 })
    if (hourKey) {
      // Confirmation adds no revenue: order.created already banked this
      // order's totalAmount. Counting it again here would double every
      // confirmed order's contribution — the single easiest way to inflate a
      // revenue figure, since the confirmation legitimately carries a
      // totalAmount field that looks perfectly usable.
      await bumpHourBucket(deps.store, hourKey, { confirmed: 1 })
    }
  })
}

export async function handleOrderCancelled(
  deps: HandlerDeps,
  envelope: EventEnvelope,
  context: EventContext
): Promise<void> {
  await applyOnce(deps, envelope, context, async () => {
    const hourKey = hourKeyOf(envelope.occurredAt)
    await bumpFunnel(deps.store, { cancelled: 1 })
    if (hourKey) {
      // Revenue is NOT decremented. The hour in which an order was created
      // genuinely saw that order created; a cancellation an hour later is a
      // separate fact belonging to a later bucket. Subtracting here would
      // silently rewrite history, and would let a bucket go negative.
      await bumpHourBucket(deps.store, hourKey, { cancelled: 1 })
    }
  })
}

// ─── Payments ──────────────────────────────────────────────────────────────

export async function handlePaymentCaptured(
  deps: HandlerDeps,
  envelope: EventEnvelope,
  context: EventContext
): Promise<void> {
  await applyOnce(deps, envelope, context, async () => {
    const payload = envelope.payload as Partial<PaymentCapturedPayload>
    const amount = usableAmount(payload.amount)

    await bumpPaymentOutcomes(deps.store, {
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
  await applyOnce(deps, envelope, context, async () => {
    const payload = envelope.payload as Partial<PaymentFailedPayload>
    // A failure carries the amount that was ATTEMPTED, not one that moved. It
    // is deliberately not accumulated anywhere: summing attempted money into a
    // money field would put value in a total that no one was ever charged.
    void payload
    await bumpPaymentOutcomes(deps.store, { failed: 1 })
  })
}

export async function handlePaymentRefunded(
  deps: HandlerDeps,
  envelope: EventEnvelope,
  context: EventContext
): Promise<void> {
  await applyOnce(deps, envelope, context, async () => {
    const payload = envelope.payload as Partial<PaymentRefundedPayload>
    const amount = usableAmount(payload.amount)

    await bumpPaymentOutcomes(deps.store, {
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
  await applyOnce(deps, envelope, context, async () => {
    await bumpFunnel(deps.store, { reserved: 1 })
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
  await applyOnce(deps, envelope, context, async () => {
    const payload = envelope.payload as Partial<InventoryInsufficientPayload>
    const shortfalls = Array.isArray(payload.shortfalls) ? payload.shortfalls.length : 0
    await bumpFunnel(deps.store, { insufficient: 1 })
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
