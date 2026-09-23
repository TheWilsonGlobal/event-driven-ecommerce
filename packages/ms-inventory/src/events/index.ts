export { eventProducer, kafkaAdminClient, kafkaSettings, LOG_PREFIX } from './producer'
export { createInventoryConsumer } from './consumer'
export { registerEventRoutes } from './routes'
export {
  handleOrderCreated,
  handleOrderCancelled,
  releaseReservation,
  type HandlerDeps,
} from './handlers'
export {
  publishInventoryReserved,
  publishInventoryReleased,
  publishInventoryInsufficient,
  type FanOutResult,
} from './publishers'
