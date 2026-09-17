import * as path from 'path'
import * as util from 'util'
import type Nedb from 'nedb'
import type { DatabaseConfiguration } from './config'

// The `nedb` package (last published in 2016) calls a handful of `util.is*`
// helpers (`isArray`, `isDate`, `isRegExp`) that Node.js deprecated in v4 and
// fully removed in later majors (they are gone as of the Node version this
// monorepo runs on). Polyfill only the specific functions nedb needs, and
// only if they're missing, BEFORE requiring nedb — this keeps the real
// `nedb` package usable without patching its source or switching packages.
// A plain `require()` (rather than `import`) is used deliberately here: an
// ES `import` gets hoisted by TypeScript's CommonJS emit to the top of the
// file (ahead of this polyfill), while `require()` executes exactly where it
// appears in source order, which is what correctness here depends on.
/* eslint-disable @typescript-eslint/no-explicit-any */
const nodeUtil = util as unknown as Record<string, unknown>
if (typeof nodeUtil.isArray !== 'function') {
  nodeUtil.isArray = (arg: unknown): boolean => Array.isArray(arg)
}
if (typeof nodeUtil.isDate !== 'function') {
  nodeUtil.isDate = (arg: unknown): boolean => arg instanceof Date
}
if (typeof nodeUtil.isRegExp !== 'function') {
  nodeUtil.isRegExp = (arg: unknown): boolean => arg instanceof RegExp
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// eslint-disable-next-line @typescript-eslint/no-var-requires
const Datastore = require('nedb') as typeof Nedb

export interface DocumentStoreOptions {
  collection: string
  autoload?: boolean | undefined
}

export interface DocumentDatabaseAdapter<T = unknown> {
  findOne(query: Record<string, unknown>): Promise<T | null>
  find(query: Record<string, unknown>): Promise<T[]>
  insert(doc: T): Promise<T>
  update(query: Record<string, unknown>, updateDoc: Partial<T>): Promise<number>
  delete(query: Record<string, unknown>): Promise<number>
}

/**
 * Embedded Document Store implementation, backed by the real `nedb` package.
 *
 * One physical NeDB file is created per collection, under `dataPath`:
 *   `${dataPath}/${collectionName}.db`
 *
 * If `dataPath` is omitted, or the config explicitly requests in-memory mode,
 * the underlying Datastore is created without a `filename`, which nedb treats
 * as a pure in-memory store (no file I/O) — still real nedb semantics/query
 * engine, just not persisted to disk.
 */
export class EmbeddedDocumentStore<
  T extends { id?: string | undefined; _id?: string | undefined },
> implements DocumentDatabaseAdapter<T> {
  private db: Nedb<T>
  private dataPath: string | undefined
  private collectionName: string
  private readyPromise: Promise<void>

  constructor(collectionName: string, dataPath?: string | undefined, inMemory?: boolean) {
    this.collectionName = collectionName
    this.dataPath = dataPath

    const useFile = !inMemory && !!dataPath
    const filename = useFile ? EmbeddedDocumentStore.resolveFilePath(dataPath!, collectionName) : undefined

    this.db = new Datastore<T>({
      filename,
      autoload: false,
    })

    // Track load completion explicitly rather than relying solely on
    // `autoload`, so callers can be confident the file has been read from
    // disk (or the in-memory store initialised) before any operation runs.
    this.readyPromise = new Promise<void>((resolve, reject) => {
      this.db.loadDatabase((err: Error | null) => {
        if (err) reject(err)
        else resolve()
      })
    })
  }

  /**
   * Resolves the on-disk path for a given collection.
   * - If `dataPath` already points at a single file (ends in `.db`), that
   *   exact file is reused (all collections sharing that dataPath would then
   *   live in the same physical file — not used by current callers, but kept
   *   as a safe fallback for that shape of input).
   * - Otherwise `dataPath` is treated as a directory and one file per
   *   collection is created inside it: `${dataPath}/${collectionName}.db`.
   */
  private static resolveFilePath(dataPath: string, collectionName: string): string {
    if (dataPath.toLowerCase().endsWith('.db')) {
      return dataPath
    }
    return path.join(dataPath, `${collectionName}.db`)
  }

  private async ready(): Promise<void> {
    return this.readyPromise
  }

  getCollectionName(): string {
    return this.collectionName
  }

  getDataPath(): string | undefined {
    return this.dataPath
  }

  async findOne(query: Record<string, unknown>): Promise<T | null> {
    await this.ready()
    return new Promise<T | null>((resolve, reject) => {
      this.db.findOne(query, (err: Error | null, doc: T | null) => {
        if (err) reject(err)
        else resolve(doc ?? null)
      })
    })
  }

  async find(query: Record<string, unknown>): Promise<T[]> {
    await this.ready()
    return new Promise<T[]>((resolve, reject) => {
      this.db.find(query, (err: Error | null, docs: T[]) => {
        if (err) reject(err)
        else resolve(docs)
      })
    })
  }

  async insert(doc: T): Promise<T> {
    await this.ready()
    // Mirror the previous in-memory behaviour: if the caller already
    // supplied an id, use it as nedb's _id too (keeping id === _id).
    // Otherwise let nedb auto-generate _id on insert, then copy it into id.
    const docToInsert: T = { ...doc }
    const existingId = doc.id ?? doc._id
    if (existingId) {
      ;(docToInsert as any).id = existingId
      ;(docToInsert as any)._id = existingId
    }

    return new Promise<T>((resolve, reject) => {
      this.db.insert(docToInsert, (err: Error | null, newDoc: T) => {
        if (err) return reject(err)
        if (!newDoc.id) {
          // nedb generated _id itself — mirror it into id and persist that
          // back so both fields stay equal, matching prior in-memory semantics.
          const generatedId = newDoc._id as string
          this.db.update(
            { _id: generatedId },
            { $set: { id: generatedId } },
            {},
            (updateErr: Error | null) => {
              if (updateErr) return reject(updateErr)
              resolve({ ...newDoc, id: generatedId })
            }
          )
        } else {
          resolve(newDoc)
        }
      })
    })
  }

  async update(query: Record<string, unknown>, updateDoc: Partial<T>): Promise<number> {
    await this.ready()
    return new Promise<number>((resolve, reject) => {
      this.db.update(
        query,
        { $set: updateDoc },
        { multi: true },
        (err: Error | null, numAffected: number) => {
          if (err) reject(err)
          else resolve(numAffected)
        }
      )
    })
  }

  async delete(query: Record<string, unknown>): Promise<number> {
    await this.ready()
    return new Promise<number>((resolve, reject) => {
      this.db.remove(query, { multi: true }, (err: Error | null, numRemoved: number) => {
        if (err) reject(err)
        else resolve(numRemoved)
      })
    })
  }
}

/**
 * Creates document store based on configuration (MongoDB vs NeDB)
 */
export function createDocumentStore<
  T extends { id?: string | undefined; _id?: string | undefined },
>(collectionName: string, config: DatabaseConfiguration): DocumentDatabaseAdapter<T> {
  if (config.document.driver === 'nedb') {
    return new EmbeddedDocumentStore<T>(
      collectionName,
      config.document.nedb.dataPath,
      config.document.nedb.inMemory
    )
  }
  // No real MongoDB-backed adapter exists in this codebase yet. Fall back to
  // the same embedded store, still passing the configured nedb dataPath
  // through (if present) so this branch degrades to a real file-backed store
  // rather than silently going pure in-memory.
  return new EmbeddedDocumentStore<T>(
    collectionName,
    config.document.nedb.dataPath,
    config.document.nedb.inMemory
  )
}
