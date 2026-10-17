import { orderExpirationDelayMs } from '../queues/definitions'
import { ORDER_EXPIRATION_MINUTES_DEFAULT } from '@ecommerce/shared-constants'

describe('orderExpirationDelayMs', () => {
  const saved = process.env.BULLMQ_ORDER_EXPIRATION_MINUTES
  afterEach(() => {
    if (saved === undefined) delete process.env.BULLMQ_ORDER_EXPIRATION_MINUTES
    else process.env.BULLMQ_ORDER_EXPIRATION_MINUTES = saved
  })

  it('defaults to 15 minutes when the env var is unset', () => {
    delete process.env.BULLMQ_ORDER_EXPIRATION_MINUTES
    expect(ORDER_EXPIRATION_MINUTES_DEFAULT).toBe(15)
    expect(orderExpirationDelayMs()).toBe(15 * 60 * 1000)
  })

  it('lets the env override and ignores garbage', () => {
    process.env.BULLMQ_ORDER_EXPIRATION_MINUTES = '2'
    expect(orderExpirationDelayMs()).toBe(2 * 60 * 1000)
    process.env.BULLMQ_ORDER_EXPIRATION_MINUTES = 'abc'
    expect(orderExpirationDelayMs()).toBe(15 * 60 * 1000)
  })
})
