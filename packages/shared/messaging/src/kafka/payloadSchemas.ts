import { Type, type TSchema } from '@sinclair/typebox'
import Ajv from 'ajv'
import { EVENT_TYPES, type EventType } from './topics'

/**
 * Payload contracts for every event type on the backbone (plan 4.4).
 *
 * `parseEnvelope` validates only the envelope; until now each consumer
 * hand-checked the few payload fields it happened to read. These schemas are
 * the single statement of what a payload must look like, derived from the
 * interfaces in events.ts, so a hostile or corrupt payload is classified the
 * same way everywhere and can be recorded instead of retried forever.
 *
 * ── Deliberately tolerant of EXTRA fields ───────────────────────────────────
 * Types, ranges and required fields are strict; unknown properties are
 * allowed. A producer adding a field must not make every consumer reject its
 * events (the tolerant-reader rule). The events.ts interfaces remain the
 * compile-time check that the producers send what is declared here.
 *
 * Every string is length-bounded and every array is capped, so a payload
 * cannot be used to make a consumer allocate or loop without limit.
 */

const Id = Type.String({ minLength: 1, maxLength: 128 })
const Text = (max = 256) => Type.String({ minLength: 1, maxLength: max })
const Amount = Type.Number({ minimum: 0, maximum: 1_000_000_000 })
const Currency = Type.String({ minLength: 1, maxLength: 8 })
const Units = Type.Integer({ minimum: 1, maximum: 2_147_483_647 })
const MAX_LINES = 1000

const OrderLine = Type.Object({
  productId: Id,
  sku: Type.String({ maxLength: 128 }),
  quantity: Units,
  unitPrice: Amount,
  // Optional and backwards compatible; same pattern as ms-analytics' KEY_ID.
  categoryId: Type.Optional(Type.String({ pattern: '^[A-Za-z0-9_-]{1,64}$' })),
})

const StockLine = Type.Object({
  productId: Id,
  sku: Type.String({ maxLength: 128 }),
  quantity: Units,
})

const orderRef = { orderId: Id, orderNumber: Text(64) }

const lines = <T extends TSchema>(item: T) => Type.Array(item, { maxItems: MAX_LINES })

export const PAYLOAD_SCHEMAS: Readonly<Record<EventType, TSchema>> = {
  [EVENT_TYPES.orderCreated]: Type.Object({
    ...orderRef,
    userId: Id,
    customerEmail: Text(320),
    status: Text(32),
    totalAmount: Amount,
    currency: Currency,
    items: lines(OrderLine),
  }),
  [EVENT_TYPES.orderConfirmed]: Type.Object({
    ...orderRef,
    customerEmail: Text(320),
    customerName: Text(256),
    totalAmount: Amount,
    currency: Currency,
  }),
  [EVENT_TYPES.orderCancelled]: Type.Object({
    ...orderRef,
    reason: Type.String({ maxLength: 256 }),
    items: lines(OrderLine),
  }),
  [EVENT_TYPES.paymentCaptured]: Type.Object({
    ...orderRef,
    paymentId: Id,
    provider: Text(64),
    amount: Amount,
    currency: Currency,
  }),
  [EVENT_TYPES.paymentFailed]: Type.Object({
    ...orderRef,
    paymentId: Id,
    provider: Text(64),
    amount: Amount,
    currency: Currency,
    reason: Type.String({ maxLength: 256 }),
    attempt: Type.Integer({ minimum: 1, maximum: 1000 }),
  }),
  [EVENT_TYPES.paymentRefunded]: Type.Object({
    ...orderRef,
    paymentId: Id,
    amount: Amount,
    currency: Currency,
    reason: Type.String({ maxLength: 256 }),
  }),
  [EVENT_TYPES.inventoryReserved]: Type.Object({
    ...orderRef,
    reservations: lines(StockLine),
  }),
  [EVENT_TYPES.inventoryReleased]: Type.Object({
    ...orderRef,
    reason: Type.String({ maxLength: 256 }),
    releases: lines(StockLine),
  }),
  [EVENT_TYPES.inventoryInsufficient]: Type.Object({
    ...orderRef,
    shortfalls: lines(
      Type.Object({
        productId: Id,
        sku: Type.String({ maxLength: 128 }),
        requested: Units,
        available: Type.Integer({ minimum: 0, maximum: 2_147_483_647 }),
      })
    ),
  }),
}

// strict: true makes Ajv refuse a malformed SCHEMA (unknown keyword, ambiguous
// type) at compile time rather than quietly ignoring part of the contract.
// allErrors is off: stop at the first violation, which is all a log line needs.
const ajv = new Ajv({ strict: true, allErrors: false })
const validators = new Map(
  (Object.entries(PAYLOAD_SCHEMAS) as [EventType, TSchema][]).map(([type, schema]) => [
    type,
    ajv.compile(schema),
  ])
)

export type PayloadValidation = { ok: true } | { ok: false; reason: string }

/**
 * Checks a payload against its event type's schema.
 *
 * The reason names the failing path and rule only, never the offending value
 * (it can be anything an attacker put on the topic), so it is safe to log and
 * to store as an outcome. An event type with no schema is a failure: consumers
 * register handlers only for types they know, so reaching this means drift.
 */
export function validatePayload(eventType: string, payload: unknown): PayloadValidation {
  const validate = validators.get(eventType as EventType)
  if (!validate) return { ok: false, reason: `no payload schema for ${eventType}` }
  if (validate(payload)) return { ok: true }
  const e = validate.errors?.[0]
  const path = (e?.instancePath ?? '').replace(/^\//, '').replace(/\//g, '.') || '(root)'
  const missing =
    e?.keyword === 'required' && typeof e.params?.missingProperty === 'string'
      ? `:${e.params.missingProperty}`
      : ''
  return { ok: false, reason: `${path} ${e?.keyword ?? 'invalid'}${missing}` }
}
