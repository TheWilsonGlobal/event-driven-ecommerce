export { eventProducer, kafkaAdminClient, kafkaSettings, LOG_PREFIX } from './producer'
export { createInventoryConsumer } from './consumer'
export { registerEventRoutes } from './routes'
export {
  handleOrderCreated,
  handleOrderCancelled,
  releaseReservation,
  type HandlerDeps,
  type ReleaseResult,
} from './handlers'
export {
  enqueueInventoryReserved,
  enqueueInventoryReleased,
  enqueueInventoryInsufficient,
  type EnqueueResult,
} from './publishers'
