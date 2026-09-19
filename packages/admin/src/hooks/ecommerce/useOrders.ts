import { useState, useMemo, useEffect, useCallback } from 'react'
import type { OrderRecord } from '../../types'
import { ORDER_SERVICE_URL } from '../../data/serviceUrls'
import { FETCH_ALL_LIMIT, mapOrder } from './mappers'

export function useOrders(showToast: (msg: string) => void) {
  const [orders, setOrders] = useState<OrderRecord[]>([])
  const [ordersLoading, setOrdersLoading] = useState<boolean>(true)
  const [ordersError, setOrdersError] = useState<string | null>(null)

  const [selectedOrder, setSelectedOrder] = useState<OrderRecord | null>(null)

  // Filters
  const [orderSearch, setOrderSearch] = useState<string>('')
  const [orderStatusFilter, setOrderStatusFilter] = useState<string>('ALL')

  const fetchOrders = useCallback(async () => {
    setOrdersLoading(true)
    setOrdersError(null)
    try {
      const res = await fetch(`${ORDER_SERVICE_URL}/api/v1/orders?page=1&limit=${FETCH_ALL_LIMIT}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setOrders((data.orders ?? []).map(mapOrder))
    } catch (err) {
      setOrdersError(
        err instanceof Error ? err.message : 'Failed to load orders — is ms-order (5465) running?'
      )
    } finally {
      setOrdersLoading(false)
    }
  }, [])

  useEffect(() => {
    void fetchOrders()
  }, [fetchOrders])

  const handleUpdateOrderStatus = async (orderId: string, newStatus: OrderRecord['status']) => {
    try {
      const res = await fetch(`${ORDER_SERVICE_URL}/api/v1/orders/${orderId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error ?? `HTTP ${res.status}`)
      }
      showToast(`Order status updated to ${newStatus}`)
      if (selectedOrder?.id === orderId) {
        setSelectedOrder((prev) => (prev ? { ...prev, status: newStatus } : null))
      }
      await fetchOrders()
    } catch (err) {
      showToast(
        `Failed to update order status: ${err instanceof Error ? err.message : 'Unknown error'}`
      )
    }
  }

  const filteredOrders = useMemo(() => {
    return orders.filter((o) => {
      const matches =
        o.orderNumber.toLowerCase().includes(orderSearch.toLowerCase()) ||
        o.customerName.toLowerCase().includes(orderSearch.toLowerCase()) ||
        o.customerEmail.toLowerCase().includes(orderSearch.toLowerCase())
      const statusMatch = orderStatusFilter === 'ALL' || o.status === orderStatusFilter
      return matches && statusMatch
    })
  }, [orders, orderSearch, orderStatusFilter])

  return {
    orders,
    ordersLoading,
    ordersError,
    fetchOrders,
    selectedOrder,
    setSelectedOrder,
    orderSearch,
    setOrderSearch,
    orderStatusFilter,
    setOrderStatusFilter,
    filteredOrders,
    handleUpdateOrderStatus,
  }
}
