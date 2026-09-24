import { useCallback, useState } from 'react'
import { isFetchError, type FetchError } from './useQueueData'
import { ORDER_SERVICE_URL } from '../data/serviceUrls'

/**
 * Persisting KAFKA_ENABLED, and being honest about what that achieves.
 *
 * ── The one thing this hook must never do ───────────────────────────────────
 * Report Kafka as ON because the toggle was flipped. KAFKA_ENABLED is read at
 * module import time by every service on the backbone; when it is false they
 * construct no client at all. A write to .env therefore changes what the NEXT
 * boot does and nothing about the processes currently running.
 *
 * So `enabled` (persisted) and `runtimeEnabled` (what the process is actually
 * running) are kept as separate fields all the way to the UI, exactly as the
 * backend returns them. The status chip reads `runtimeEnabled`; only the
 * restart notice reads `enabled`. Collapsing them into one boolean would make
 * the admin claim a live backbone that does not exist — the same defect class
 * as rendering an unmeasured lag as 0.
 *
 * The write is owned by ms-order (the backbone's producer). One write
 * reconfigures all three services, because they all read the same repo-root
 * .env at their own boot.
 */

const CONFIG_URL = `${ORDER_SERVICE_URL}/api/v1/events/config`
const REQUEST_TIMEOUT_MS = 5000

/** The backend's PATCH response. Field-for-field kafkaConfigResponseSchema. */
export interface KafkaConfigResult {
  /** The value now persisted in .env. */
  enabled: boolean
  /** What the ms-order process actually booted with. Unchanged by the write. */
  runtimeEnabled: boolean
  /** True when the two disagree — i.e. a restart is outstanding. */
  restartRequired: boolean
  envPath: string
  timestamp: string
}

export interface KafkaConfigResource {
  /**
   * The outcome of the most recent successful write this session, or null if
   * the operator has not changed anything yet. Deliberately NOT seeded from
   * build-time config: before a write there is nothing to report, and a seeded
   * value would render a restart notice nobody triggered.
   */
  result: KafkaConfigResult | null
  saving: boolean
  error: FetchError | null
  /** Persists `enabled` to .env. Resolves to the result, or null on failure. */
  setEnabled: (enabled: boolean) => Promise<KafkaConfigResult | null>
  /** Clears a failed attempt so the banner can be dismissed. */
  clearError: () => void
}

export function useKafkaConfig(): KafkaConfigResource {
  const [result, setResult] = useState<KafkaConfigResult | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<FetchError | null>(null)

  const setEnabled = useCallback(async (enabled: boolean): Promise<KafkaConfigResult | null> => {
    setSaving(true)
    setError(null)

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
    try {
      const res = await fetch(CONFIG_URL, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
        signal: controller.signal,
      })

      if (!res.ok) {
        // The 500 body carries reason/message/envPath. A failed write must
        // leave `result` untouched: showing the requested value as persisted
        // when the file was never written is the worst available outcome.
        let body: { reason?: string; message?: string } | null = null
        try {
          body = await res.json()
        } catch {
          body = null
        }
        const failure: FetchError = {
          kind: 'bad_response',
          reason: body?.reason,
          message: body?.message ?? `${CONFIG_URL} responded ${res.status} ${res.statusText}`,
          status: res.status,
        }
        setError(failure)
        return null
      }

      const data = (await res.json()) as KafkaConfigResult
      setResult(data)
      return data
    } catch (err) {
      const aborted = err instanceof DOMException && err.name === 'AbortError'
      const failure: FetchError = isFetchError(err)
        ? err
        : {
            kind: 'network',
            message: aborted
              ? `ms-order did not respond within ${REQUEST_TIMEOUT_MS}ms — KAFKA_ENABLED was not changed.`
              : `Could not reach ms-order at ${CONFIG_URL}: ${
                  err instanceof Error ? err.message : String(err)
                }`,
          }
      setError(failure)
      return null
    } finally {
      clearTimeout(timeoutId)
      setSaving(false)
    }
  }, [])

  const clearError = useCallback(() => setError(null), [])

  return { result, saving, error, setEnabled, clearError }
}
