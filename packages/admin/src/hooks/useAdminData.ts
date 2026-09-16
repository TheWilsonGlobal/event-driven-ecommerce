import { useState, useMemo } from 'react'
import type { UserRecord, ProductRecord, OrderRecord, ServiceItem } from '../types'
import { INITIAL_USERS, INITIAL_PRODUCTS, INITIAL_ORDERS } from '../data/seed'

export function useAdminData(showToast: (msg: string) => void) {
  const [users, setUsers] = useState<UserRecord[]>(INITIAL_USERS)
  const [products, setProducts] = useState<ProductRecord[]>(INITIAL_PRODUCTS)
  const [orders, setOrders] = useState<OrderRecord[]>(INITIAL_ORDERS)

  // Selection / Modal States
  const [selectedService, setSelectedService] = useState<ServiceItem | null>(null)
  const [selectedOrder, setSelectedOrder] = useState<OrderRecord | null>(null)
  const [selectedUser, setSelectedUser] = useState<UserRecord | null>(null)

  // Form Modals
  const [isUserModalOpen, setIsUserModalOpen] = useState<boolean>(false)
  const [editingUser, setEditingUser] = useState<UserRecord | null>(null)
  const [isProductModalOpen, setIsProductModalOpen] = useState<boolean>(false)
  const [editingProduct, setEditingProduct] = useState<ProductRecord | null>(null)

  // Filtering & Search
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
      showToast(`User ${firstName} updated successfully!`)
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
      showToast(`User ${firstName} created successfully!`)
    }
    setIsUserModalOpen(false)
    setEditingUser(null)
  }

  const handleDeleteUser = (userId: string) => {
    if (confirm('Are you sure you want to delete this user?')) {
      setUsers((prev) => prev.filter((u) => u.id !== userId))
      showToast('User deleted successfully')
    }
  }

  const handleToggleUserStatus = (user: UserRecord) => {
    setUsers((prev) => prev.map((u) => (u.id === user.id ? { ...u, isActive: !u.isActive } : u)))
    showToast(`User ${user.firstName} status updated`)
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
      showToast(`Product "${title}" updated successfully!`)
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
      showToast(`Product "${title}" created successfully!`)
    }
    setIsProductModalOpen(false)
    setEditingProduct(null)
  }

  const handleDeleteProduct = (productId: string) => {
    if (confirm('Are you sure you want to delete this product?')) {
      setProducts((prev) => prev.filter((p) => p.id !== productId))
      showToast('Product removed from catalog')
    }
  }

  // Order Handlers
  const handleUpdateOrderStatus = (orderId: string, newStatus: OrderRecord['status'] | string) => {
    setOrders((prev) =>
      prev.map((o) => (o.id === orderId ? { ...o, status: newStatus as OrderRecord['status'] } : o))
    )
    showToast(`Order status updated to ${newStatus}`)
    if (selectedOrder?.id === orderId) {
      setSelectedOrder((prev) =>
        prev ? { ...prev, status: newStatus as OrderRecord['status'] } : null
      )
    }
  }

  // Filter Computations
  const filteredUsers = useMemo(() => {
    return users.filter((u) => {
      const matchesSearch =
        u.firstName.toLowerCase().includes(userSearch.toLowerCase()) ||
        u.lastName.toLowerCase().includes(userSearch.toLowerCase()) ||
        u.email.toLowerCase().includes(userSearch.toLowerCase())
      const matchesRole = userRoleFilter === 'ALL' || u.role === userRoleFilter
      return matchesSearch && matchesRole
    })
  }, [users, userSearch, userRoleFilter])

  const filteredProducts = useMemo(() => {
    return products.filter((p) => {
      const matchesSearch =
        p.title.toLowerCase().includes(productSearch.toLowerCase()) ||
        p.sku.toLowerCase().includes(productSearch.toLowerCase()) ||
        p.description.toLowerCase().includes(productSearch.toLowerCase())
      const matchesCategory =
        productCategoryFilter === 'ALL' || p.category.name === productCategoryFilter
      return matchesSearch && matchesCategory
    })
  }, [products, productSearch, productCategoryFilter])

  const filteredOrders = useMemo(() => {
    return orders.filter((o) => {
      const matchesSearch =
        o.orderNumber.toLowerCase().includes(orderSearch.toLowerCase()) ||
        o.customerName.toLowerCase().includes(orderSearch.toLowerCase()) ||
        o.customerEmail.toLowerCase().includes(orderSearch.toLowerCase())
      const matchesStatus = orderStatusFilter === 'ALL' || o.status === orderStatusFilter
      return matchesSearch && matchesStatus
    })
  }, [orders, orderSearch, orderStatusFilter])

  return {
    users,
    products,
    orders,
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
    handleSaveUser,
    handleDeleteUser,
    handleToggleUserStatus,
    handleSaveProduct,
    handleDeleteProduct,
    handleUpdateOrderStatus,
    filteredUsers,
    filteredProducts,
    filteredOrders,
  }
}
