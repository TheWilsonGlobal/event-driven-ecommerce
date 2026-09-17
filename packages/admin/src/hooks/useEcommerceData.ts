import { useState, useMemo, useEffect, useCallback } from 'react'
import type { ServiceItem, UserRecord, ProductRecord, OrderRecord } from '../types'
import { useServiceProbes } from './useServiceProbes'

const USER_SERVICE_URL = 'http://localhost:3001'
const PRODUCT_SERVICE_URL = 'http://localhost:3002'
const ORDER_SERVICE_URL = 'http://localhost:3003'

// This admin dashboard doesn't have real pagination UI wired to these list
// endpoints yet — request a single large page and let the existing
// client-side filteredX/useMemo + per-tab Pagination components keep working
// against the full set, same as they did against the old static arrays.
const FETCH_ALL_LIMIT = 100

// ─── API → UserRecord/ProductRecord/OrderRecord mapping ───────────────────
// The backend shapes were designed to match these types closely; these
// mapping functions exist mainly to coerce optional/missing fields to safe
// defaults rather than to reshape data, so a partial/unexpected response
// never crashes the table render.

function mapUser(raw: any): UserRecord {
  return {
    id: raw.id,
    email: raw.email,
    firstName: raw.firstName,
    lastName: raw.lastName,
    role: raw.role,
    isActive: Boolean(raw.isActive),
    isEmailVerified: Boolean(raw.isEmailVerified),
    addresses: Array.isArray(raw.addresses) ? raw.addresses : [],
    createdAt: raw.createdAt,
  }
}

function mapProduct(raw: any): ProductRecord {
  return {
    id: raw.id,
    title: raw.title,
    slug: raw.slug,
    sku: raw.sku,
    description: raw.description ?? '',
    price: Number(raw.price) || 0,
    compareAtPrice: Number(raw.compareAtPrice ?? raw.price) || 0,
    currency: raw.currency ?? 'USD',
    stock: Number(raw.stock) || 0,
    isAvailable: raw.isAvailable ?? true,
    category: raw.category ?? { id: '', name: '', slug: '' },
    tags: Array.isArray(raw.tags) ? raw.tags : [],
    images: Array.isArray(raw.images) ? raw.images : [],
    attributes: Array.isArray(raw.attributes) ? raw.attributes : [],
    ratings: raw.ratings ?? { average: 0, count: 0 },
  }
}

function mapOrder(raw: any): OrderRecord {
  return {
    id: raw.id,
    orderNumber: raw.orderNumber,
    customerId: raw.customerId,
    customerName: raw.customerName,
    customerEmail: raw.customerEmail,
    status: raw.status,
    subtotal: Number(raw.subtotal) || 0,
    taxAmount: Number(raw.taxAmount) || 0,
    shippingAmount: Number(raw.shippingAmount) || 0,
    discountAmount: Number(raw.discountAmount) || 0,
    totalAmount: Number(raw.totalAmount) || 0,
    currency: raw.currency ?? 'USD',
    paymentMethod: raw.paymentMethod,
    paymentStatus: raw.paymentStatus,
    transactionId: raw.transactionId ?? '',
    shippingAddress: raw.shippingAddress,
    items: Array.isArray(raw.items) ? raw.items : [],
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
    receiptUrl: raw.receiptUrl,
  }
}

export function useEcommerceData(autoPolling: boolean, showToast: (msg: string) => void) {
  const { services, lastScanned, rustfsHealth, pingRustFS, pingServices } =
    useServiceProbes(autoPolling)

  const [users, setUsers] = useState<UserRecord[]>([])
  const [products, setProducts] = useState<ProductRecord[]>([])
  const [orders, setOrders] = useState<OrderRecord[]>([])

  const [usersLoading, setUsersLoading] = useState<boolean>(true)
  const [productsLoading, setProductsLoading] = useState<boolean>(true)
  const [ordersLoading, setOrdersLoading] = useState<boolean>(true)

  const [usersError, setUsersError] = useState<string | null>(null)
  const [productsError, setProductsError] = useState<string | null>(null)
  const [ordersError, setOrdersError] = useState<string | null>(null)

  // Modals & Selection state
  const [selectedService, setSelectedService] = useState<ServiceItem | null>(null)
  const [selectedOrder, setSelectedOrder] = useState<OrderRecord | null>(null)
  const [selectedUser, setSelectedUser] = useState<UserRecord | null>(null)
  const [isUserModalOpen, setIsUserModalOpen] = useState<boolean>(false)
  const [editingUser, setEditingUser] = useState<UserRecord | null>(null)
  const [isProductModalOpen, setIsProductModalOpen] = useState<boolean>(false)
  const [editingProduct, setEditingProduct] = useState<ProductRecord | null>(null)

  // Filters
  const [userSearch, setUserSearch] = useState<string>('')
  const [userRoleFilter, setUserRoleFilter] = useState<string>('ALL')
  const [productSearch, setProductSearch] = useState<string>('')
  const [productCategoryFilter, setProductCategoryFilter] = useState<string>('ALL')
  const [orderSearch, setOrderSearch] = useState<string>('')
  const [orderStatusFilter, setOrderStatusFilter] = useState<string>('ALL')

  // ─── Fetchers ─────────────────────────────────────────────────────────
  const fetchUsers = useCallback(async () => {
    setUsersLoading(true)
    setUsersError(null)
    try {
      const res = await fetch(`${USER_SERVICE_URL}/api/v1/users?page=1&limit=${FETCH_ALL_LIMIT}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setUsers((data.users ?? []).map(mapUser))
    } catch (err) {
      setUsersError(
        err instanceof Error ? err.message : 'Failed to load users — is ms-user (3001) running?'
      )
    } finally {
      setUsersLoading(false)
    }
  }, [])

  const fetchProducts = useCallback(async () => {
    setProductsLoading(true)
    setProductsError(null)
    try {
      const res = await fetch(
        `${PRODUCT_SERVICE_URL}/api/v1/products?page=1&limit=${FETCH_ALL_LIMIT}`
      )
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setProducts((data.products ?? []).map(mapProduct))
    } catch (err) {
      setProductsError(
        err instanceof Error
          ? err.message
          : 'Failed to load products — is ms-product (3002) running?'
      )
    } finally {
      setProductsLoading(false)
    }
  }, [])

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
        err instanceof Error ? err.message : 'Failed to load orders — is ms-order (3003) running?'
      )
    } finally {
      setOrdersLoading(false)
    }
  }, [])

  useEffect(() => {
    // Independent fetches: one backend being down must not block the others.
    void fetchUsers()
    void fetchProducts()
    void fetchOrders()
  }, [fetchUsers, fetchProducts, fetchOrders])

  // User Handlers
  const handleSaveUser = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const formData = new FormData(e.currentTarget)
    const firstName = formData.get('firstName') as string
    const lastName = formData.get('lastName') as string
    const email = formData.get('email') as string
    const role = formData.get('role') as 'ADMIN' | 'CUSTOMER' | 'VENDOR'
    const isActive = formData.get('isActive') === 'on'
    const addressLine1 = formData.get('addressLine1') as string
    const city = formData.get('city') as string
    const state = formData.get('state') as string
    const postalCode = formData.get('postalCode') as string

    // Close immediately (fire-and-forget) — the list re-fetch below updates
    // the table a moment later once the request resolves. Matches the modal's
    // existing behavior of closing on submit rather than gating on a result.
    setIsUserModalOpen(false)
    setEditingUser(null)

    try {
      if (editingUser) {
        const res = await fetch(`${USER_SERVICE_URL}/api/v1/users/${editingUser.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ firstName, lastName, role, isActive }),
        })
        if (!res.ok) {
          const err = await res.json().catch(() => ({}))
          throw new Error(err.message ?? `HTTP ${res.status}`)
        }
        showToast(`User ${firstName} updated!`)
      } else {
        const res = await fetch(`${USER_SERVICE_URL}/api/v1/users`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email,
            firstName,
            lastName,
            role,
            isActive,
            addressLine1,
            city,
            state,
            postalCode,
          }),
        })
        if (!res.ok) {
          const err = await res.json().catch(() => ({}))
          throw new Error(err.message ?? `HTTP ${res.status}`)
        }
        showToast(`User ${firstName} created!`)
      }
      await fetchUsers()
    } catch (err) {
      showToast(`Failed to save user: ${err instanceof Error ? err.message : 'Unknown error'}`)
    }
  }

  const handleDeleteUser = async (id: string) => {
    if (!confirm('Are you sure you want to delete this user?')) return
    try {
      const res = await fetch(`${USER_SERVICE_URL}/api/v1/users/${id}`, { method: 'DELETE' })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.message ?? `HTTP ${res.status}`)
      }
      showToast('User deleted')
      await fetchUsers()
    } catch (err) {
      showToast(`Failed to delete user: ${err instanceof Error ? err.message : 'Unknown error'}`)
    }
  }

  const handleToggleUserStatus = async (user: UserRecord) => {
    try {
      const res = await fetch(`${USER_SERVICE_URL}/api/v1/users/${user.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !user.isActive }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.message ?? `HTTP ${res.status}`)
      }
      showToast(`User ${user.firstName} status toggled`)
      await fetchUsers()
    } catch (err) {
      showToast(
        `Failed to toggle user status: ${err instanceof Error ? err.message : 'Unknown error'}`
      )
    }
  }

  // Product Handlers
  const handleSaveProduct = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const formData = new FormData(e.currentTarget)
    const title = formData.get('title') as string
    const sku = formData.get('sku') as string
    const price = parseFloat(formData.get('price') as string) || 99.99
    const compareAtPrice = parseFloat(formData.get('compareAtPrice') as string) || price * 1.2
    const stock = parseInt(formData.get('stock') as string, 10) || 50
    const description = formData.get('description') as string
    const categoryName = formData.get('category') as string
    const imageUrl =
      (formData.get('imageUrl') as string) ||
      'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=800&q=80'

    const category = {
      id: categoryName.toLowerCase().replace(/\s+/g, '-'),
      name: categoryName,
      slug: categoryName.toLowerCase().replace(/\s+/g, '-'),
    }

    setIsProductModalOpen(false)
    setEditingProduct(null)

    try {
      if (editingProduct) {
        const res = await fetch(`${PRODUCT_SERVICE_URL}/api/v1/products/${editingProduct.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title,
            sku,
            price,
            compareAtPrice,
            stock,
            description,
            category,
          }),
        })
        if (!res.ok) {
          const err = await res.json().catch(() => ({}))
          throw new Error(err.error ?? `HTTP ${res.status}`)
        }
        showToast(`Product "${title}" updated!`)
      } else {
        const res = await fetch(`${PRODUCT_SERVICE_URL}/api/v1/products`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title,
            slug: title.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
            sku,
            price,
            compareAtPrice,
            currency: 'USD',
            stock,
            isAvailable: true,
            description,
            category,
            tags: ['featured', 'catalog'],
            images: [{ url: imageUrl, alt: title, isPrimary: true }],
            attributes: [{ name: 'Warranty', value: '2 Years' }],
            ratings: { average: 5.0, count: 1 },
          }),
        })
        if (!res.ok) {
          const err = await res.json().catch(() => ({}))
          throw new Error(err.error ?? `HTTP ${res.status}`)
        }
        showToast(`Product "${title}" added!`)
      }
      await fetchProducts()
    } catch (err) {
      showToast(`Failed to save product: ${err instanceof Error ? err.message : 'Unknown error'}`)
    }
  }

  const handleDeleteProduct = async (id: string) => {
    if (!confirm('Are you sure you want to delete this product?')) return
    try {
      const res = await fetch(`${PRODUCT_SERVICE_URL}/api/v1/products/${id}`, {
        method: 'DELETE',
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error ?? `HTTP ${res.status}`)
      }
      showToast('Product deleted')
      await fetchProducts()
    } catch (err) {
      showToast(`Failed to delete product: ${err instanceof Error ? err.message : 'Unknown error'}`)
    }
  }

  // Order Handlers
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

  // Filtered lists
  const filteredUsers = useMemo(() => {
    return users.filter((u) => {
      const matches =
        u.firstName.toLowerCase().includes(userSearch.toLowerCase()) ||
        u.lastName.toLowerCase().includes(userSearch.toLowerCase()) ||
        u.email.toLowerCase().includes(userSearch.toLowerCase())
      const roleMatch = userRoleFilter === 'ALL' || u.role === userRoleFilter
      return matches && roleMatch
    })
  }, [users, userSearch, userRoleFilter])

  const filteredProducts = useMemo(() => {
    return products.filter((p) => {
      const matches =
        p.title.toLowerCase().includes(productSearch.toLowerCase()) ||
        p.sku.toLowerCase().includes(productSearch.toLowerCase()) ||
        p.description.toLowerCase().includes(productSearch.toLowerCase())
      const catMatch = productCategoryFilter === 'ALL' || p.category.name === productCategoryFilter
      return matches && catMatch
    })
  }, [products, productSearch, productCategoryFilter])

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
    services,
    users,
    products,
    orders,
    usersLoading,
    productsLoading,
    ordersLoading,
    usersError,
    productsError,
    ordersError,
    lastScanned,
    rustfsHealth,
    pingRustFS,
    pingServices,
    selectedService,
    setSelectedService,
    selectedOrder,
    setSelectedOrder,
    selectedUser,
    setSelectedUser,
    isUserModalOpen,
    setIsUserModalOpen,
    editingUser,
    setEditingUser,
    isProductModalOpen,
    setIsProductModalOpen,
    editingProduct,
    setEditingProduct,
    userSearch,
    setUserSearch,
    userRoleFilter,
    setUserRoleFilter,
    productSearch,
    setProductSearch,
    productCategoryFilter,
    setProductCategoryFilter,
    orderSearch,
    setOrderSearch,
    orderStatusFilter,
    setOrderStatusFilter,
    filteredUsers,
    filteredProducts,
    filteredOrders,
    handleSaveUser,
    handleDeleteUser,
    handleToggleUserStatus,
    handleSaveProduct,
    handleDeleteProduct,
    handleUpdateOrderStatus,
  }
}
