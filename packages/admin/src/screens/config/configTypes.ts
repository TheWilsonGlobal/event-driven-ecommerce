export interface SchemaColumn {
  name: string
  type: string
  nullable: boolean
  default?: string
  isPrimaryKey?: boolean
  isUnique?: boolean
  references?: string
}

export interface SchemaIndex {
  name: string
  definition: string
}

export interface SchemaTable {
  name: string
  service: string
  /** Dual-mode driver pair this table's store can run as, e.g. "PostgreSQL / SQLite". */
  driver: string
  columns: SchemaColumn[]
  indexes: SchemaIndex[]
  rowCount: number | null
}

export interface SchemaData {
  tables: SchemaTable[]
  summary: {
    tableCount: number
    columnCount: number
    indexCount: number
    totalRows: number
  }
}

export interface ApiEndpoint {
  method: string
  path: string
  summary?: string
  documented: boolean
}

export interface ApiEndpointGroup {
  name: string
  service: string
  port: number
  docsUrl?: string
  endpoints: ApiEndpoint[]
}

export interface ApiEndpointData {
  groups: ApiEndpointGroup[]
  summary: {
    endpointCount: number
    documentedCount: number
    methodCounts: Record<string, number>
  }
}

export interface LogFile {
  filename: string
  service: string
  size: number
  modified: string
  created: string
  level: 'info' | 'warn' | 'error'
  /** Sample content to hand out on download — there is no real log backend behind this mock admin. */
  preview: string
}
