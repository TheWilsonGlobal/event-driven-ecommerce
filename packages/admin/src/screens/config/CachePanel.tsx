interface RedisNamespace {
  prefix: string
  purpose: string
  approxKeyCount: number
}

const NAMESPACES: RedisNamespace[] = [
  {
    prefix: 'bull:order-expiration:*',
    purpose: 'BullMQ job data, state sets & events for the order-expiration queue',
    approxKeyCount: 412,
  },
  {
    prefix: 'bull:payment-retry:*',
    purpose: 'BullMQ job data, state sets & events for the payment-retry queue',
    approxKeyCount: 187,
  },
  {
    prefix: 'bull:notification-dispatch:*',
    purpose: 'BullMQ job data, state sets & events for the notification-dispatch queue',
    approxKeyCount: 264,
  },
  {
    prefix: 'bull:saga-compensation:*',
    purpose: 'BullMQ job data, state sets & events for the saga-compensation queue',
    approxKeyCount: 38,
  },
  {
    prefix: 'cache:products:*',
    purpose: 'Cache-aside entries for ms-product catalog reads (product & category lookups)',
    approxKeyCount: 1360,
  },
  {
    prefix: 'session:*',
    purpose: 'Short-lived refresh-token / session lookups issued by ms-user',
    approxKeyCount: 96,
  },
  {
    prefix: 'ratelimit:*',
    purpose: 'API gateway rate-limit counters (100 req/min window per client)',
    approxKeyCount: 54,
  },
]

const TOTAL_KEYS = NAMESPACES.reduce((sum, n) => sum + n.approxKeyCount, 0)

export default function CachePanel() {
  return (
    <>
      <div className="section-title spaced" style={{ marginBottom: 8 }}>
        Key Namespaces
      </div>
      <div className="table-wrapper">
        <table>
          <thead>
            <tr>
              <th>Prefix</th>
              <th>Purpose</th>
              <th className="cell-right">Approx. Keys</th>
            </tr>
          </thead>
          <tbody>
            {NAMESPACES.map((ns) => (
              <tr key={ns.prefix}>
                <td className="mono">{ns.prefix}</td>
                <td className="cell-muted">{ns.purpose}</td>
                <td className="mono cell-right">{ns.approxKeyCount.toLocaleString()}</td>
              </tr>
            ))}
            <tr>
              <td className="mono" style={{ fontWeight: 700, color: 'var(--text-bright)' }}>
                Total
              </td>
              <td className="cell-muted"></td>
              <td
                className="mono cell-right"
                style={{ fontWeight: 700, color: 'var(--text-bright)' }}
              >
                {TOTAL_KEYS.toLocaleString()}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </>
  )
}
