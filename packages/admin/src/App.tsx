import { useState } from 'react'
import type { ServiceItem } from './types'
import { INITIAL_SERVICES } from './data/seed'
import { useHealthMonitoring } from './hooks/useHealthMonitoring'
import { useAdminData } from './hooks/useAdminData'

// Components & Tabs
import AdminHeader from './components/AdminHeader'
import ServicesTab from './tabs/ServicesTab'
import UsersTab from './tabs/UsersTab'
import ProductsTab from './tabs/ProductsTab'
import OrdersTab from './tabs/OrdersTab'
import PersistenceTab from './tabs/PersistenceTab'
import ConfigTab from './tabs/ConfigTab'

// Modals
import ServiceModal from './modals/ServiceModal'
import OrderModal from './modals/OrderModal'
import UserViewModal from './modals/UserViewModal'
import UserFormModal from './modals/UserFormModal'
import ProductFormModal from './modals/ProductFormModal'

export default function App() {
  const [activeTab, setActiveTab] = useState<
    'services' | 'users' | 'products' | 'orders' | 'persistence' | 'config'
  >('services')
  const [toastMessage, setToastMessage] = useState<string | null>(null)
  const [services, setServices] = useState<ServiceItem[]>(INITIAL_SERVICES)

  const showToast = (msg: string) => {
    setToastMessage(msg)
    setTimeout(() => setToastMessage(null), 3000)
  }

  // Health Monitoring
  const { lastUpdated, autoRefresh, setAutoRefresh, rustfsHealth, pingRustFS, pingServices } =
    useHealthMonitoring(services, setServices)

  // Admin Data & Handlers
  const data = useAdminData(showToast)

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 flex flex-col font-sans">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-5 right-5 z-50 bg-indigo-600 text-white px-4 py-3 rounded-lg shadow-xl flex items-center space-x-2 border border-indigo-400">
          <span className="text-lg">✓</span>
          <span className="font-medium text-sm">{toastMessage}</span>
        </div>
      )}

      {/* Header & Tabs */}
      <AdminHeader
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        services={services}
        usersCount={data.users.length}
        productsCount={data.products.length}
        ordersCount={data.orders.length}
        autoRefresh={autoRefresh}
        setAutoRefresh={setAutoRefresh}
        onRefresh={pingServices}
      />

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {activeTab === 'services' && (
          <ServicesTab
            services={services}
            lastUpdated={lastUpdated}
            onSelectService={data.setSelectedService}
          />
        )}

        {activeTab === 'users' && (
          <UsersTab
            filteredUsers={data.filteredUsers}
            userSearch={data.userSearch}
            onUserSearch={data.setUserSearch}
            userRoleFilter={data.userRoleFilter}
            onRoleFilter={data.setUserRoleFilter}
            onSelectUser={data.setSelectedUser}
            onEditUser={(u) => {
              data.setEditingUser(u)
              data.setIsUserModalOpen(true)
            }}
            onDeleteUser={data.handleDeleteUser}
            onAddUser={() => {
              data.setEditingUser(null)
              data.setIsUserModalOpen(true)
            }}
            onToggleStatus={data.handleToggleUserStatus}
          />
        )}

        {activeTab === 'products' && (
          <ProductsTab
            filteredProducts={data.filteredProducts}
            productSearch={data.productSearch}
            onProductSearch={data.setProductSearch}
            productCategoryFilter={data.productCategoryFilter}
            onCategoryFilter={data.setProductCategoryFilter}
            onEditProduct={(p) => {
              data.setEditingProduct(p)
              data.setIsProductModalOpen(true)
            }}
            onDeleteProduct={data.handleDeleteProduct}
            onAddProduct={() => {
              data.setEditingProduct(null)
              data.setIsProductModalOpen(true)
            }}
          />
        )}

        {activeTab === 'orders' && (
          <OrdersTab
            filteredOrders={data.filteredOrders}
            orders={data.orders}
            orderSearch={data.orderSearch}
            onOrderSearch={data.setOrderSearch}
            orderStatusFilter={data.orderStatusFilter}
            onStatusFilter={data.setOrderStatusFilter}
            onSelectOrder={data.setSelectedOrder}
            onUpdateStatus={data.handleUpdateOrderStatus}
          />
        )}

        {activeTab === 'persistence' && (
          <PersistenceTab rustfsHealth={rustfsHealth} onPingRustFS={pingRustFS} />
        )}

        {activeTab === 'config' && <ConfigTab />}
      </main>

      {/* Modals */}
      <ServiceModal service={data.selectedService} onClose={() => data.setSelectedService(null)} />

      <OrderModal order={data.selectedOrder} onClose={() => data.setSelectedOrder(null)} />

      <UserViewModal user={data.selectedUser} onClose={() => data.setSelectedUser(null)} />

      <UserFormModal
        isOpen={data.isUserModalOpen}
        editingUser={data.editingUser}
        onClose={() => data.setIsUserModalOpen(false)}
        onSave={data.handleSaveUser}
      />

      <ProductFormModal
        isOpen={data.isProductModalOpen}
        editingProduct={data.editingProduct}
        onClose={() => data.setIsProductModalOpen(false)}
        onSave={data.handleSaveProduct}
      />
    </div>
  )
}
