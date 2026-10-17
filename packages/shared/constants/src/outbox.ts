/**
 * Outbox relay tunables. Non-secret and identical across environments, so they
 * live in code; each can still be overridden by the matching env var
 * (OUTBOX_POLL_MS, OUTBOX_BATCH, OUTBOX_MAX_ATTEMPTS, OUTBOX_LEASE_MS,
 * OUTBOX_SEND_TIMEOUT_MS) read by loadOutboxEnv.
 */
export const OUTBOX_DEFAULTS = {
  /** Idle poll interval between drain passes. */
  pollMs: 500,
  /** Max rows claimed per pass. */
  batch: 50,
  /** Failed sends before a row is parked. */
  maxAttempts: 10,
  /** Claim lease; must be greater than sendTimeoutMs or the relay refuses to boot. */
  leaseMs: 60_000,
  /** Per-send Kafka timeout. */
  sendTimeoutMs: 10_000,
} as const
