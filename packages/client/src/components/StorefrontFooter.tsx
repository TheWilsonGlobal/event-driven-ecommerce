'use client'

import React from 'react'

export default function StorefrontFooter() {
  return (
    <footer className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-24 pt-12 border-t border-slate-200">
      <div className="flex flex-col md:flex-row items-center justify-between gap-6 text-xs text-slate-500">
        <div className="flex items-center gap-3">
          <span className="font-bold text-slate-800">Microservices Architecture:</span>
          <span className="px-2 py-0.5 rounded bg-slate-200 text-slate-700 font-mono">
            Gateway: 3000
          </span>
          <span className="px-2 py-0.5 rounded bg-slate-200 text-slate-700 font-mono">
            User: 3001
          </span>
          <span className="px-2 py-0.5 rounded bg-slate-200 text-slate-700 font-mono">
            Product: 3002
          </span>
          <span className="px-2 py-0.5 rounded bg-slate-200 text-slate-700 font-mono">
            Order: 3003
          </span>
          <span className="px-2 py-0.5 rounded bg-slate-200 text-slate-700 font-mono">
            RustFS: 9000
          </span>
        </div>
        <div className="flex items-center gap-4">
          <a
            href="http://localhost:3005"
            target="_blank"
            rel="noreferrer"
            className="hover:text-indigo-600 font-medium"
          >
            Admin Cockpit &rarr;
          </a>
          <a
            href="http://localhost:3000/health"
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
