// Static snapshot shaped like what a real BullMQ queue-introspection endpoint
// would return (e.g. via `Queue.getJobCounts()` / `Queue.getJobs()`).
//
// packages/ms-order declares `bullmq` and `ioredis` as dependencies (see
// package.json) but src/index.ts currently only has stub routes — no queue is
// actually constructed yet. There are no real queue names to mirror, so these
// follow the order-expiration / saga-retry domain language already used in
// ConfigTab.tsx's "Order Expiration Timeout" and "Saga Max Retries" cards, and
// the "KV Cache & Queues" panel in PersistenceTab.tsx (BullMQ over Redis,
// 10 worker concurrency).

import type { QueueData, QueueInfo } from './queueTypes'

const QUEUES: QueueInfo[] = [
  {
    name: 'order-expiration',
    service: 'ms-order',
    description: 'Cancels PENDING orders that were never paid within the expiration window.',
    concurrency: 10,
    attempts: 3,
    backoff: { type: 'exponential', delayMs: 5000 },
    counts: { waiting: 6, active: 1, completed: 842, failed: 3, delayed: 24 },
    recentJobs: [
      {
        id: '10482',
        name: 'expire-order',
        status: 'completed',
        attempts: 1,
        maxAttempts: 3,
        timestamp: '2026-09-17T01:58:12.000Z',
      },
      {
        id: '10481',
        name: 'expire-order',
        status: 'completed',
        attempts: 1,
        maxAttempts: 3,
        timestamp: '2026-09-17T01:47:50.000Z',
      },
      {
        id: '10480',
        name: 'expire-order',
        status: 'failed',
        attempts: 3,
        maxAttempts: 3,
        timestamp: '2026-09-17T01:32:04.000Z',
      },
      {
        id: '10479',
        name: 'expire-order',
        status: 'delayed',
        attempts: 0,
        maxAttempts: 3,
        timestamp: '2026-09-17T01:15:00.000Z',
      },
      {
        id: '10478',
        name: 'expire-order',
        status: 'active',
        attempts: 1,
        maxAttempts: 3,
        timestamp: '2026-09-17T01:02:37.000Z',
      },
    ],
  },
  {
    name: 'payment-retry',
    service: 'ms-order',
    description: 'Retries failed Stripe/PayPal payment captures with backoff before refunding.',
    concurrency: 5,
    attempts: 5,
    backoff: { type: 'exponential', delayMs: 10000 },
    counts: { waiting: 2, active: 0, completed: 391, failed: 11, delayed: 4 },
    recentJobs: [
      {
        id: '5021',
        name: 'retry-capture',
        status: 'failed',
        attempts: 5,
        maxAttempts: 5,
        timestamp: '2026-09-17T01:50:22.000Z',
      },
      {
        id: '5020',
        name: 'retry-capture',
        status: 'completed',
        attempts: 2,
        maxAttempts: 5,
        timestamp: '2026-09-17T01:40:09.000Z',
      },
      {
        id: '5019',
        name: 'retry-capture',
        status: 'delayed',
        attempts: 1,
        maxAttempts: 5,
        timestamp: '2026-09-17T01:22:45.000Z',
      },
      {
        id: '5018',
        name: 'retry-capture',
        status: 'waiting',
        attempts: 0,
        maxAttempts: 5,
        timestamp: '2026-09-17T01:20:00.000Z',
      },
    ],
  },
  {
    name: 'notification-dispatch',
    service: 'ms-order',
    description: 'Sends order confirmation / receipt emails and generates PDF receipts.',
    concurrency: 10,
    attempts: 4,
    backoff: { type: 'fixed', delayMs: 3000 },
    counts: { waiting: 0, active: 2, completed: 1204, failed: 2, delayed: 0 },
    recentJobs: [
      {
        id: '30112',
        name: 'send-receipt',
        status: 'active',
        attempts: 1,
        maxAttempts: 4,
        timestamp: '2026-09-17T02:03:00.000Z',
      },
      {
        id: '30111',
        name: 'send-confirmation',
        status: 'completed',
        attempts: 1,
        maxAttempts: 4,
        timestamp: '2026-09-17T01:59:41.000Z',
      },
      {
        id: '30110',
        name: 'send-receipt',
        status: 'completed',
        attempts: 1,
        maxAttempts: 4,
        timestamp: '2026-09-17T01:59:39.000Z',
      },
      {
        id: '30109',
        name: 'send-confirmation',
        status: 'failed',
        attempts: 4,
        maxAttempts: 4,
        timestamp: '2026-09-17T01:44:12.000Z',
      },
    ],
  },
  {
    name: 'saga-compensation',
    service: 'ms-order',
    description:
      'Runs compensating actions (release inventory, refund payment) when an order saga step fails.',
    concurrency: 5,
    attempts: 5,
    backoff: { type: 'exponential', delayMs: 8000 },
    counts: { waiting: 0, active: 0, completed: 57, failed: 1, delayed: 1 },
    recentJobs: [
      {
        id: '901',
        name: 'release-inventory',
        status: 'completed',
        attempts: 1,
        maxAttempts: 5,
        timestamp: '2026-09-16T22:14:05.000Z',
      },
      {
        id: '900',
        name: 'refund-payment',
        status: 'delayed',
        attempts: 2,
        maxAttempts: 5,
        timestamp: '2026-09-16T21:58:30.000Z',
      },
      {
        id: '899',
        name: 'release-inventory',
        status: 'failed',
        attempts: 5,
        maxAttempts: 5,
        timestamp: '2026-09-16T20:41:17.000Z',
      },
    ],
  },
]

function summarize(queues: QueueInfo[]): QueueData['summary'] {
  let totalJobs = 0
  let failedCount = 0
  let activeCount = 0
  for (const q of queues) {
    totalJobs += Object.values(q.counts).reduce((sum, n) => sum + n, 0)
    failedCount += q.counts.failed
    activeCount += q.counts.active
  }
  return { queueCount: queues.length, totalJobs, failedCount, activeCount }
}

export const QUEUE_DATA: QueueData = {
  queues: QUEUES,
  summary: summarize(QUEUES),
}
