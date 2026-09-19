import type { FastifyInstance } from 'fastify'
import type { DocumentDatabaseAdapter } from '@ecommerce/shared-database'

const SERVICE = 'ms-product'

interface ColumnView {
  name: string
  type: string
}

interface TableView {
  name: string
  service: string
  driver: string
  rowCount: number
  columns: ColumnView[]
  indexes: never[]
  note?: string
}

interface CollectionSpec {
  name: string
  store: DocumentDatabaseAdapter<Record<string, unknown>>
}

/**
 * NeDB has no fixed schema to introspect (no migrations, no DDL) — instead,
 * one real document is sampled from the collection and its top-level keys are
 * reported with a JS `typeof` per key. This can only ever describe the shape
 * of the sampled document, not a schema contract every document is guaranteed
 * to match; that is the real, honest limitation of an embedded document store.
 */
async function describeCollection(spec: CollectionSpec): Promise<TableView> {
  const all = await spec.store.find({})
  const rowCount = all.length

  if (rowCount === 0) {
    return {
      name: spec.name,
      service: SERVICE,
      driver: 'Embedded NeDB',
      rowCount: 0,
      columns: [],
      indexes: [],
      note: 'Collection is empty — no document available to sample a shape from.',
    }
  }

  const sample = all[0] as Record<string, unknown>
  const columns: ColumnView[] = Object.keys(sample)
    // NeDB's internal id field; `id` (mirrored by the app layer) already
    // covers the same value under the public API's own key.
    .filter((key) => key !== '_id')
    .map((key) => ({
      name: key,
      type:
        typeof sample[key] === 'object' && sample[key] !== null && Array.isArray(sample[key])
          ? 'array'
          : typeof sample[key],
    }))

  return {
    name: spec.name,
    service: SERVICE,
    driver: 'Embedded NeDB',
    rowCount,
    columns,
    indexes: [],
  }
}

export function registerSchemaRoutes(server: FastifyInstance, collections: CollectionSpec[]): void {
  server.get(
    '/api/v1/schema',
    {
      schema: {
        tags: ['schema'],
        description:
          "Real document shape for this service's NeDB collections. NeDB has no fixed " +
          'schema/migrations, so each collection is described by sampling one real document ' +
          '(findOne) and reporting its top-level keys with a JS typeof per key, plus a live ' +
          'rowCount (count of all documents). An empty collection is reported with zero ' +
          'columns and a note rather than fabricated fields.',
        response: {
          200: {
            type: 'object',
            properties: {
              tables: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    name: { type: 'string' },
                    service: { type: 'string' },
                    driver: { type: 'string' },
                    rowCount: { type: 'number' },
                    columns: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          name: { type: 'string' },
                          type: { type: 'string' },
                        },
                        required: ['name', 'type'],
                      },
                    },
                    indexes: { type: 'array', items: { type: 'object' } },
                    note: { type: 'string' },
                  },
                  required: ['name', 'service', 'driver', 'rowCount', 'columns', 'indexes'],
                },
              },
              summary: {
                type: 'object',
                properties: {
                  tableCount: { type: 'number' },
                  columnCount: { type: 'number' },
                  indexCount: { type: 'number' },
                  totalRows: { type: 'number' },
                },
                required: ['tableCount', 'columnCount', 'indexCount', 'totalRows'],
              },
            },
            required: ['tables', 'summary'],
          },
        },
      },
    },
    async () => {
      const tables = await Promise.all(collections.map(describeCollection))

      const summary = {
        tableCount: tables.length,
        columnCount: tables.reduce((sum, t) => sum + t.columns.length, 0),
        indexCount: 0,
        totalRows: tables.reduce((sum, t) => sum + t.rowCount, 0),
      }

      return { tables, summary }
    }
  )
}
