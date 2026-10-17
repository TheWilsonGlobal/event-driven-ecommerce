import {
  EVENT_TYPES,
  TOPICS,
  enqueueOutboxEvent,
  type InventoryInsufficientPayload,
  type InventoryReleasedPayload,
  type InventoryReservedPayload,
} from '@ecommerce/shared-messaging'
import type { Tx } from '../db/store'

/**
 * Typed outbox-write helpers for ms-inventory's events.
 *
 * Nothing here talks to Kafka. Each helper INSERTs rows into
 * ms_inventory.outbox_events on the caller's transaction client, so the fact
 * and the stock movement it describes commit together or not at all; the
 * OutboxRelay (src/outbox) sends them afterwards. That retires the old
 * publish-after-commit contract, where `tryPublish` swallowed a broker outage
 * and a crash between the write and the publish lost the event.
 *
 * The eventId is minted here, once, inside the transaction, and stored with the
 * envelope. A relay retry re-sends that same envelope, so consumers can dedupe
 * on eventId alone.
 *
 * ── One row PER PRODUCT, not one per event ──────────────────────────────────
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
 * backwards. So each product in the event gets its OWN outbox row, keyed on its
 * own productId, carrying only that product's slice of the payload. The
 * orderId/orderNumber on every row is what lets a consumer stitch the fan-out
 * back into one logical fact.
 *
 * The fan-out is now ATOMIC: all of an order's rows are inserted in the same
 * transaction, so a failure partway no longer publishes some products' messages
 * and not others. The relay keys its ordering check on partition_key, so rows
 * for one product are delivered in insert order.
 */

const PRODUCER = 'ms-inventory'

/** Outbox rows written by one helper call, so callers can log truthfully. */
export interface EnqueueResult {
  enqueued: number
}

export async function enqueueInventoryReserved(
  tx: Tx,
  payload: InventoryReservedPayload,
  correlationId?: string
): Promise<EnqueueResult> {
  for (const reservation of payload.reservations) {
    await enqueueOutboxEvent(tx, tx.schema, {
      producer: PRODUCER,
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
  }
  return { enqueued: payload.reservations.length }
}

export async function enqueueInventoryReleased(
  tx: Tx,
  payload: InventoryReleasedPayload,
  correlationId?: string
): Promise<EnqueueResult> {
  for (const release of payload.releases) {
    await enqueueOutboxEvent(tx, tx.schema, {
      producer: PRODUCER,
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
  }
  return { enqueued: payload.releases.length }
}

/**
 * inventory.insufficient — keyed per shortfall product for the same reason.
 *
 * Only the products that were actually short are written. The products that
 * had enough stock had NOTHING happen to them (the reserve is all-or-nothing),
 * so emitting a row on their partitions would put a movement on the log that
 * never occurred.
 */
export async function enqueueInventoryInsufficient(
  tx: Tx,
  payload: InventoryInsufficientPayload,
  correlationId?: string
): Promise<EnqueueResult> {
  for (const shortfall of payload.shortfalls) {
    await enqueueOutboxEvent(tx, tx.schema, {
      producer: PRODUCER,
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
  }
  return { enqueued: payload.shortfalls.length }
}
