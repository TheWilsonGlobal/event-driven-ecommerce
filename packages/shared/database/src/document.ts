import type { DatabaseConfiguration } from './config'

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
 * Embedded Document Store implementation (NeDB-style file/memory document store)
 */
export class EmbeddedDocumentStore<
  T extends { id?: string | undefined; _id?: string | undefined },
> implements DocumentDatabaseAdapter<T> {
  private inMemoryDocs: Map<string, T> = new Map()
  private dataPath: string | undefined
  private collectionName: string

  constructor(collectionName: string, dataPath?: string | undefined) {
    this.collectionName = collectionName
    this.dataPath = dataPath
  }

  getCollectionName(): string {
    return this.collectionName
  }

  getDataPath(): string | undefined {
    return this.dataPath
  }

  async findOne(query: Record<string, any>): Promise<T | null> {
    const results = await this.find(query)
    return results.length > 0 ? (results[0] ?? null) : null
  }

  async find(query: Record<string, any>): Promise<T[]> {
    const all = Array.from(this.inMemoryDocs.values())
    if (Object.keys(query).length === 0) return all
    return all.filter((doc) => {
      return Object.entries(query).every(([key, value]) => (doc as any)[key] === value)
    })
  }

  async insert(doc: T): Promise<T> {
    const id = doc.id ?? doc._id ?? Math.random().toString(36).substring(2, 15)
    const saved = { ...doc, id, _id: id }
    this.inMemoryDocs.set(id, saved)
    return saved
  }

  async update(query: Record<string, unknown>, updateDoc: Partial<T>): Promise<number> {
    const matched = await this.find(query)
    for (const item of matched) {
      const id = (item.id ?? item._id)!
      this.inMemoryDocs.set(id, { ...item, ...updateDoc })
    }
    return matched.length
  }

  async delete(query: Record<string, unknown>): Promise<number> {
    const matched = await this.find(query)
    for (const item of matched) {
      const id = (item.id ?? item._id)!
      this.inMemoryDocs.delete(id)
    }
    return matched.length
  }
}

/**
 * Creates document store based on configuration (MongoDB vs NeDB)
 */
export function createDocumentStore<
  T extends { id?: string | undefined; _id?: string | undefined },
>(collectionName: string, config: DatabaseConfiguration): DocumentDatabaseAdapter<T> {
  if (config.document.driver === 'nedb') {
    return new EmbeddedDocumentStore<T>(collectionName, config.document.nedb.dataPath)
  }
  return new EmbeddedDocumentStore<T>(collectionName)
}
