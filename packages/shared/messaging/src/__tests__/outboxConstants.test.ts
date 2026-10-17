import { loadOutboxEnv } from '../outbox/relay'
import { OUTBOX_DEFAULTS } from '@ecommerce/shared-constants'

describe('outbox relay defaults', () => {
  it('equal the values that used to be literals in loadOutboxEnv / .env', () => {
    expect(loadOutboxEnv({})).toEqual({
      pollMs: 500,
      batch: 50,
      maxAttempts: 10,
      leaseMs: 60_000,
      sendTimeoutMs: 10_000,
    })
    expect(OUTBOX_DEFAULTS.leaseMs).toBeGreaterThan(OUTBOX_DEFAULTS.sendTimeoutMs)
  })

  it('still lets the environment override every value', () => {
    expect(
      loadOutboxEnv({
        OUTBOX_POLL_MS: '100',
        OUTBOX_BATCH: '7',
        OUTBOX_MAX_ATTEMPTS: '3',
        OUTBOX_LEASE_MS: '9000',
        OUTBOX_SEND_TIMEOUT_MS: '2000',
      })
    ).toEqual({ pollMs: 100, batch: 7, maxAttempts: 3, leaseMs: 9000, sendTimeoutMs: 2000 })
  })
})
