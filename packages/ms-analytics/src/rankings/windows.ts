/**
 * Ranking windows and their rotating buckets.
 *
 * A sliding window cannot be a single ZSET (nothing ages members out of one),
 * so each window is a ring of fixed-size bucket ZSETs. Every bucket carries an
 * absolute expiry (bucket end + window + one spare bucket), which bounds memory
 * without any cleanup job: once a bucket is older than the window it is gone.
 * A read unions the live buckets into the public key `rank:global:{window}`
 * (or `rank:cat:{id}:{window}`).
 *
 * The window is therefore accurate to one bucket: it covers between
 * (window - bucket) and window of history.
 */

export const WINDOWS = ['1h', '24h', '7d'] as const
export type RankWindow = (typeof WINDOWS)[number]

const MINUTE = 60_000
const HOUR = 60 * MINUTE

export interface WindowSpec {
  windowMs: number
  bucketMs: number
}

export const WINDOW_SPECS: Record<RankWindow, WindowSpec> = {
  '1h': { windowMs: HOUR, bucketMs: MINUTE }, // 60 buckets
  '24h': { windowMs: 24 * HOUR, bucketMs: 30 * MINUTE }, // 48 buckets
  '7d': { windowMs: 7 * 24 * HOUR, bucketMs: 6 * HOUR }, // 28 buckets
}

export const LONGEST_WINDOW_MS = WINDOW_SPECS['7d'].windowMs

/** Ids that may appear inside a Redis key. Anything else is skipped, not escaped. */
export const KEY_ID = /^[A-Za-z0-9_-]{1,64}$/

export const bucketIndex = (ms: number, spec: WindowSpec): number => Math.floor(ms / spec.bucketMs)

/** Bucket indexes that make up the window ending at `nowMs`, oldest first. */
export function liveBuckets(nowMs: number, spec: WindowSpec): number[] {
  const current = bucketIndex(nowMs, spec)
  const count = spec.windowMs / spec.bucketMs
  const out: number[] = []
  for (let i = current - count + 1; i <= current; i++) out.push(i)
  return out
}

/** Absolute expiry (epoch ms) for a bucket: it is dead once it leaves the window. */
export const bucketExpiryMs = (bucket: number, spec: WindowSpec): number =>
  (bucket + 2) * spec.bucketMs + spec.windowMs

/** True when an event at `occurredMs` still belongs to the window ending at `nowMs`. */
export function inWindow(occurredMs: number, nowMs: number, spec: WindowSpec): boolean {
  const b = bucketIndex(occurredMs, spec)
  const current = bucketIndex(nowMs, spec)
  return b >= current - spec.windowMs / spec.bucketMs + 1 && b <= current
}
