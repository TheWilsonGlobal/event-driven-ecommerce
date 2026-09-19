/**
 * Extracts a usable message from an error.
 *
 * Node's ECONNREFUSED for a multi-address host (localhost resolves to both ::1
 * and 127.0.0.1) arrives as an AggregateError whose own `.message` is an EMPTY
 * STRING — the detail lives in `.errors[]`. Interpolating `.message` directly
 * yields "Redis is unreachable: " with nothing after the colon, which is
 * useless in a 503 body. Unwrap the aggregate, and fall back to the error's
 * code/name when it has no message at all.
 *
 * Lives in its own module so both redisConnection.ts and callers elsewhere can
 * use it without an import cycle.
 */
export function describeError(err: unknown): string {
  if (!(err instanceof Error)) {
    return String(err)
  }

  if (err.message) {
    return err.message
  }

  const aggregate = err as Error & { errors?: unknown[]; code?: string }
  if (Array.isArray(aggregate.errors) && aggregate.errors.length > 0) {
    const inner = aggregate.errors
      .map((e) => (e instanceof Error ? e.message : String(e)))
      .filter((m) => m.length > 0)
    if (inner.length > 0) {
      // De-duplicate: both address families usually report the same thing.
      return [...new Set(inner)].join('; ')
    }
  }

  if (aggregate.code) {
    return `${err.name} (${aggregate.code})`
  }
  return err.name
}
