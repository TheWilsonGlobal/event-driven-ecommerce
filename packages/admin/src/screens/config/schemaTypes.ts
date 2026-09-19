// Shape of GET /api/v1/schema, served by ms-user, ms-order (Prisma/SQLite —
// introspected from Prisma's DMMF) and ms-product (NeDB — sampled from one
// real document per collection). The two backends report different column
// detail (NeDB has no nullable/PK/unique/default/references), so every field
// beyond name/type is optional here rather than only present for one driver.

export interface SchemaColumn {
  name: string
  type: string
  nullable?: boolean
  isPrimaryKey?: boolean
  isUnique?: boolean
  default?: string | null
  references?: string | null
}

export interface SchemaIndex {
  name: string
  definition: string
}

export interface SchemaTable {
  name: string
  service: string
  driver: string
  rowCount: number
  columns: SchemaColumn[]
  indexes: SchemaIndex[]
  /** ms-product only: set when a collection is empty, so nothing was sampled. */
  note?: string
}

export interface SchemaResponse {
  tables: SchemaTable[]
  summary: {
    tableCount: number
    columnCount: number
    indexCount: number
    totalRows: number
  }
}
