import {
  Bounded,
  CountryCode,
  CurrencyCode,
  Email,
  EntityId,
  ErrorResponse,
  Money,
  Quantity,
  Str,
  Strict,
  Type,
  type Static,
} from '@ecommerce/shared-security'

/**
 * Request and response contracts for ms-order (pillar 1).
 *
 * Request schemas are closed (`additionalProperties: false`): an unknown field,
 * including `userId`, is a 400, not silently dropped. Response schemas are
 * closed too, so a new database column can never leak through an endpoint.
 */

/**
 * A client-DERIVED money amount in major units: bounded and non-negative, but
 * deliberately NOT two-decimal. The storefront computes tax (8%), discount and
 * total from float arithmetic and sends them unrounded (e.g. 12.3456), so
 * shared-security's `Money` (`multipleOf: 0.01`) would reject real checkouts.
 * They are rounded to cents on the server and compared with a 0.01 tolerance
 * (see pricing/). Catalogue-sourced amounts (unitPrice, subtotal, shipping) use
 * the shared `Money`.
 */
export const ClientAmount = Type.Number({ minimum: 0, maximum: 1_000_000 })

export const PAYMENT_METHODS = ['STRIPE', 'PAYPAL', 'MOCK'] as const
export const PaymentMethodField = Type.Unsafe<(typeof PAYMENT_METHODS)[number]>({
  type: 'string',
  enum: [...PAYMENT_METHODS],
})

export const ORDER_STATUS_VALUES = [
  'PENDING',
  'CONFIRMED',
  'PROCESSING',
  'SHIPPED',
  'DELIVERED',
  'CANCELLED',
] as const
export const OrderStatusField = Type.Unsafe<(typeof ORDER_STATUS_VALUES)[number]>({
  type: 'string',
  enum: [...ORDER_STATUS_VALUES],
})

// ── Requests ────────────────────────────────────────────────────────────────

export const OrderLineBody = Strict({
  productId: EntityId,
  sku: Str(64),
  title: Str(200),
  unitPrice: Money,
  quantity: Quantity,
  /** Optional: lets ms-analytics rank categories. Same shape as its KEY_ID. */
  categoryId: Type.Optional(Type.String({ pattern: '^[A-Za-z0-9_-]{1,64}$' })),
})

export const ShippingAddressBody = Strict({
  addressLine1: Str(200),
  city: Str(100),
  state: Str(100),
  postalCode: Str(20),
  country: CountryCode,
})

/** No `userId`: the owner is the verified token's subject, never the body. */
export const CreateOrderBodySchema = Strict({
  idempotencyKey: Type.Optional(Str(128)),
  paymentPreCaptured: Type.Optional(Type.Boolean()),
  customerName: Str(200),
  customerEmail: Email,
  items: Bounded(OrderLineBody, 100, 1),
  shippingAddress: ShippingAddressBody,
  paymentMethod: PaymentMethodField,
  subtotal: Money,
  taxAmount: Type.Optional(ClientAmount),
  shippingAmount: Type.Optional(Money),
  discountAmount: Type.Optional(ClientAmount),
  totalAmount: ClientAmount,
  currency: Type.Optional(CurrencyCode),
})
export type CreateOrderBodyT = Static<typeof CreateOrderBodySchema>

export const CreateOrderHeaders = Type.Object({
  'idempotency-key': Type.Optional(Str(128)),
})

export const OrderListQuery = Strict({
  page: Type.Integer({ minimum: 1, maximum: 10_000, default: 1 }),
  limit: Type.Integer({ minimum: 1, maximum: 100, default: 20 }),
})

/** An order id (cuid/uuid) or an order number (ORD-123456). */
export const OrderRefParams = Strict({ id: EntityId })

export const OrderStatusBody = Strict({ status: OrderStatusField })

export const CaptureParams = Strict({ orderId: EntityId })
export const CaptureBody = Strict({
  outcome: Type.Optional(
    Type.Unsafe<'succeed' | 'fail'>({ type: 'string', enum: ['succeed', 'fail'] })
  ),
})

export const SagaFailureBody = Strict({
  step: Str(100),
  compensation: Type.Unsafe<'release-inventory' | 'refund-payment'>({
    type: 'string',
    enum: ['release-inventory', 'refund-payment'],
  }),
  reason: Type.Optional(Str(500)),
})

export const LogFileParams = Strict({ filename: Str(255) })

// ── Responses ───────────────────────────────────────────────────────────────

const closed = { additionalProperties: false }

export const OrderItemOut = Type.Object(
  {
    productId: Type.String(),
    sku: Type.String(),
    title: Type.String(),
    unitPrice: Type.Number(),
    quantity: Type.Integer(),
    totalPrice: Type.Number(),
    imageUrl: Type.Optional(Type.String()),
  },
  closed
)

// Optional on purpose: seeded rows predate the address contract and a missing
// key must not make the serializer throw for an otherwise valid order.
export const AddressOut = Type.Object(
  {
    addressLine1: Type.Optional(Type.String()),
    city: Type.Optional(Type.String()),
    state: Type.Optional(Type.String()),
    postalCode: Type.Optional(Type.String()),
    country: Type.Optional(Type.String()),
  },
  closed
)

export const OrderOut = Type.Object(
  {
    id: Type.String(),
    orderNumber: Type.String(),
    customerId: Type.String(),
    customerName: Type.String(),
    customerEmail: Type.String(),
    status: Type.String(),
    subtotal: Type.Number(),
    taxAmount: Type.Number(),
    shippingAmount: Type.Number(),
    discountAmount: Type.Number(),
    totalAmount: Type.Number(),
    currency: Type.String(),
    paymentMethod: Type.String(),
    paymentStatus: Type.String(),
    transactionId: Type.String(),
    shippingAddress: AddressOut,
    items: Type.Array(OrderItemOut),
    createdAt: Type.String(),
    updatedAt: Type.String(),
    receiptUrl: Type.Optional(Type.String()),
  },
  closed
)

export const OrderListOut = Type.Object(
  {
    orders: Type.Array(OrderOut),
    total: Type.Integer(),
    page: Type.Integer(),
    limit: Type.Integer(),
  },
  closed
)

export const CaptureOut = Type.Object(
  {
    orderId: Type.String(),
    orderNumber: Type.String(),
    captured: Type.Boolean(),
    orderStatus: Type.String(),
    // ['string','null'] on purpose: a plain string type would serialise null as "".
    retryJobId: Type.Optional(Type.Unsafe<string | null>({ type: ['string', 'null'] })),
    retryEnqueued: Type.Optional(Type.Boolean()),
    simulated: Type.Boolean(),
  },
  closed
)

export const SagaFailureOut = Type.Object(
  {
    orderId: Type.String(),
    orderNumber: Type.String(),
    failedStep: Type.String(),
    compensation: Type.String(),
    jobId: Type.String(),
  },
  closed
)

export const CartOut = Type.Object(
  {
    items: Type.Array(Type.Object({}, closed)),
    subtotal: Type.Number(),
    total: Type.Number(),
  },
  closed
)

export { ErrorResponse }
