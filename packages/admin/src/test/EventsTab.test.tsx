import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import EventsTab from '../screens/EventsTab'
import type { EventData } from '../screens/events/eventTypes'

// Behavioural coverage for the three outcomes GET /api/v1/events can produce,
// plus the one rendering rule the whole panel exists to enforce: an unmeasured
// number must never be drawn as 0.

const flush = () => act(async () => {})

function payload(overrides: Partial<EventData> = {}): EventData {
  return {
    enabled: true,
    connected: true,
    brokers: ['localhost:9100'],
    topics: [
      {
        name: 'ecommerce.orders.v1',
        producer: 'ms-order',
        partitionKey: 'orderId',
        description: 'Order lifecycle facts.',
        eventTypes: ['order.created'],
        partitions: 3,
        published: 12,
        publishFailures: 0,
        lastPublishedAt: new Date().toISOString(),
        lastFailureAt: null,
        lastFailureReason: null,
      },
    ],
    consumers: [],
    summary: {
      topicCount: 1,
      published: 12,
      publishFailures: 0,
      consumed: 0,
      consumerFailures: 0,
    },
    countersAreProcessLifetime: true,
    ...overrides,
  }
}

/** Answers every /api/v1/events call with the same outcome. */
function stubAll(outcome: { status: number; body: unknown }) {
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve({
        ok: outcome.status >= 200 && outcome.status < 300,
        status: outcome.status,
        statusText: '',
        json: () => Promise.resolve(outcome.body),
      } as Response)
    )
  )
}

describe('EventsTab outcomes', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders 200 + enabled:false as a deliberate configuration, not an outage', async () => {
    stubAll({
      status: 200,
      body: payload({
        enabled: false,
        connected: false,
        topics: payload().topics.map((t) => ({ ...t, partitions: null, published: 0 })),
        summary: {
          topicCount: 1,
          published: 0,
          publishFailures: 0,
          consumed: 0,
          consumerFailures: 0,
        },
      }),
    })
    render(<EventsTab />)
    await flush()

    expect(screen.getByText('Kafka is switched off')).toBeInTheDocument()
    expect(screen.getByText('KAFKA_ENABLED=false')).toBeInTheDocument()
    // Crucially NOT an alert: OfflineBanner renders role="alert", and a
    // switched-off optional feature must never trip one.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('renders 200 + enabled:true as live data', async () => {
    stubAll({ status: 200, body: payload() })
    render(<EventsTab />)
    await flush()

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByText('Kafka is switched off')).not.toBeInTheDocument()
    expect(screen.getAllByText('ecommerce.orders.v1').length).toBeGreaterThan(0)
  })

  it('renders a 503 as offline, with the reason, and shows no fabricated counts', async () => {
    stubAll({
      status: 503,
      body: {
        error: 'Service Unavailable',
        reason: 'kafka_broker_unavailable',
        message: 'No Kafka broker is available at localhost:9100',
        timestamp: new Date().toISOString(),
      },
    })
    render(<EventsTab />)
    await flush()

    expect(screen.getAllByRole('alert').length).toBe(3)
    expect(screen.getAllByText('kafka_broker_unavailable').length).toBe(3)
    expect(
      screen.getByText('No event data could be loaded from any service on the backbone.')
    ).toBeInTheDocument()
    // Every source failed, so no summary chip may carry a number.
    expect(screen.queryByText('Published')?.previousSibling).toHaveTextContent('—')
  })

  it('renders an unmeasured lag as a dash, never as 0', async () => {
    stubAll({
      status: 200,
      body: payload({
        consumers: [
          {
            groupId: 'ecommerce.inventory',
            topics: ['ecommerce.orders.v1'],
            state: null,
            lag: null,
            running: true,
            consumed: 0,
            failed: 0,
            skipped: 0,
            lastConsumedAt: null,
            lastFailureAt: null,
            lastFailureReason: null,
          },
        ],
      }),
    })
    const user = userEvent.setup()
    render(<EventsTab />)
    await flush()
    await user.click(screen.getByText('Consumer Groups', { exact: false }))

    expect(screen.getAllByText('unknown').length).toBeGreaterThan(0)
    // Unmeasured lag is a dash. If this ever renders "0" the panel is telling
    // the operator a group is caught up on evidence it does not have.
    const lagCell = screen.getAllByTitle('Unmeasured — the broker could not be queried')
    expect(lagCell.length).toBeGreaterThan(0)
    // …and it is NOT flagged as wedged: an unmeasured lag is not evidence.
    expect(screen.queryByText(/WEDGED/)).not.toBeInTheDocument()
  })

  it('flags a wedged consumer (running, lag > 0, consumed 0) distinctly from an idle one', async () => {
    stubAll({
      status: 200,
      body: payload({
        consumers: [
          {
            groupId: 'ecommerce.inventory',
            topics: ['ecommerce.orders.v1'],
            state: 'Stable',
            lag: 42,
            running: true,
            consumed: 0,
            failed: 0,
            skipped: 0,
            lastConsumedAt: null,
            lastFailureAt: null,
            lastFailureReason: null,
          },
          {
            // Healthy idle: also running, also consumed 0, but measurably at
            // the head of the log. Must NOT be flagged.
            groupId: 'ecommerce.analytics',
            topics: ['ecommerce.orders.v1'],
            state: 'Stable',
            lag: 0,
            running: true,
            consumed: 0,
            failed: 0,
            skipped: 0,
            lastConsumedAt: null,
            lastFailureAt: null,
            lastFailureReason: null,
          },
        ],
      }),
    })
    const user = userEvent.setup()
    render(<EventsTab />)
    await flush()
    await user.click(screen.getByText('Consumer Groups', { exact: false }))

    const wedged = screen.getAllByText(/WEDGED/)
    // One per answering source (all three stubs return the same body), and
    // never one for the idle group.
    expect(wedged.length).toBeGreaterThan(0)
    for (const node of wedged) {
      expect(node).toHaveTextContent('42 behind, 0 consumed')
    }
  })
})
