import type { RustfsHealth, ServiceItem } from '../../types'
import type { LiveResource } from '../../hooks/useQueueData'
import type { CacheDriverInfo } from './cacheTypes'
import type { ObservabilityTarget } from '../../hooks/useObservability'
import type { MergedEventResource } from '../../hooks/useEventData'
import type { KafkaConfigResource } from '../../hooks/useKafkaConfig'
import type { OpenSignal } from './parts'
import { KvCacheCard } from './infra/KvCacheCard'
import { StorageCard } from './infra/StorageCard'
import { DatabaseCards } from './infra/DatabaseCards'
import { ObservabilityCards } from './infra/ObservabilityCards'
import { KafkaCard } from './infra/KafkaCard'

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
  onSetElasticsearchEnabled,
  onSetLokiEnabled,
  events,
  kafkaConfig,
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
  onSetElasticsearchEnabled: (enabled: boolean) => void
  onSetLokiEnabled: (enabled: boolean) => void
  /** Live backbone state, shared with the Events tab's hook. */
  events: MergedEventResource
  kafkaConfig: KafkaConfigResource
}) {
  return (
    <>
      {/* The event backbone leads: it is the spine the services talk over, so
          its state frames everything below it. */}
      <KafkaCard resource={events} config={kafkaConfig} openSignal={openSignal} />
      <KvCacheCard driver={driver} openSignal={openSignal} />
      <StorageCard
        rustfsHealth={rustfsHealth}
        openSignal={openSignal}
        onPingRustFS={onPingRustFS}
      />
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
        onSetElasticsearchEnabled={onSetElasticsearchEnabled}
        onSetLokiEnabled={onSetLokiEnabled}
      />
    </>
  )
}
