'use client'

import React, { useEffect, useState } from 'react'
import { getTopology, type ServiceLocation } from '../lib/api'

// Every port badge and link below used to be a hand-typed literal. That is
// what let RustFS's badge go stale and silently wrong when its host port
// moved from 9000 to 6380 on 2026-09-22 -- nothing here would have noticed a
// port move in a REPO THIS APP DOESN'T EVEN OWN (RustFS belongs to infra-hub).
// Fetched once from the gateway's static service registry instead (see
// getTopology / registerTopologyRoute), so any future port move in any
// service's own .env is what this footer reflects, not a number someone
// remembered to also change here.
const FALLBACK_PORT = '—'

function portOf(services: ServiceLocation[], name: string): string {
  const svc = services.find((s) => s.name === name)
  if (!svc) return FALLBACK_PORT
  try {
    return new URL(svc.url).port || FALLBACK_PORT
  } catch {
    return FALLBACK_PORT
  }
}

function urlOf(services: ServiceLocation[], name: string): string | null {
  return services.find((s) => s.name === name)?.url ?? null
}

export default function StorefrontFooter() {
  const [services, setServices] = useState<ServiceLocation[] | null>(null)

  useEffect(() => {
    let cancelled = false
    getTopology()
      .then((s) => {
        if (!cancelled) setServices(s)
      })
      .catch(() => {
        // Left as null: every badge below reads that as FALLBACK_PORT and the
        // two links fall back to their last-known-good defaults. A decorative
        // footer failing quiet is correct here -- it must never block the
        // storefront the way getProducts/getCategories failing does.
      })
    return () => {
      cancelled = true
    }
  }, [])

  const list = services ?? []
  const adminUrl = urlOf(list, 'admin') ?? 'http://localhost:5461'
  const gatewayUrl = urlOf(list, 'gateway') ?? 'http://localhost:5460'

  return (
    <footer className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-24 pt-12 border-t border-slate-200">
      <div className="flex flex-col md:flex-row items-center justify-between gap-6 text-xs text-slate-500">
        <div className="flex items-center gap-3">
          <span className="font-bold text-slate-800">Microservices Architecture:</span>
          <span className="px-2 py-0.5 rounded bg-slate-200 text-slate-700 font-mono">
            Gateway: {portOf(list, 'gateway')}
          </span>
          <span className="px-2 py-0.5 rounded bg-slate-200 text-slate-700 font-mono">
            User: {portOf(list, 'ms-user')}
          </span>
          <span className="px-2 py-0.5 rounded bg-slate-200 text-slate-700 font-mono">
            Product: {portOf(list, 'ms-product')}
          </span>
          <span className="px-2 py-0.5 rounded bg-slate-200 text-slate-700 font-mono">
            Order: {portOf(list, 'ms-order')}
          </span>
          <span className="px-2 py-0.5 rounded bg-slate-200 text-slate-700 font-mono">
            RustFS: {portOf(list, 'rustfs')}
          </span>
        </div>
        <div className="flex items-center gap-4">
          <a
            href={adminUrl}
            target="_blank"
            rel="noreferrer"
            className="hover:text-indigo-600 font-medium"
          >
            Admin Cockpit &rarr;
          </a>
          <a
            href={`${gatewayUrl}/health`}
            target="_blank"
            rel="noreferrer"
            className="hover:text-indigo-600 font-medium"
          >
            API Gateway Health &rarr;
          </a>
        </div>
      </div>
    </footer>
  )
}
