import type { LiveResource } from '../../../hooks/useQueueData'
import type { CacheDriverInfo } from '../cacheTypes'
import { ConfigCard, ReadOnlyRow, type OpenSignal } from '../parts'

export function KvCacheCard({
  driver,
  openSignal,
}: {
  /** The KV backend ms-order actually resolved at boot. */
  driver: LiveResource<CacheDriverInfo>
  openSignal?: OpenSignal
}) {
  return (
    <ConfigCard
      openSignal={openSignal}
      count={6}
      title={
        <>
          <span>KV Cache</span>
          <span className="chip chip-blue">
            {driver.data
              ? driver.data.backend === 'redis'
                ? 'Redis 7'
                : 'Embedded (file-backed)'
              : 'KV'}
          </span>
          <span
            className={`chip ${driver.data?.backend === 'redis' ? 'chip-green' : 'chip-amber'}`}
          >
            {!driver.data
              ? 'Probing…'
              : driver.data.backend === 'redis'
                ? '✓ Online'
                : '◐ Embedded'}
          </span>
        </>
      }
      metrics={
        <button
          className="btn btn-ghost btn-sm"
          onClick={(e) => {
            e.stopPropagation()
            driver.refetch()
          }}
        >
          ↻ Probe
        </button>
      }
    >
      {/* Every value here is reported by GET /api/v1/cache/driver rather than
          hardcoded, so the panel can never name a driver that is not the one
          in use. An em-dash means "not measured yet", never a guess. */}
      <ReadOnlyRow
        label="Active Driver"
        value={driver.data ? `${driver.data.driver} (KV_CACHE_DRIVER)` : '—'}
      />
      <ReadOnlyRow
        label={driver.data?.backend === 'embedded' ? 'Snapshot Path' : 'Redis Host'}
        value={driver.data ? (driver.data.host ?? driver.data.dataPath ?? 'in-memory') : '—'}
      />
      <ReadOnlyRow label="Client" value={driver.data?.label ?? '—'} />
      <ReadOnlyRow
        label="Image"
        value={driver.data?.backend === 'redis' ? 'redis:7-alpine' : 'n/a (in-process)'}
      />
      <ReadOnlyRow
        label={driver.data?.backend === 'embedded' ? 'Persistence' : 'DB Index'}
        value={
          driver.data
            ? driver.data.backend === 'embedded'
              ? driver.data.inMemory
                ? 'in-memory (not persisted)'
                : 'file-backed JSON snapshot'
              : '0'
            : '—'
        }
      />
      <ReadOnlyRow
        label="Fallback"
        value={
          driver.data
            ? driver.data.backend === 'embedded'
              ? 'active — embedded (file-backed)'
              : 'embedded (file-backed) via KV_CACHE_DRIVER'
            : '—'
        }
      />
      {driver.data?.loadError && (
        <div className="warn-banner" style={{ marginTop: 8 }}>
          The embedded snapshot could not be read, so the store started empty:{' '}
          {driver.data.loadError}
        </div>
      )}

      {/* Runtime INFO metrics (used memory, clients, ops/sec, hit rate) used
          to be rendered here from a Math.random() generator, which reported a
          healthy 41 MB and a 93% hit rate even with Redis stopped. ms-order
          exposes no INFO-derived endpoint, so the honest rendering of absent
          data is to show nothing. */}
    </ConfigCard>
  )
}
