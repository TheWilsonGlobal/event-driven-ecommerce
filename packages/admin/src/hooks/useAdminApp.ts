import { useState, useCallback, useEffect } from 'react'
import { NOTICE_EVENT } from '../auth/notices'
import type { Tab } from '../types'

export function useAdminApp() {
  const [tab, setTab] = useState<Tab>('dashboard')
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    return localStorage.getItem('admin_sidebar_collapsed') === 'true'
  })
  const [autoPolling, setAutoPolling] = useState<boolean>(true)
  const [toastMessage, setToastMessage] = useState<string | null>(null)

  const toggleSidebar = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev
      localStorage.setItem('admin_sidebar_collapsed', String(next))
      return next
    })
  }, [])

  const toggleAutoPolling = useCallback(() => {
    setAutoPolling((prev) => !prev)
  }, [])

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg)
    setTimeout(() => setToastMessage(null), 3000)
  }, [])

  // Notices raised outside React (apiFetch: rate limited, ...) arrive as a
  // window event and reuse the same toast.
  useEffect(() => {
    const onNotice = (e: Event) => showToast(String((e as CustomEvent).detail))
    window.addEventListener(NOTICE_EVENT, onNotice)
    return () => window.removeEventListener(NOTICE_EVENT, onNotice)
  }, [showToast])

  return {
    tab,
    setTab,
    collapsed,
    toggleSidebar,
    autoPolling,
    toggleAutoPolling,
    toastMessage,
    showToast,
  }
}
