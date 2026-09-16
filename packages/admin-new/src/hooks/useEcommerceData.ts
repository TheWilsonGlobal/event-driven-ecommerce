import { useState, useMemo } from 'react'
import type { ServiceItem, UserRecord, ProductRecord, OrderRecord } from '../types'
import { INITIAL_USERS, INITIAL_PRODUCTS, INITIAL_ORDERS } from '../data/seed'
import { useServiceProbes } from './useServiceProbes'

export function useEcommerceData(autoPolling: boolean, showToast: (msg: string) => void) {
  const { services, lastScanned, rustfsHealth, pingRustFS, pingServices } =
    useServiceProbes(autoPolling)

  const [users, setUsers] = useState<UserRecord[]>(INITIAL_USERS)
  const [products, setProducts] = useState<ProductRecord[]>(INITIAL_PRODUCTS)
  const [orders, setOrders] = useState<OrderRecord[]>(INITIAL_ORDERS)

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

  // User Handlers
  const handleSaveUser = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const formData = new FormData(e.currentTarget)
    const firstName = formData.get('firstName') as string
    const lastName = formData.get('lastName') as string
    const email = formData.get('email') as string
    const role = formData.get('role') as 'ADMIN' | 'CUSTOMER' | 'VENDOR'
    const isActive = formData.get('isActive') === 'on'

    if (editingUser) {
      setUsers((prev) =>
        prev.map((u) =>
          u.id === editingUser.id ? { ...u, firstName, lastName, email, role, isActive } : u
        )
      )
      showToast(`User ${firstName} updated!`)
    } else {
      const newUser: UserRecord = {
        id: `user-${Date.now()}`,
        firstName,
        lastName,
        email,
        role,
        isActive,
        isEmailVerified: true,
        addresses: [
          {
            addressLine1: (formData.get('addressLine1') as string) || '100 Silicon Way',
            city: (formData.get('city') as string) || 'San Francisco',
            state: (formData.get('state') as string) || 'CA',
            postalCode: (formData.get('postalCode') as string) || '94105',
            country: 'United States',
            isDefaultShipping: true,
          },
        ],
        createdAt: new Date().toISOString(),
      }
      setUsers((prev) => [newUser, ...prev])
      showToast(`User ${firstName} created!`)
    }
    setIsUserModalOpen(false)
    setEditingUser(null)
  }

  const handleDeleteUser = (id: string) => {
    if (!confirm('Are you sure you want to delete this user?')) return
    setUsers((prev) => prev.filter((u) => u.id !== id))
    showToast('User deleted')
  }

  const handleToggleUserStatus = (user: UserRecord) => {
    setUsers((prev) => prev.map((u) => (u.id === user.id ? { ...u, isActive: !u.isActive } : u)))
    showToast(`User ${user.firstName} status toggled`)
  }

  // Product Handlers
  const handleSaveProduct = (e: React.FormEvent<HTMLFormElement>) => {
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

    if (editingProduct) {
      setProducts((prev) =>
        prev.map((p) =>
          p.id === editingProduct.id
            ? {
                ...p,
                title,
                sku,
                price,
                compareAtPrice,
                stock,
                description,
                category: {
                  id: categoryName.toLowerCase().replace(/\s+/g, '-'),
                  name: categoryName,
                  slug: categoryName.toLowerCase().replace(/\s+/g, '-'),
                },
              }
            : p
        )
      )
      showToast(`Product "${title}" updated!`)
    } else {
      const newProd: ProductRecord = {
        id: `prod-${Date.now()}`,
        title,
        slug: title.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
        sku,
        price,
        compareAtPrice,
        currency: 'USD',
        stock,
        isAvailable: true,
        description,
        category: {
          id: categoryName.toLowerCase().replace(/\s+/g, '-'),
          name: categoryName,
          slug: categoryName.toLowerCase().replace(/\s+/g, '-'),
        },
        tags: ['featured', 'catalog'],
        images: [{ url: imageUrl, alt: title, isPrimary: true }],
        attributes: [{ name: 'Warranty', value: '2 Years' }],
        ratings: { average: 5.0, count: 1 },
      }
      setProducts((prev) => [newProd, ...prev])
      showToast(`Product "${title}" added!`)
    }
    setIsProductModalOpen(false)
    setEditingProduct(null)
  }

  const handleDeleteProduct = (id: string) => {
    if (!confirm('Are you sure you want to delete this product?')) return
    setProducts((prev) => prev.filter((p) => p.id !== id))
    showToast('Product deleted')
  }

  // Order Handlers
  const handleUpdateOrderStatus = (orderId: string, newStatus: OrderRecord['status']) => {
    setOrders((prev) => prev.map((o) => (o.id === orderId ? { ...o, status: newStatus } : o)))
    showToast(`Order status updated to ${newStatus}`)
    if (selectedOrder?.id === orderId) {
      setSelectedOrder((prev) => (prev ? { ...prev, status: newStatus } : null))
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
