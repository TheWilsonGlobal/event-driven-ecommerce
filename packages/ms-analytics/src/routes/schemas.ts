/**
 * JSON schemas for the analytics endpoints.
 *
 * ⚠️ EVERY nullable number here is `['number', 'null']`, and every one of them
 * must stay that way. Under a plain `{ type: 'number' }` Fastify's serializer
 * coerces null to 0 at the wire, far from the code that computed it — so
 * "no orders yet, so conversion is unmeasurable" would arrive at the client as
 * "0% conversion". That is not a rounding error, it is a fabricated metric
 * that looks like a five-alarm fire. The same trap is documented on
 * `lag`/`partitions` in the shared kafka schemas and on
 * `recentJobSchema.failedReason` for the string flavour (null -> "").
 *
 * Counts (`orders`, `created`, ...) are plain numbers on purpose: they are
 * always measured, and 0 genuinely means zero. The `eventsProcessed` /
 * `lastEventAt` pair carried on every response is what lets a reader tell a
 * measured zero from a service that has not processed anything yet.
 */

const nullableNumber = { type: ['number', 'null'] } as const
const nullableString = { type: ['string', 'null'] } as const

/**
 * Present on every analytics response.
 *
 * Not optional and not omitted when empty: a count is only interpretable
 * alongside evidence of whether anything has been counted at all.
 */
const progressProperties = {
  eventsProcessed: {
    type: 'number',
    description:
      'Events APPLIED to the aggregates, duplicates excluded. Durable (stored in ' +
      'NeDB), unlike the consumer counters on GET /api/v1/events which reset on ' +
      'restart. 0 together with a null lastEventAt means nothing has been processed.',
  },
  duplicatesSkipped: {
    type: 'number',
    description:
      'Redeliveries rejected by the eventId idempotency check. Non-zero is normal ' +
      'and is positive evidence that deduplication is actually firing.',
  },
  lastEventAt: {
    ...nullableString,
    format: 'date-time',
    description:
      'occurredAt of the newest applied event. null means nothing has ever been ' +
      'applied — NOT that the last event was at the epoch.',
  },
  lastProcessedAt: {
    ...nullableString,
    format: 'date-time',
    description: 'When this service last applied an event. null before the first one.',
  },
} as const

const progressRequired = [
  'eventsProcessed',
  'duplicatesSkipped',
  'lastEventAt',
  'lastProcessedAt',
] as const

export const summaryResponseSchema = {
  type: 'object',
  properties: {
    ...progressProperties,
    orders: { type: 'number', description: 'order.created events applied.' },
    confirmed: { type: 'number' },
    cancelled: { type: 'number' },
    revenue: {
      type: 'number',
      description:
        'Sum of order.created totalAmount. Orders whose totalAmount was missing or ' +
        'unusable contributed nothing (not zero), so this is a lower bound.',
    },
    currency: {
      ...nullableString,
      description:
        'The currency the revenue is denominated in, from the first priced event ' +
        'observed. null when no priced event has ever landed — never defaulted.',
    },
    averageOrderValue: {
      ...nullableNumber,
      description: 'revenue / orders. null when no orders have been counted, never 0.',
    },
    payments: {
      type: 'object',
      properties: {
        captured: { type: 'number' },
        failed: { type: 'number' },
        refunded: { type: 'number' },
        capturedAmount: { type: 'number', description: 'From payment.captured amounts only.' },
        refundedAmount: {
          type: 'number',
          description:
            'From payment.refunded amounts only. NOT netted against capturedAmount — ' +
            'a refund is a separate fact with its own timestamp.',
        },
        successRate: {
          ...nullableNumber,
          description:
            'captured / (captured + failed). null when no payment was ever attempted; ' +
            'a 0 here would read as total payment failure.',
        },
      },
      required: [
        'captured',
        'failed',
        'refunded',
        'capturedAmount',
        'refundedAmount',
        'successRate',
      ],
    },
    windowStart: {
      ...nullableString,
      description:
        'Oldest hour bucket that exists, as YYYY-MM-DDTHH in UTC. null before the ' +
        'first event. This is the real extent of the data, not a requested range.',
    },
    windowEnd: { ...nullableString, description: 'Newest hour bucket that exists.' },
  },
  required: [
    ...progressRequired,
    'orders',
    'confirmed',
    'cancelled',
    'revenue',
    'currency',
    'averageOrderValue',
    'payments',
    'windowStart',
    'windowEnd',
  ],
} as const

export const revenueResponseSchema = {
  type: 'object',
  properties: {
    ...progressProperties,
    hours: { type: 'number', description: 'The requested window size, echoed back.' },
    windowStart: {
      ...nullableString,
      description: 'Oldest hour IN THE SERIES. null when the window contains no buckets.',
    },
    windowEnd: { ...nullableString },
    totalRevenue: { type: 'number' },
    totalOrders: { type: 'number' },
    series: {
      type: 'array',
      description:
        'One entry per hour that has data. Hours with no events are ABSENT rather ' +
        'than zero-filled: "no orders that hour" and "the service was not running ' +
        'that hour" are different claims and the store cannot distinguish them.',
      items: {
        type: 'object',
        properties: {
          hourKey: { type: 'string', description: 'YYYY-MM-DDTHH in UTC.' },
          orders: { type: 'number' },
          confirmed: { type: 'number' },
          cancelled: { type: 'number' },
          revenue: { type: 'number' },
          currency: {
            ...nullableString,
            description: 'null when no priced event landed in this hour.',
          },
        },
        required: ['hourKey', 'orders', 'confirmed', 'cancelled', 'revenue', 'currency'],
      },
    },
  },
  required: [
    ...progressRequired,
    'hours',
    'windowStart',
    'windowEnd',
    'totalRevenue',
    'totalOrders',
    'series',
  ],
} as const

export const topProductsResponseSchema = {
  type: 'object',
  properties: {
    ...progressProperties,
    limit: { type: 'number' },
    totalProducts: {
      type: 'number',
      description: 'Products with any counter at all, before the limit was applied.',
    },
    products: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          productId: { type: 'string' },
          sku: { type: 'string' },
          unitsOrdered: { type: 'number' },
          timesOrdered: {
            type: 'number',
            description: 'Distinct orders this product appeared on.',
          },
          revenue: {
            type: 'number',
            description:
              'quantity * unitPrice summed over lines. Lines missing either factor ' +
              'contributed nothing rather than zero.',
          },
          averageUnitPrice: {
            ...nullableNumber,
            description: 'revenue / unitsOrdered. null when no units were counted, never 0.',
          },
        },
        required: [
          'productId',
          'sku',
          'unitsOrdered',
          'timesOrdered',
          'revenue',
          'averageUnitPrice',
        ],
      },
    },
  },
  required: [...progressRequired, 'limit', 'totalProducts', 'products'],
} as const

export const funnelResponseSchema = {
  type: 'object',
  properties: {
    ...progressProperties,
    created: { type: 'number' },
    confirmed: { type: 'number' },
    cancelled: { type: 'number' },
    reserved: { type: 'number' },
    insufficient: { type: 'number' },
    conversion: {
      type: 'object',
      description:
        'Every ratio is null when its denominator is zero. NEVER 0 and never NaN — ' +
        'see the warning at the top of this file.',
      properties: {
        createdToConfirmed: { ...nullableNumber, description: 'confirmed / created.' },
        createdToCancelled: { ...nullableNumber, description: 'cancelled / created.' },
        createdToReserved: { ...nullableNumber, description: 'reserved / created.' },
        reservationShortfallRate: {
          ...nullableNumber,
          description:
            'insufficient / (reserved + insufficient) — the share of reservation ' +
            'ATTEMPTS that failed. Denominated on attempts, not on created, because ' +
            'an order can be created with no reservation ever attempted.',
        },
      },
      required: [
        'createdToConfirmed',
        'createdToCancelled',
        'createdToReserved',
        'reservationShortfallRate',
      ],
    },
  },
  required: [
    ...progressRequired,
    'created',
    'confirmed',
    'cancelled',
    'reserved',
    'insufficient',
    'conversion',
  ],
} as const

export const badRequestSchema = {
  type: 'object',
  properties: {
    error: { type: 'string' },
    message: { type: 'string' },
  },
  required: ['error', 'message'],
} as const
