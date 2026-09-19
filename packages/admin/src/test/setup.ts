import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

// Every screen probes a backend service on mount (health checks, list
// fetches, queue/cache introspection). None of those services are running
// under Vitest, so stub `fetch` to fail fast and quietly rather than letting
// real network calls hang the test or spam unhandled-rejection noise. Each
// hook already treats a failed fetch as "service unreachable" and renders
// that state, so this doesn't hide anything the component needs to handle.
beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.reject(new Error('fetch disabled in tests')))
  )
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})
