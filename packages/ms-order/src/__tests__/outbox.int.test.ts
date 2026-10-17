import * as crypto from 'crypto'
import * as dotenv from 'dotenv'
import * as fs from 'fs'
import * as path from 'path'
import { Client } from 'pg'
import fastify from 'fastify'
import { PrismaClient } from '../../node_modules/.prisma-ms-order/client'
import { applyServiceUrlDefaults } from '@ecommerce/shared-database'
import { registerOrderCreateRoute } from '../routes/ordersCreate'
import { registerPaymentRoutes } from '../routes/payments'
import { makeExpireOrderProcessor } from '../queues/workers'
import { stageOrderCancelled, stageOrderCreated } from '../events'
import type { QueueManager } from '../queues'

/**
 * Pattern 1 + 2 for ms-order, against real Postgres in a throwaway schema.
 *
 * The schema test_order_<random> is built from the REAL Prisma baseline
 * migration and dropped afterwards, so these never touch ms_order. Without
 * ORDER_DATABASE_URL the suite is skipped (visibly). No Redis, no Kafka: the
 * queue manager is a stub whose enqueues are no-ops, because the events under
 * test are the ones written to the outbox table.
 */

dotenv.config({ path: path.resolve(__dirname, '../../../../.env') })
jest.setTimeout(120_000)

applyServiceUrlDefaults(process.env)
const BASE = process.env.ORDER_DATABASE_URL
const dbDescribe = BASE ? describe : describe.skip
const SCHEMA = `test_order_${crypto.randomBytes(6).toString('hex')}`

let prisma: PrismaClient
let url: string

function urlFor(schema: string): string {
  const u = new URL(BASE as string)
  u.search = `?schema=${schema}`
  return u.toString()
}

function pgConn(): Client {
  const u = new URL(BASE as string)
  u.search = ''
  return new Client({ connectionString: u.toString(), ssl: { rejectUnauthorized: false } })
}

const stubQueues = {
  tryEnqueue: async () => null,
  enqueueExpireOrder: async () => undefined,
  enqueueSendConfirmation: async () => undefined,
  enqueueSendReceipt: async () => undefined,
  enqueueRetryCapture: async () => undefined,
  enqueueRefundPayment: async () => undefined,
  enqueueReleaseInventory: async () => undefined,
} as unknown as QueueManager

const BODY = {
  customerName: 'T',
  customerEmail: 't@example.com',
  items: [{ productId: 'p1', sku: 'S1', title: 'Thing', unitPrice: 10, quantity: 2 }],
  shippingAddress: { addressLine1: '1 A', city: 'C', state: 'S', postalCode: '1', country: 'US' },
  paymentMethod: 'card',
  subtotal: 20,
  totalAmount: 20,
}

async function build() {
  const server = fastify()
  registerOrderCreateRoute(server, { prisma, queueManager: stubQueues })
  registerPaymentRoutes(server, { prisma, queueManager: stubQueues })
  await server.ready()
  return server
}

const outbox = (where = '') =>
  prisma.$queryRawUnsafe<{ event_type: string; event_id: string; envelope: { eventId: string } }[]>(
    `SELECT event_type, event_id::text, envelope FROM "outbox_events" ${where} ORDER BY seq`
  )

beforeAll(async () => {
  if (!BASE) return
  const c = pgConn()
  await c.connect()
  await c.query(`CREATE SCHEMA ${SCHEMA}`)
  await c.query(`SET search_path TO ${SCHEMA}`)
  const mig = path.resolve(__dirname, '../../prisma/migrations')
  const dir = fs.readdirSync(mig).find((d) => d.endsWith('postgres_baseline')) as string
  await c.query(fs.readFileSync(path.join(mig, dir, 'migration.sql'), 'utf8'))
  await c.end()
  url = urlFor(SCHEMA)
  prisma = new PrismaClient({ datasources: { db: { url } } })
})

afterAll(async () => {
  if (!BASE) return
  await prisma?.$disconnect()
  const c = pgConn()
  await c.connect()
  await c.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`)
  await c.end()
})

dbDescribe('ms-order transactional outbox', () => {
  it('rolls back the order AND the staged event together when the transaction fails', async () => {
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.order.create({
          data: {
            orderNumber: 'ORD-ROLLBACK',
            userId: 'u',
            customerName: 'n',
            customerEmail: 'e',
            subtotal: 1,
            totalAmount: 1,
            shippingAddress: '{}',
            billingAddress: '{}',
          },
        })
        await stageOrderCancelled(tx, {
          orderId: 'x',
          orderNumber: 'ORD-ROLLBACK',
          reason: 'r',
          items: [],
        })
        throw new Error('crash before commit')
      })
    ).rejects.toThrow('crash before commit')
    expect(await prisma.order.count({ where: { orderNumber: 'ORD-ROLLBACK' } })).toBe(0)
    expect((await outbox()).filter((r) => r.event_type === 'order.cancelled')).toHaveLength(0)
  })

  it('stages an event whose stored envelope carries the same eventId as the row', async () => {
    await stageOrderCreated(prisma, {
      orderId: 'o-env',
      orderNumber: 'ORD-ENV',
      userId: 'u',
      customerEmail: 'e',
      status: 'CONFIRMED',
      totalAmount: 1,
      currency: 'USD',
      items: [],
    })
    const [row] = await outbox(`WHERE partition_key = 'o-env'`)
    expect(row!.envelope.eventId).toBe(row!.event_id)
  })

  it('POST /orders writes the order and order.created + order.confirmed in one commit', async () => {
    const server = await build()
    const res = await server.inject({ method: 'POST', url: '/api/v1/orders', payload: BODY })
    expect(res.statusCode).toBe(201)
    const id = res.json().id as string
    const rows = await outbox(`WHERE partition_key = '${id}'`)
    expect(rows.map((r) => r.event_type)).toEqual(['order.created', 'order.confirmed'])
    await server.close()
  })

  it('a repeated Idempotency-Key returns the original order (200) and emits no new events', async () => {
    const server = await build()
    const headers = { 'idempotency-key': 'key-replay' }
    const first = await server.inject({
      method: 'POST',
      url: '/api/v1/orders',
      payload: BODY,
      headers,
    })
    expect(first.statusCode).toBe(201)
    const second = await server.inject({
      method: 'POST',
      url: '/api/v1/orders',
      payload: BODY,
      headers,
    })
    expect(second.statusCode).toBe(200)
    expect(second.headers['idempotent-replay']).toBe('true')
    expect(second.json().id).toBe(first.json().id)
    expect(await prisma.order.count({ where: { idempotencyKey: 'key-replay' } })).toBe(1)
    expect(await outbox(`WHERE partition_key = '${first.json().id}'`)).toHaveLength(2)
    await server.close()
  })

  it('the same key with a DIFFERENT order is a 409, not a silent drop', async () => {
    const server = await build()
    const headers = { 'idempotency-key': 'key-conflict' }
    await server.inject({ method: 'POST', url: '/api/v1/orders', payload: BODY, headers })
    const res = await server.inject({
      method: 'POST',
      url: '/api/v1/orders',
      headers,
      payload: { ...BODY, totalAmount: 99 },
    })
    expect(res.statusCode).toBe(409)
    await server.close()
  })

  it('five concurrent requests with one key create exactly one order', async () => {
    const server = await build()
    const headers = { 'idempotency-key': 'key-race' }
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        server.inject({ method: 'POST', url: '/api/v1/orders', payload: BODY, headers })
      )
    )
    const codes = results.map((r) => r.statusCode).sort()
    expect(codes.filter((c) => c === 201)).toHaveLength(1)
    expect(codes.every((c) => c === 201 || c === 200)).toBe(true)
    expect(await prisma.order.count({ where: { idempotencyKey: 'key-race' } })).toBe(1)
    const id = (await prisma.order.findFirstOrThrow({ where: { idempotencyKey: 'key-race' } })).id
    expect(
      await outbox(`WHERE partition_key = '${id}' AND event_type = 'order.created'`)
    ).toHaveLength(1)
    await server.close()
  })

  it('two concurrent captures: one wins, the other gets 409, exactly one payment.captured', async () => {
    const server = await build()
    const created = await server.inject({
      method: 'POST',
      url: '/api/v1/orders',
      payload: { ...BODY, paymentPreCaptured: false },
    })
    const id = created.json().id as string
    const [a, b] = await Promise.all([
      server.inject({
        method: 'POST',
        url: `/api/v1/payments/${id}/capture`,
        payload: { outcome: 'succeed' },
      }),
      server.inject({
        method: 'POST',
        url: `/api/v1/payments/${id}/capture`,
        payload: { outcome: 'succeed' },
      }),
    ])
    const codes = [a.statusCode, b.statusCode]
    expect(codes.filter((c) => c === 200)).toHaveLength(1)
    // The loser either lost the lock race (409) or arrived after commit (400: nothing PENDING).
    expect(codes.filter((c) => c === 409 || c === 400)).toHaveLength(1)
    const rows = await outbox(`WHERE partition_key = '${id}'`)
    expect(rows.filter((r) => r.event_type === 'payment.captured')).toHaveLength(1)
    expect(rows.filter((r) => r.event_type === 'order.confirmed')).toHaveLength(1)
    expect((await prisma.order.findUniqueOrThrow({ where: { id } })).status).toBe('CONFIRMED')
    await server.close()
  })

  it('expiry cancels a PENDING order and stages order.cancelled in the same commit', async () => {
    const server = await build()
    const id = (
      await server.inject({
        method: 'POST',
        url: '/api/v1/orders',
        payload: { ...BODY, paymentPreCaptured: false },
      })
    ).json().id as string
    const process = makeExpireOrderProcessor({
      prisma,
      onOrderCancelled: async (tx, data) => void (await stageOrderCancelled(tx, data)),
    })
    const job = { data: { orderId: id, orderNumber: 'x', enqueuedAt: new Date().toISOString() } }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((await process(job as any)).outcome).toBe('cancelled')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((await process(job as any)).outcome).toBe('skipped')
    expect(
      await outbox(`WHERE partition_key = '${id}' AND event_type = 'order.cancelled'`)
    ).toHaveLength(1)
    await server.close()
  })

  it('expiry never cancels an order that was paid in the meantime', async () => {
    const server = await build()
    const id = (
      await server.inject({
        method: 'POST',
        url: '/api/v1/orders',
        payload: { ...BODY, paymentPreCaptured: false },
      })
    ).json().id as string
    await server.inject({
      method: 'POST',
      url: `/api/v1/payments/${id}/capture`,
      payload: { outcome: 'succeed' },
    })
    const process = makeExpireOrderProcessor({
      prisma,
      onOrderCancelled: async (tx, data) => void (await stageOrderCancelled(tx, data)),
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = await process({ data: { orderId: id, orderNumber: 'x', enqueuedAt: '' } } as any)
    expect(r.outcome).toBe('skipped')
    expect(
      await outbox(`WHERE partition_key = '${id}' AND event_type = 'order.cancelled'`)
    ).toHaveLength(0)
    await server.close()
  })
})
