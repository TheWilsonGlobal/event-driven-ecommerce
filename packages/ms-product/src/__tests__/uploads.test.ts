import type { FastifyInstance } from 'fastify'
import { GIF, JPEG, PDF, PNG, WEBP, bearer, buildApp, multipartBody, type TestApp } from './testApp'
import { EXTENSION, generateKey, sniffType, verifyUpload } from '../uploadGuard'
import { OBJECT_KEY_PATTERN } from '../schemas'

const open: FastifyInstance[] = []
async function app(): Promise<TestApp> {
  const a = await buildApp()
  open.push(a.server)
  return a
}
afterEach(async () => {
  await Promise.all(open.splice(0).map((s) => s.close()))
})

async function upload(
  a: TestApp,
  url: string,
  parts: Parameters<typeof multipartBody>[0],
  who: 'VENDOR' | 'ADMIN_AAL1' = 'VENDOR'
) {
  const t = await a.tokens()
  const body = multipartBody(parts)
  return a.server.inject({
    method: 'POST',
    url,
    headers: { ...bearer(t[who]), ...body.headers },
    payload: body.payload,
  })
}

const IMG = '/api/v1/products/upload'
const RCPT = '/api/v1/receipts/upload'

describe('product image upload', () => {
  it.each([
    ['image/png', PNG, 'png'],
    ['image/jpeg', JPEG, 'jpg'],
    ['image/gif', GIF, 'gif'],
    ['image/webp', WEBP, 'webp'],
  ])('stores a genuine %s under a generated key', async (type, data, ext) => {
    const a = await app()
    const res = await upload(a, IMG, [{ name: 'image', filename: 'photo.bin', type, data }])
    expect(res.statusCode).toBe(201)
    expect(res.json().key).toMatch(new RegExp(`^products/[0-9a-f-]{36}\\.${ext}$`))
    expect(a.uploads).toHaveLength(1)
    expect(a.uploads[0]).toMatchObject({ type, size: data.length })
  })

  it('ignores the client filename entirely (traversal, double extension, script)', async () => {
    const a = await app()
    for (const filename of [
      '../../etc/passwd',
      'shell.php.png',
      '..\\..\\win.ini',
      'a/b/c.png',
      'NUL.png',
    ]) {
      const res = await upload(a, IMG, [{ name: 'image', filename, type: 'image/png', data: PNG }])
      expect(res.statusCode).toBe(201)
      expect(res.json().key).toMatch(/^products\/[0-9a-f-]{36}\.png$/)
    }
    expect(a.uploads.every((u) => /^products\/[0-9a-f-]{36}\.png$/.test(u.key))).toBe(true)
  })

  it('refuses a type outside the allow-list (svg, html, pdf) with 415', async () => {
    const a = await app()
    for (const [type, data] of [
      ['image/svg+xml', '<svg onload=alert(1)/>'],
      ['text/html', '<script>alert(1)</script>'],
      ['application/pdf', PDF],
      ['application/octet-stream', PNG],
    ] as const) {
      const res = await upload(a, IMG, [{ name: 'image', filename: 'x', type, data }])
      expect(res.statusCode).toBe(415)
      expect(res.json().code).toBe('UNSUPPORTED_MEDIA_TYPE')
    }
    expect(a.uploads).toHaveLength(0)
  })

  it('refuses content that does not match the claimed type (script labelled image/png)', async () => {
    const a = await app()
    for (const [type, data] of [
      ['image/png', '<?php system($_GET["c"]); ?>'],
      ['image/png', JPEG],
      ['image/jpeg', PNG],
      ['image/gif', PDF],
      ['image/webp', Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVE')])],
    ] as const) {
      const res = await upload(a, IMG, [{ name: 'image', filename: 'x.png', type, data }])
      expect(res.statusCode).toBe(415)
      expect(res.json().code).toBe('CONTENT_TYPE_MISMATCH')
    }
    expect(a.uploads).toHaveLength(0)
  })

  it('refuses an empty file, a missing file and the wrong field name', async () => {
    const a = await app()
    expect(
      (await upload(a, IMG, [{ name: 'image', filename: 'x.png', type: 'image/png', data: '' }]))
        .statusCode
    ).toBe(400)
    const none = await upload(a, IMG, [{ name: 'note', data: 'hi' }])
    expect(none.statusCode).toBe(400)
    expect(none.json().code).toBe('NO_FILE')
    const wrong = await upload(a, IMG, [
      { name: 'avatar', filename: 'x.png', type: 'image/png', data: PNG },
    ])
    expect(wrong.json().code).toBe('UNEXPECTED_FIELD')
  })

  it('refuses a file over 10 MB with 413 and stores nothing', async () => {
    const a = await app()
    const big = Buffer.concat([PNG, Buffer.alloc(10 * 1024 * 1024)])
    const res = await upload(a, IMG, [
      { name: 'image', filename: 'big.png', type: 'image/png', data: big },
    ])
    expect(res.statusCode).toBe(413)
    expect(res.json().code).toBe('PAYLOAD_TOO_LARGE')
    expect(a.uploads).toHaveLength(0)
  })

  it('accepts a file just under the limit', async () => {
    const a = await app()
    const ok = Buffer.concat([PNG, Buffer.alloc(9 * 1024 * 1024)])
    expect(
      (await upload(a, IMG, [{ name: 'image', filename: 'ok.png', type: 'image/png', data: ok }]))
        .statusCode
    ).toBe(201)
  })

  it('refuses too many fields (multipart limits)', async () => {
    const a = await app()
    const parts = [
      ...Array.from({ length: 6 }, (_, i) => ({ name: `f${i}`, data: 'x' })),
      { name: 'image', filename: 'x.png', type: 'image/png', data: PNG },
    ]
    const res = await upload(a, IMG, parts)
    expect(res.statusCode).toBeGreaterThanOrEqual(400)
    expect(a.uploads).toHaveLength(0)
  })

  it('refuses a request that is not multipart', async () => {
    const a = await app()
    const t = await a.tokens()
    const res = await a.server.inject({
      method: 'POST',
      url: IMG,
      headers: bearer(t.VENDOR),
      payload: { a: 1 },
    })
    expect(res.statusCode).toBeGreaterThanOrEqual(400)
    expect(res.statusCode).toBeLessThan(500)
  })
})

describe('receipt upload', () => {
  it('accepts a pdf and images, with the extension derived from the verified type', async () => {
    const a = await app()
    const pdf = await upload(
      a,
      RCPT,
      [{ name: 'receipt', filename: 'r.exe', type: 'application/pdf', data: PDF }],
      'ADMIN_AAL1'
    )
    expect(pdf.statusCode).toBe(201)
    expect(pdf.json().key).toMatch(/^receipts\/[0-9a-f-]{36}\.pdf$/)
    const png = await upload(a, RCPT, [
      { name: 'receipt', filename: 'r', type: 'image/png', data: PNG },
    ])
    expect(png.json().key).toMatch(/\.png$/)
  })

  it('refuses a mislabelled file and a file over 5 MB', async () => {
    const a = await app()
    expect(
      (
        await upload(a, RCPT, [
          { name: 'receipt', type: 'application/pdf', filename: 'r.pdf', data: PNG },
        ])
      ).statusCode
    ).toBe(415)
    const big = Buffer.concat([PDF, Buffer.alloc(5 * 1024 * 1024)])
    expect(
      (
        await upload(a, RCPT, [
          { name: 'receipt', type: 'application/pdf', filename: 'r.pdf', data: big },
        ])
      ).statusCode
    ).toBe(413)
  })
})

describe('storage download key (path traversal)', () => {
  const get = async (a: TestApp, key: string) => {
    const t = await a.tokens()
    return a.server.inject({
      url: `/api/v1/storage/download?key=${encodeURIComponent(key)}`,
      headers: bearer(t.ADMIN_AAL1),
    })
  }

  it.each([
    '../etc/passwd',
    'products/../receipts/x.png',
    'products/../../etc/passwd',
    '/etc/passwd',
    'products//x.png',
    'products/a/b.png',
    'products/..png',
    'other/x.png',
    'products/x.png\u0000.php',
    'products/x" ; evil=1',
    'C:\\windows\\win.ini',
    'products/',
    '',
    `products/${'a'.repeat(200)}.png`,
  ])('rejects %j before it reaches the signer', async (key) => {
    const a = await app()
    const res = await get(a, key)
    expect(res.statusCode).toBe(400)
    expect(a.signedKeys).toHaveLength(0)
  })

  it('rejects a missing or repeated key parameter', async () => {
    const a = await app()
    const t = await a.tokens()
    expect(
      (await a.server.inject({ url: '/api/v1/storage/download', headers: bearer(t.ADMIN_AAL1) }))
        .statusCode
    ).toBe(400)
    expect(
      (
        await a.server.inject({
          url: '/api/v1/storage/download?key=products/a.png&x=1',
          headers: bearer(t.ADMIN_AAL1),
        })
      ).statusCode
    ).toBe(400)
  })

  it('signs a generated-style key and redirects', async () => {
    const a = await app()
    const key = generateKey('products', 'image/png')
    const res = await get(a, key)
    expect(res.statusCode).toBe(302)
    expect(a.signedKeys).toEqual([key])
  })

  it('the pattern accepts every key the upload routes can generate', () => {
    const re = new RegExp(OBJECT_KEY_PATTERN, 'u')
    for (const prefix of ['products', 'receipts'] as const) {
      for (const type of Object.keys(EXTENSION) as (keyof typeof EXTENSION)[]) {
        expect(re.test(generateKey(prefix, type))).toBe(true)
      }
    }
  })
})

describe('content sniffer', () => {
  it('identifies each supported format and nothing else', () => {
    expect(sniffType(PNG)).toBe('image/png')
    expect(sniffType(JPEG)).toBe('image/jpeg')
    expect(sniffType(GIF)).toBe('image/gif')
    expect(sniffType(Buffer.concat([Buffer.from('GIF87a'), Buffer.alloc(4)]))).toBe('image/gif')
    expect(sniffType(WEBP)).toBe('image/webp')
    expect(sniffType(PDF)).toBe('application/pdf')
    expect(sniffType(Buffer.from('MZ\x90\x00'))).toBeNull()
    expect(sniffType(Buffer.from('<svg/>'))).toBeNull()
    expect(sniffType(Buffer.alloc(0))).toBeNull()
    expect(sniffType(Buffer.from([0x89, 0x50]))).toBeNull() // truncated header
  })

  it('verifyUpload ignores MIME parameters and case in the claim, but not the bytes', () => {
    expect(verifyUpload('IMAGE/PNG; charset=binary', PNG, ['image/png']).ok).toBe(true)
    expect(verifyUpload('image/png', JPEG, ['image/png']).ok).toBe(false)
  })
})
