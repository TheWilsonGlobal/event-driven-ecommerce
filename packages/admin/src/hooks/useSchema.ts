import { useCallback, useEffect, useState } from 'react'
import type { SchemaResponse, SchemaTable } from '../screens/config/schemaTypes'
import { USER_SERVICE_URL, PRODUCT_SERVICE_URL, ORDER_SERVICE_URL } from '../data/serviceUrls'

// Each of ms-user, ms-order (Prisma/SQLite, via DMMF) and ms-product (NeDB,
// via a sampled document) serves its own real GET /api/v1/schema — the admin
// fetches all three directly and merges the tables into one view, same
// pattern as useApiDocs.

const REQUEST_TIMEOUT_MS = 5000

const SERVICES: { name: string; url: string }[] = [
  { name: 'ms-user', url: USER_SERVICE_URL },
  { name: 'ms-order', url: ORDER_SERVICE_URL },
  { name: 'ms-product', url: PRODUCT_SERVICE_URL },
]

export interface SchemaData {
  tables: SchemaTable[]
  summary: {
    tableCount: number
    columnCount: number
    indexCount: number
    totalRows: number
  }
}

export interface SchemaUnreachable {
  service: string
  message: string
}

export interface SchemaResource {
  data: SchemaData | null
  unreachable: SchemaUnreachable[]
  loading: boolean
  refetch: () => void
}

async function fetchSchema(url: string): Promise<SchemaResponse> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const res = await fetch(`${url}/api/v1/schema`, { signal: controller.signal })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return (await res.json()) as SchemaResponse
  } finally {
    clearTimeout(timeoutId)
  }
}

export function useSchema(): SchemaResource {
  const [data, setData] = useState<SchemaData | null>(null)
  const [unreachable, setUnreachable] = useState<SchemaUnreachable[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    const results = await Promise.allSettled(SERVICES.map((s) => fetchSchema(s.url)))

    const tables: SchemaTable[] = []
    const failures: SchemaUnreachable[] = []
    for (let i = 0; i < results.length; i++) {
      const result = results[i]
      const svc = SERVICES[i]
      if (result.status === 'fulfilled') {
        tables.push(...result.value.tables)
      } else {
        failures.push({
          service: svc.name,
          message: result.reason instanceof Error ? result.reason.message : String(result.reason),
        })
      }
    }

    const summary = {
      tableCount: tables.length,
      columnCount: tables.reduce((sum, t) => sum + t.columns.length, 0),
      indexCount: tables.reduce((sum, t) => sum + t.indexes.length, 0),
      totalRows: tables.reduce((sum, t) => sum + t.rowCount, 0),
    }

    setData(tables.length > 0 ? { tables, summary } : null)
    setUnreachable(failures)
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const refetch = useCallback(() => {
    void load()
  }, [load])

  return { data, unreachable, loading, refetch }
}
