import { describe, it, expect } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from '../App'

// Mount effects (service health probes) fire a rejected, mocked `fetch` on
// render; flushing one microtask tick lets those rejections settle inside
// `act` before assertions run, instead of leaking into whichever test
// happens to be running next.
const flush = () => act(async () => {})

// Import/render smoke test.
//
// This is not a behavioral test — it exists to catch a broken reference
// anywhere in the app's static import graph (a typo'd path, a stale name
// after a rename, a module that throws on eval) before it ships. Rendering
// <App /> and navigating into every sidebar tab pulls in every screen,
// including the ones that are only reachable through a click (screens are
// rendered conditionally on the active tab, not lazy-imported, so the module
// graph is already loaded on the initial import — but we click through
// anyway so each screen also mounts and renders without throwing).
describe('App smoke test', () => {
  it('renders the shell without throwing', async () => {
    render(<App />)
    await flush()
    expect(screen.getByText('Admin Cockpit', { exact: false })).toBeInTheDocument()
  })

  it('navigates through every tab — including Infra — without throwing', async () => {
    const user = userEvent.setup()
    render(<App />)
    await flush()

    const tabLabels = [
      'Dashboard',
      'Products',
      'Orders & Sagas',
      'Users & Roles',
      'Configuration',
      'Task Queues',
      'Events',
      'Infra',
      'KV Cache',
      'S3 Storage',
    ]

    for (const label of tabLabels) {
      await user.click(screen.getByTitle(label))

      // The Infra tab (screens/InfraTab.tsx -> screens/config/InfraPanel.tsx,
      // sourced from data/serviceRegistry.ts) defaults to its "Overview" sub-tab
      // on mount — check for it right after the click, before navigating away,
      // to confirm the renamed chain actually rendered rather than the click
      // silently no-oping.
      if (label === 'Infra') {
        expect(screen.getByText('Overview')).toBeInTheDocument()
      }
    }
  })
})
