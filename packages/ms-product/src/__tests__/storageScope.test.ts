import type { FastifyInstance } from 'fastify'
import { bearer, buildApp, type TestApp } from './testApp'

const open: FastifyInstance[] = []
async function app(): Promise<TestApp> {
  const a = await buildApp()
  open.push(a.server)
  return a
}
afterEach(async () => {
  await Promise.all(open.splice(0).map((s) => s.close()))
})

describe('storage scope: VENDOR is confined to products/', () => {
  it.each(['', '&format=json'])(
    'receipts/* download%s is 404 for a VENDOR, nothing signed',
    async (q) => {
      const a = await app()
      const t = await a.tokens()
      const res = await a.server.inject({
        url: `/api/v1/storage/download?key=receipts/r.pdf${q}`,
        headers: bearer(t.VENDOR),
      })
      expect(res.statusCode).toBe(404)
      expect(a.signedKeys).toEqual([])
    }
  )

  it('the 404 body is the generic not-found one (no existence leak)', async () => {
    const a = await app()
    const t = await a.tokens()
    const res = await a.server.inject({
      url: '/api/v1/storage/download?key=receipts/r.pdf',
      headers: bearer(t.VENDOR),
    })
    expect(res.json()).toMatchObject({ code: 'NOT_FOUND', message: 'Object not found' })
  })

  it('products/* download is 200 for a VENDOR and receipts/* stays reachable for ADMIN', async () => {
    const a = await app()
    const t = await a.tokens()
    const ok = await a.server.inject({
      url: '/api/v1/storage/download?key=products/a.png&format=json',
      headers: bearer(t.VENDOR),
    })
    expect(ok.statusCode).toBe(200)
    const admin = await a.server.inject({
      url: '/api/v1/storage/download?key=receipts/r.pdf&format=json',
      headers: bearer(t.ADMIN_AAL1),
    })
    expect(admin.statusCode).toBe(200)
  })

  it('objects listing is forced to products/ and filtered for a VENDOR', async () => {
    const a = await app()
    const t = await a.tokens()
    const res = await a.server.inject({
      url: '/api/v1/storage/objects',
      headers: bearer(t.VENDOR),
    })
    expect(res.statusCode).toBe(200)
    expect(a.listPrefixes).toEqual(['products/'])
    expect(res.json().objects.map((o: { key: string }) => o.key)).toEqual(['products/a.png'])
    expect(res.json().bucket).toBeUndefined()
  })

  it('ADMIN lists everything with the bucket name', async () => {
    const a = await app()
    const t = await a.tokens()
    const res = await a.server.inject({
      url: '/api/v1/storage/objects',
      headers: bearer(t.ADMIN_AAL1),
    })
    expect(res.json().objects.map((o: { key: string }) => o.key)).toEqual([
      'products/a.png',
      'receipts/r.pdf',
    ])
    expect(res.json().bucket).toEqual(expect.any(String))
  })

  it('health hides endpoint and bucket from a VENDOR, shows them to ADMIN', async () => {
    const a = await app()
    const t = await a.tokens()
    const v = await a.server.inject({ url: '/api/v1/storage/health', headers: bearer(t.VENDOR) })
    expect(v.statusCode).toBe(200)
    expect(v.json().healthy).toBe(true)
    expect(v.json().endpoint).toBeUndefined()
    expect(v.json().bucket).toBeUndefined()
    const ad = await a.server.inject({
      url: '/api/v1/storage/health',
      headers: bearer(t.ADMIN_AAL1),
    })
    expect(ad.json().endpoint).toBe('http://storage.test')
    expect(ad.json().bucket).toEqual(expect.any(String))
  })
})
