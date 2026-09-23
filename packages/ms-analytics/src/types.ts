/**
 * The four aggregate shapes plus the idempotency ledger, as they are stored.
 *
 * Every one carries an explicit `id` because EmbeddedDocumentStore mirrors
 * `id` into nedb's `_id` on insert — giving each document a NATURAL key
 * (the hour, the productId, the eventId) rather than a generated one. That
 * is what makes an upsert a single `update({ id }, ...)`, and what makes the
 * idempotency check below a single `findOne({ id: eventId })`.
 */

/** Idempotency ledger. One row per eventId this service has already applied. */
export interface ProcessedEventDoc {
  /** === envelope.eventId. The whole point: the natural key IS the dedupe key. */
  id?: string | undefined
  _id?: string | undefined
  eventType: string
  /** When the FACT occurred (envelope.occurredAt), not when we consumed it. */
  occurredAt: string
  /** When this service applied it. The gap between the two is consumer lag. */
  processedAt: string
  topic: string
  partition: number
  offset: string
}

/**
 * One hour of order activity.
 *
 * `revenue` accumulates only from events that genuinely carry money. An hour
 * in which orders were created but none carried a usable totalAmount has
 * `orders > 0` and `revenue === 0` — and that 0 is a MEASURED zero (nothing
 * was contributed), not a stand-in for "unknown". See handlers.ts for why the
 * distinction is enforced at the contribution site rather than here.
 */
export interface HourBucketDoc {
  /** 'YYYY-MM-DDTHH' in UTC — the natural key, and also sortable as a string. */
  id?: string | undefined
  _id?: string | undefined
  hourKey: string
  orders: number
  confirmed: number
  cancelled: number
  revenue: number
  /**
   * The currency the revenue in this bucket is denominated in, or null when no
   * priced event has landed in it yet. Deliberately NOT defaulted to 'USD':
   * labelling an empty bucket with a currency we never observed is a
   * fabrication, and mixing two currencies into one float would be worse.
   */
  currency: string | null
}

/** Per-product counters, keyed on productId. */
export interface ProductCounterDoc {
  id?: string | undefined
  _id?: string | undefined
  productId: string
  sku: string
  /** Sum of line-item quantities across orders. */
  unitsOrdered: number
  /** Number of distinct orders this product appeared in. */
  timesOrdered: number
  /**
   * quantity * unitPrice summed over lines. Contributed only when BOTH are
   * present on the line — a line missing unitPrice adds units but no revenue.
   */
  revenue: number
}

/** Payment outcomes. A singleton document. */
export interface PaymentOutcomeDoc {
  id?: string | undefined
  _id?: string | undefined
  captured: number
  failed: number
  refunded: number
  /** Money actually taken. From payment.captured amounts only. */
  capturedAmount: number
  /**
   * Money given back. From payment.refunded amounts only.
   *
   * NOT subtracted from capturedAmount: a refund is a separate fact with its
   * own timestamp, and netting the two would destroy the ability to tell
   * "we captured 100 and refunded 40" from "we captured 60".
   */
  refundedAmount: number
}

/** The five funnel counts. A singleton document. */
export interface FunnelDoc {
  id?: string | undefined
  _id?: string | undefined
  created: number
  confirmed: number
  cancelled: number
  reserved: number
  insufficient: number
}

/**
 * Service-wide progress marker. A singleton.
 *
 * Exists so every response can distinguish "I have processed nothing yet"
 * (eventsProcessed === 0, lastEventAt === null) from "every counter is
 * genuinely zero". Without it a cold service and a service that consumed a
 * thousand no-op events render identically — which is the same defect the
 * queue endpoints were built to avoid.
 */
export interface ProgressDoc {
  id?: string | undefined
  _id?: string | undefined
  /** Events APPLIED (duplicates excluded). Durable, unlike the consumer's counters. */
  eventsProcessed: number
  /** Duplicates skipped by the idempotency check. Proof it is doing something. */
  duplicatesSkipped: number
  /** occurredAt of the most recent applied event. null until the first one. */
  lastEventAt: string | null
  /** When this service last applied anything. null until the first one. */
  lastProcessedAt: string | null
}
