import { CONSUMER_GROUPS, EVENT_TYPES, EventConsumer, TOPICS } from '@ecommerce/shared-messaging'
import { handleOrderCancelled, handleOrderCreated, type HandlerDeps } from './handlers'
import { LOG_PREFIX } from './producer'

/**
 * ms-inventory's Kafka consumer: one group, one topic, two event types.
 *
 * ── fromBeginning: false ────────────────────────────────────────────────────
 * On a first run this group has no committed offsets, and `fromBeginning`
 * decides whether it then reads the topic from its start or only from now.
 * Reading from the start would replay every order the log still retains and
 * reserve stock for orders long since shipped or cancelled — the reservations
 * would be real, the stock would be gone, and nothing would ever release it
 * because the corresponding order.cancelled events (if any) were consumed in
 * the same replay and are already accounted for. ms-analytics makes the
 * opposite choice for the opposite reason: it is a pure aggregate over
 * history, so it should see everything that ever happened.
 *
 * The flag only matters on that first run; once offsets exist Kafka resumes
 * from them. It is not a replay switch.
 *
 * ── One group per service ───────────────────────────────────────────────────
 * groupId comes from CONSUMER_GROUPS and is ms-inventory's alone. Sharing it
 * with another service would split the partitions between them, so each would
 * see roughly half the orders — presenting as random, intermittent stock that
 * never got reserved.
 *
 * ── Subscribing to a whole topic means seeing events we ignore ──────────────
 * ecommerce.orders.v1 also carries order.confirmed, for which no handler is
 * registered. The consumer counts those as `skipped`, which is the honest
 * label: nothing failed, this service simply does not care.
 */
export function createInventoryConsumer(deps: HandlerDeps): EventConsumer {
  const consumer = new EventConsumer({
    groupId: CONSUMER_GROUPS.inventory,
    topics: [TOPICS.orders],
    fromBeginning: false,
    logPrefix: LOG_PREFIX,
    clientId: 'ms-inventory',
  })

  consumer.on(EVENT_TYPES.orderCreated, async (envelope) => {
    await handleOrderCreated(envelope, deps)
  })

  consumer.on(EVENT_TYPES.orderCancelled, async (envelope) => {
    await handleOrderCancelled(envelope, deps)
  })

  return consumer
}
