import type { RustfsHealth, ServiceItem } from '../../types'
import type { LiveResource } from '../../hooks/useQueueData'
import type { CacheDriverInfo } from './cacheTypes'
import type { ObservabilityTarget } from '../../hooks/useObservability'
import type { OpenSignal } from './parts'
import { KvCacheCard } from './infra/KvCacheCard'
import { StorageCard } from './infra/StorageCard'
import { DatabaseCards } from './infra/DatabaseCards'
import { ObservabilityCards } from './infra/ObservabilityCards'

export default function InfraPanel({
  rustfsHealth,
  openSignal,
  onPingRustFS,
  driver,
  services,
  onRefreshServices,
  prometheus,
  elasticsearch,
  loki,
  grafana,
  onProbeObservability,
}: {
  rustfsHealth: RustfsHealth
  openSignal?: OpenSignal
  onPingRustFS: () => void
  /** The KV backend ms-order actually resolved at boot. */
  driver: LiveResource<CacheDriverInfo>
  services: ServiceItem[]
  onRefreshServices: () => void
  prometheus: ObservabilityTarget
  elasticsearch: ObservabilityTarget
  loki: ObservabilityTarget
  grafana: ObservabilityTarget
  onProbeObservability: () => void
}) {
  return (
    <>
      <KvCacheCard driver={driver} openSignal={openSignal} />
      <StorageCard rustfsHealth={rustfsHealth} openSignal={openSignal} onPingRustFS={onPingRustFS} />
      <DatabaseCards
        services={services}
        openSignal={openSignal}
        onRefreshServices={onRefreshServices}
      />
      <ObservabilityCards
        prometheus={prometheus}
        elasticsearch={elasticsearch}
        loki={loki}
        grafana={grafana}
        openSignal={openSignal}
        onProbeObservability={onProbeObservability}
      />
    </>
  )
}
