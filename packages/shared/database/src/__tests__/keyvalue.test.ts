import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { EmbeddedKeyValueStore, createKeyValueStore, globToRegExp } from '../keyvalue'
import { loadDatabaseConfig } from '../config'

describe('globToRegExp', () => {
  it('treats * as a multi-character wildcard', () => {
    expect(globToRegExp('*').test('anything')).toBe(true)
    expect(globToRegExp('bull:*').test('bull:order-expiration:meta')).toBe(true)
    expect(globToRegExp('bull:*').test('cache:products:1')).toBe(false)
  })

  it('treats ? as exactly one character', () => {
    expect(globToRegExp('a?c').test('abc')).toBe(true)
    expect(globToRegExp('a?c').test('ac')).toBe(false)
    expect(globToRegExp('a?c').test('abbc')).toBe(false)
  })

  it('escapes regex metacharacters so they match literally', () => {
    // The classic bug: escaping after wildcard substitution turns the literal
    // dot into "any character", so a.b would wrongly match axb.
    expect(globToRegExp('a.b').test('a.b')).toBe(true)
    expect(globToRegExp('a.b').test('axb')).toBe(false)
    expect(globToRegExp('total+').test('total+')).toBe(true)
    expect(globToRegExp('total+').test('totalll')).toBe(false)
  })

  it('anchors the pattern at both ends', () => {
    expect(globToRegExp('session').test('session')).toBe(true)
    expect(globToRegExp('session').test('my:session:1')).toBe(false)
  })

  it('matches real BullMQ key shapes', () => {
    const pattern = globToRegExp('bull:order-expiration:*')
    expect(pattern.test('bull:order-expiration:meta')).toBe(true)
    expect(pattern.test('bull:order-expiration:expire-4da7e569-10a8')).toBe(true)
    expect(pattern.test('bull:payment-retry:meta')).toBe(false)
  })
})

describe('EmbeddedKeyValueStore (in-memory)', () => {
  let store: EmbeddedKeyValueStore

  beforeEach(() => {
    store = new EmbeddedKeyValueStore(undefined, true)
  })

  it('round-trips values through get/set', async () => {
    await store.set('a', '1')
    expect(await store.get('a')).toBe('1')
    expect(await store.get('missing')).toBeNull()
  })

  it('reports existence and deletes', async () => {
    await store.set('a', '1')
    expect(await store.exists('a')).toBe(true)
    expect(await store.del('a')).toBe(true)
    expect(await store.del('a')).toBe(false)
    expect(await store.exists('a')).toBe(false)
  })

  it('clears everything on flush', async () => {
    await store.set('a', '1')
    await store.set('b', '2')
    await store.flush()
    expect((await store.scan('*')).keys).toEqual([])
  })

  it('uses Redis TTL conventions', async () => {
    await store.set('forever', 'v')
    expect(await store.ttl('forever')).toBe(-1)
    expect(await store.ttl('absent')).toBe(-2)

    await store.set('soon', 'v', 60)
    const remaining = await store.ttl('soon')
    expect(remaining).toBeGreaterThan(0)
    expect(remaining).toBeLessThanOrEqual(60)
  })

  it('scans with a pattern and reports truncation', async () => {
    await store.set('bull:a', '1')
    await store.set('bull:b', '2')
    await store.set('cache:c', '3')

    const all = await store.scan('*')
    expect(all.keys).toEqual(['bull:a', 'bull:b', 'cache:c'])
    expect(all.truncated).toBe(false)

    const filtered = await store.scan('bull:*')
    expect(filtered.keys).toEqual(['bull:a', 'bull:b'])

    const capped = await store.scan('*', 2)
    expect(capped.keys).toHaveLength(2)
    expect(capped.truncated).toBe(true)
  })

  it('expires entries once their TTL passes', async () => {
    await store.set('brief', 'v', 1)
    expect(await store.get('brief')).toBe('v')

    await new Promise((resolve) => setTimeout(resolve, 1100))

    expect(await store.get('brief')).toBeNull()
    expect(await store.ttl('brief')).toBe(-2)
    expect((await store.scan('*')).keys).not.toContain('brief')
  })
})

describe('EmbeddedKeyValueStore (file-backed)', () => {
  let dir: string

  beforeEach(async () => {
    dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'kvtest-'))
  })

  afterEach(async () => {
    await fs.promises.rm(dir, { recursive: true, force: true })
  })

  it('persists across instances', async () => {
    const first = new EmbeddedKeyValueStore(dir, false)
    await first.set('persisted', 'value')
    await first.set('with-ttl', 'value', 3600)
    await first.close()

    const snapshotPath = path.join(dir, 'keyvalue.db')
    expect(fs.existsSync(snapshotPath)).toBe(true)

    const raw = JSON.parse(await fs.promises.readFile(snapshotPath, 'utf8'))
    expect(raw.version).toBe(1)

    const second = new EmbeddedKeyValueStore(dir, false)
    expect(await second.get('persisted')).toBe('value')
    expect(await second.ttl('with-ttl')).toBeGreaterThan(0)
    await second.close()
  })

  it('sweeps entries that expired while the process was down', async () => {
    const snapshotPath = path.join(dir, 'keyvalue.db')
    await fs.promises.writeFile(
      snapshotPath,
      JSON.stringify({
        version: 1,
        savedAt: new Date().toISOString(),
        entries: [
          ['stale', { value: 'x', expiresAt: Date.now() - 1000 }],
          ['fresh', { value: 'y' }],
        ],
      }),
      'utf8'
    )

    const store = new EmbeddedKeyValueStore(dir, false)
    expect((await store.scan('*')).keys).toEqual(['fresh'])
    expect(await store.get('stale')).toBeNull()
    await store.close()
  })

  it('survives a corrupt snapshot without throwing or deleting it', async () => {
    const snapshotPath = path.join(dir, 'keyvalue.db')
    await fs.promises.writeFile(snapshotPath, '{ not valid json', 'utf8')

    const store = new EmbeddedKeyValueStore(dir, false)
    expect((await store.scan('*')).keys).toEqual([])
    expect(store.getLastLoadError()).not.toBeNull()
    // The unreadable file is preserved for recovery rather than clobbered.
    expect(fs.existsSync(snapshotPath)).toBe(true)
  })

  it('treats a missing snapshot as first boot, not an error', async () => {
    const store = new EmbeddedKeyValueStore(path.join(dir, 'nested'), false)
    expect((await store.scan('*')).keys).toEqual([])
    expect(store.getLastLoadError()).toBeNull()
    await store.close()
  })

  it('uses a .db dataPath verbatim', async () => {
    const explicit = path.join(dir, 'custom.db')
    const store = new EmbeddedKeyValueStore(explicit, false)
    expect(store.getFilePath()).toBe(explicit)
    await store.set('k', 'v')
    await store.close()
    expect(fs.existsSync(explicit)).toBe(true)
  })
})

describe('createKeyValueStore / driver resolution', () => {
  it('falls back to the mode default for an unrecognised driver', () => {
    const config = loadDatabaseConfig({ KV_CACHE_DRIVER: 'garbage', DB_MODE: 'embedded' } as never)
    expect(config.keyValue.driver).toBe('rocksdb')
  })

  it('accepts each valid driver', () => {
    for (const driver of ['redis', 'rocksdb', 'embedded']) {
      const config = loadDatabaseConfig({ KV_CACHE_DRIVER: driver } as never)
      expect(config.keyValue.driver).toBe(driver)
    }
  })

  it('persists by default and only runs in memory when asked', () => {
    expect(loadDatabaseConfig({} as never).keyValue.embedded.inMemory).toBe(false)
    expect(
      loadDatabaseConfig({ EMBEDDED_KV_IN_MEMORY: 'true' } as never).keyValue.embedded.inMemory
    ).toBe(true)
  })

  it('builds an embedded store for every driver', () => {
    for (const driver of ['redis', 'rocksdb', 'embedded']) {
      const config = loadDatabaseConfig({ KV_CACHE_DRIVER: driver } as never)
      expect(createKeyValueStore(config)).toBeInstanceOf(EmbeddedKeyValueStore)
    }
  })

  it('keeps the redis driver in memory, since ioredis owns that path', () => {
    const config = loadDatabaseConfig({ KV_CACHE_DRIVER: 'redis' } as never)
    const store = createKeyValueStore(config) as EmbeddedKeyValueStore
    expect(store.isPersistent()).toBe(false)
  })
})
