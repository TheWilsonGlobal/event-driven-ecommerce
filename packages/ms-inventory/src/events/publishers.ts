import {
  EVENT_TYPES,
  TOPICS,
  type InventoryInsufficientPayload,
  type InventoryReleasedPayload,
  type InventoryReservedPayload,
} from '@ecommerce/shared-messaging'
import { eventProducer } from './producer'

/**
 * Typed publish helpers for ms-inventory's events.
 *
 * Every one uses `tryPublish`, so a broker outage is logged, counted and
 * swallowed — it can never retroactively fail a stock movement already
 * committed to NeDB. Same contract as ms-order's publishers, same known
 * consequence: a crash between the write and the publish loses the event
 * (at-most-once, no outbox), and the loss shows up as `publishFailures` on
 * GET /api/v1/events rather than being hidden.
 *
 * ── One message PER PRODUCT, not one per event ──────────────────────────────
 * TOPIC_DEFINITIONS declares ecommerce.inventory.v1 as keyed on `productId`,
 * because the contended resource here is the product: what a consumer needs
 * ordered is the sequence of movements on ONE product's stock, not the
 * sequence of orders.
 *
 * An inventory fact, though, covers a whole order and therefore several
 * products. Publishing it as a single message would force one arbitrary key —
 * some product in the list, or the orderId — and the guarantee would be a lie:
 * two concurrent orders touching prod-1 could land on different partitions and
 * be consumed out of order, so a reserve and its release could be seen
 * backwards. So each product in the event gets its OWN message, keyed on its
 * own productId, carrying only that product's slice of the payload. The
 * orderId/orderNumber on every message is what lets a consumer stitch the
 * fan-out back into one logical fact.
 *
 * The cost is that the fan-out is not atomic: a broker failure partway through
 * publishes some products' messages and not others. That is visible in
 * `publishFailures` and is the same at-most-once trade the single-message path
 * already makes — it is not made worse by splitting.
 */

/** Total messages attempted vs. actually accepted, so callers can log truthfully. */
export interface FanOutResult {
  attempted: number
  published: number
}

export async function publishInventoryReserved(
  payload: InventoryReservedPayload,
  correlationId?: string
): Promise<FanOutResult> {
  let published = 0
  for (const reservation of payload.reservations) {
    const envelope = await eventProducer.tryPublish({
      topic: TOPICS.inventory,
      eventType: EVENT_TYPES.inventoryReserved,
      key: reservation.productId,
      // Only this product's slice. A consumer keyed on productId has no use
      // for the other lines, and carrying them would make the same fact
      // appear once per product in any naive aggregation.
      payload: {
        orderId: payload.orderId,
        orderNumber: payload.orderNumber,
        reservations: [reservation],
      } satisfies InventoryReservedPayload,
      correlationId,
    })
    if (envelope) {
      published += 1
    }
  }
  return { attempted: payload.reservations.length, published }
}

export async function publishInventoryReleased(
  payload: InventoryReleasedPayload,
  correlationId?: string
): Promise<FanOutResult> {
  let published = 0
  for (const release of payload.releases) {
    const envelope = await eventProducer.tryPublish({
      topic: TOPICS.inventory,
      eventType: EVENT_TYPES.inventoryReleased,
      key: release.productId,
      payload: {
        orderId: payload.orderId,
        orderNumber: payload.orderNumber,
        reason: payload.reason,
        releases: [release],
      } satisfies InventoryReleasedPayload,
      correlationId,
    })
    if (envelope) {
      published += 1
    }
  }
  return { attempted: payload.releases.length, published }
}

/**
 * inventory.insufficient — keyed per shortfall product for the same reason.
 *
 * Only the products that were actually short are published. The products that
 * had enough stock had NOTHING happen to them (the reserve is all-or-nothing),
 * so emitting a message on their partitions would put a movement on the log
 * that never occurred.
 */
export async function publishInventoryInsufficient(
  payload: InventoryInsufficientPayload,
  correlationId?: string
): Promise<FanOutResult> {
  let published = 0
  for (const shortfall of payload.shortfalls) {
    const envelope = await eventProducer.tryPublish({
      topic: TOPICS.inventory,
      eventType: EVENT_TYPES.inventoryInsufficient,
      key: shortfall.productId,
      payload: {
        orderId: payload.orderId,
        orderNumber: payload.orderNumber,
        shortfalls: [shortfall],
      } satisfies InventoryInsufficientPayload,
      correlationId,
    })
    if (envelope) {
      published += 1
    }
  }
  return { attempted: payload.shortfalls.length, published }
}
