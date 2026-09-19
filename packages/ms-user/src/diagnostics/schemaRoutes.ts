import type { FastifyInstance } from 'fastify'
import { Prisma, PrismaClient } from '../../node_modules/.prisma-ms-user/client'

const SERVICE = 'ms-user'

interface ColumnView {
  name: string
  type: string
  nullable: boolean
  isPrimaryKey: boolean
  isUnique: boolean
  default: string | null
  references: string | null
}

interface IndexView {
  name: string
  definition: string
}

interface TableView {
  name: string
  service: string
  driver: string
  rowCount: number
  columns: ColumnView[]
  indexes: IndexView[]
}

/** Renders a DMMF field default (scalar | {name, args}) into a readable string. */
function formatDefault(field: Prisma.DMMF.Field): string | null {
  if (!field.hasDefaultValue) return null
  const d = field.default
  if (d === undefined) return null
  if (typeof d === 'object' && d !== null && 'name' in d) {
    const call = d as { name: string; args: unknown[] }
    return call.args.length > 0 ? `${call.name}(${call.args.join(', ')})` : `${call.name}()`
  }
  return String(d)
}

/**
 * Maps one Prisma DMMF model to the admin schema-tab shape. DMMF
 * (`Prisma.dmmf.datamodel.models`) is the source of truth here — it is
 * generated straight from schema.prisma, so this can never drift from the
 * real schema file the way a hand-maintained description would.
 */
function mapModelToTable(model: Prisma.DMMF.Model, rowCount: number): TableView {
  const scalarFields = model.fields.filter((f) => f.kind !== 'object')
  const relationFields = model.fields.filter((f) => f.kind === 'object')

  // scalar field name -> "Model.field" it references, derived from the
  // relation side that owns the FK (relationFromFields is non-empty there).
  const referencesByField = new Map<string, string>()
  for (const rel of relationFields) {
    rel.relationFromFields?.forEach((fkField, i) => {
      const targetField = rel.relationToFields?.[i] ?? 'id'
      referencesByField.set(fkField, `${rel.type}.${targetField}`)
    })
  }

  const columns: ColumnView[] = scalarFields.map((field) => ({
    name: field.dbName ?? field.name,
    type: field.type,
    nullable: !field.isRequired,
    isPrimaryKey: field.isId,
    isUnique: field.isUnique,
    default: formatDefault(field),
    references: referencesByField.get(field.name) ?? null,
  }))

  // Indexes derived only from @unique/@@index annotations DMMF exposes
  // (model.uniqueIndexes for @@unique, field.isUnique for column-level
  // @unique, model.primaryKey for @@id) — never fabricated.
  const indexes: IndexView[] = []
  for (const field of scalarFields) {
    if (field.isUnique && !field.isId) {
      indexes.push({
        name: `${model.dbName ?? model.name}_${field.dbName ?? field.name}_key`,
        definition: `UNIQUE (${field.dbName ?? field.name})`,
      })
    }
  }
  for (const uniq of model.uniqueIndexes) {
    const cols = uniq.fields.map((f) => f)
    indexes.push({
      name: uniq.name ?? `${model.dbName ?? model.name}_${cols.join('_')}_key`,
      definition: `UNIQUE (${cols.join(', ')})`,
    })
  }

  return {
    name: model.dbName ?? model.name,
    service: SERVICE,
    driver: 'SQLite (Prisma ORM)',
    rowCount,
    columns,
    indexes,
  }
}

export function registerSchemaRoutes(server: FastifyInstance, prisma: PrismaClient): void {
  server.get(
    '/api/v1/schema',
    {
      schema: {
        tags: ['schema'],
        description:
          "Real database structure for this service's SQLite database, introspected from " +
          "Prisma's DMMF (generated from schema.prisma) so it can never drift from the real " +
          'schema file. rowCount is a live count() per table, run at request time.',
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
                          nullable: { type: 'boolean' },
                          isPrimaryKey: { type: 'boolean' },
                          isUnique: { type: 'boolean' },
                          default: { type: ['string', 'null'] },
                          references: { type: ['string', 'null'] },
                        },
                        required: [
                          'name',
                          'type',
                          'nullable',
                          'isPrimaryKey',
                          'isUnique',
                          'default',
                          'references',
                        ],
                      },
                    },
                    indexes: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          name: { type: 'string' },
                          definition: { type: 'string' },
                        },
                        required: ['name', 'definition'],
                      },
                    },
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
      const models = Prisma.dmmf.datamodel.models

      const rowCounts = await Promise.all(
        models.map(async (model) => {
          const delegate = (prisma as unknown as Record<string, { count: () => Promise<number> }>)[
            model.name.charAt(0).toLowerCase() + model.name.slice(1)
          ]
          return delegate ? delegate.count() : 0
        })
      )

      const tables = models.map((model, i) => mapModelToTable(model, rowCounts[i]))

      const summary = {
        tableCount: tables.length,
        columnCount: tables.reduce((sum, t) => sum + t.columns.length, 0),
        indexCount: tables.reduce((sum, t) => sum + t.indexes.length, 0),
        totalRows: tables.reduce((sum, t) => sum + t.rowCount, 0),
      }

      return { tables, summary }
    }
  )
}
