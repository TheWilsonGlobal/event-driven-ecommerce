import { useState } from 'react'
import type { ServiceItem } from '../types'
import { useServiceProbes } from './useServiceProbes'
import { useUsers } from './ecommerce/useUsers'
import { useProducts } from './ecommerce/useProducts'
import { useOrders } from './ecommerce/useOrders'

export function useEcommerceData(autoPolling: boolean, showToast: (msg: string) => void) {
  const { services, lastScanned, rustfsHealth, pingRustFS, pingServices } =
    useServiceProbes(autoPolling)

  const usersHook = useUsers(showToast)
  const productsHook = useProducts(showToast)
  const ordersHook = useOrders(showToast)

  // Infra-level selection, not owned by any single domain sub-hook.
  const [selectedService, setSelectedService] = useState<ServiceItem | null>(null)

  return {
    services,
    users: usersHook.users,
    products: productsHook.products,
    orders: ordersHook.orders,
    objectCount: productsHook.objectCount,
    usersLoading: usersHook.usersLoading,
    productsLoading: productsHook.productsLoading,
    ordersLoading: ordersHook.ordersLoading,
    usersError: usersHook.usersError,
    productsError: productsHook.productsError,
    ordersError: ordersHook.ordersError,
    lastScanned,
    rustfsHealth,
    pingRustFS,
    pingServices,
    selectedService,
    setSelectedService,
    selectedOrder: ordersHook.selectedOrder,
    setSelectedOrder: ordersHook.setSelectedOrder,
    selectedUser: usersHook.selectedUser,
    setSelectedUser: usersHook.setSelectedUser,
    isUserModalOpen: usersHook.isUserModalOpen,
    setIsUserModalOpen: usersHook.setIsUserModalOpen,
    editingUser: usersHook.editingUser,
    setEditingUser: usersHook.setEditingUser,
    isProductModalOpen: productsHook.isProductModalOpen,
    setIsProductModalOpen: productsHook.setIsProductModalOpen,
    editingProduct: productsHook.editingProduct,
    setEditingProduct: productsHook.setEditingProduct,
    userSearch: usersHook.userSearch,
    setUserSearch: usersHook.setUserSearch,
    userRoleFilter: usersHook.userRoleFilter,
    setUserRoleFilter: usersHook.setUserRoleFilter,
    productSearch: productsHook.productSearch,
    setProductSearch: productsHook.setProductSearch,
    productCategoryFilter: productsHook.productCategoryFilter,
    setProductCategoryFilter: productsHook.setProductCategoryFilter,
    orderSearch: ordersHook.orderSearch,
    setOrderSearch: ordersHook.setOrderSearch,
    orderStatusFilter: ordersHook.orderStatusFilter,
    setOrderStatusFilter: ordersHook.setOrderStatusFilter,
    filteredUsers: usersHook.filteredUsers,
    filteredProducts: productsHook.filteredProducts,
    filteredOrders: ordersHook.filteredOrders,
    handleSaveUser: usersHook.handleSaveUser,
    handleDeleteUser: usersHook.handleDeleteUser,
    handleToggleUserStatus: usersHook.handleToggleUserStatus,
    handleSaveProduct: productsHook.handleSaveProduct,
    handleDeleteProduct: productsHook.handleDeleteProduct,
    handleUpdateOrderStatus: ordersHook.handleUpdateOrderStatus,
  }
}
