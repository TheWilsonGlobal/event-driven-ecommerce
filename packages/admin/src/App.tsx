import { useEffect } from 'react'
import { useAdminApp } from './hooks/useAdminApp'
import { useEcommerceData } from './hooks/useEcommerceData'
import type { Tab } from './types'

// Icons
import {
  ChevronIcon,
  DashboardIcon,
  ProductsIcon,
  OrdersIcon,
  UsersIcon,
  QueueIcon,
  StorageIcon,
  PersistenceIcon,
  CacheIcon,
  ConfigIcon,
  ExternalLinkIcon,
} from './components/icons'

// Screens
import Dashboard from './screens/Dashboard'
import ProductsTab from './screens/ProductsTab'
import OrdersTab from './screens/OrdersTab'
import UsersTab from './screens/UsersTab'
import TaskQueuesTab from './screens/TaskQueuesTab'
import StorageTab from './screens/StorageTab'
import PersistenceTab from './screens/PersistenceTab'
import KvKeysTab from './screens/KvKeysTab'
import ConfigTab from './screens/ConfigTab'
import { useCacheKeys, useQueueData } from './hooks/useQueueData'
import { CLIENT_URL } from './data/serviceUrls'

// Modals
import ServiceModal from './modals/ServiceModal'
import ProductModal from './modals/ProductModal'
import OrderModal from './modals/OrderModal'
import UserModal from './modals/UserModal'

type NavEntry = {
  key: Tab
  label: string
  Icon: React.ComponentType<React.SVGProps<SVGSVGElement>>
  count?: number
}

export default function App() {
  const app = useAdminApp()
  const data = useEcommerceData(app.autoPolling, app.showToast)
  // Sidebar job-count badge: live, and omitted entirely (rather than faked)
  // while loading or when Redis/ms-order is unreachable.
  const queueData = useQueueData()
  const cacheKeyData = useCacheKeys()

  // These badges own separate hook instances from the tabs, so refresh them on
  // navigation. Without this they would stay stuck on their mount-time result —
  // notably staying blank after Redis recovers, until a full page reload.
  const refetchQueues = queueData.refetch
  const refetchCacheKeys = cacheKeyData.refetch
  useEffect(() => {
    refetchQueues()
    refetchCacheKeys()
  }, [app.tab, refetchQueues, refetchCacheKeys])

  const OPERATIONS: NavEntry[] = [{ key: 'dashboard', label: 'Dashboard', Icon: DashboardIcon }]

  const CATALOG_SAGAS: NavEntry[] = [
    { key: 'products', label: 'Products', Icon: ProductsIcon, count: data.products.length },
    { key: 'orders', label: 'Orders & Sagas', Icon: OrdersIcon, count: data.orders.length },
  ]

  const ACCESS: NavEntry[] = [
    { key: 'users', label: 'Users & Roles', Icon: UsersIcon, count: data.users.length },
  ]

  const INFRA: NavEntry[] = [
    { key: 'persistence', label: 'Infra', Icon: PersistenceIcon },
    { key: 'kv-keys', label: 'KV Cache', Icon: CacheIcon, count: cacheKeyData.data?.totalKeys },
    { key: 'storage', label: 'S3 Storage', Icon: StorageIcon, count: data.objectCount },
  ]

  const SYSTEM: NavEntry[] = [
    { key: 'config', label: 'Configuration', Icon: ConfigIcon },
    {
      key: 'task-queues',
      label: 'Task Queues',
      Icon: QueueIcon,
      count: queueData.data?.summary.totalJobs,
    },
  ]

  const renderNavItem = ({ key, label, Icon, count }: NavEntry) => (
    <button
      key={key}
      className={`nav-item${app.tab === key ? ' active' : ''}`}
      onClick={() => app.setTab(key)}
      title={label}
    >
      <Icon />
      <span className="nav-label">{label}</span>
      {count !== undefined && <span className="nav-badge">{count}</span>}
    </button>
  )

  return (
    <div className="layout">
      {/* Toast */}
      {app.toastMessage && (
        <div className="toast">
          <span>✓</span>
          <span>{app.toastMessage}</span>
        </div>
      )}

      {/* Sidebar */}
      <aside className={`sidebar${app.collapsed ? ' collapsed' : ''}`}>
        <div className="sidebar-brand">
          <div className="sidebar-brand-text">
            <h1>
              <span>Admin</span> Cockpit
            </h1>
            <div className="subtitle">Microservices v2.0</div>
          </div>
          <button
            className="sidebar-toggle"
            onClick={app.toggleSidebar}
            title={app.collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            <ChevronIcon />
          </button>
        </div>

        <nav className="sidebar-nav">
          <div className="nav-section">Operations</div>
          {OPERATIONS.map(renderNavItem)}

          <div className="nav-section">Catalog & Sagas</div>
          {CATALOG_SAGAS.map(renderNavItem)}

          <div className="nav-section">Access & Roles</div>
          {ACCESS.map(renderNavItem)}

          <div className="nav-section">System</div>
          {SYSTEM.map(renderNavItem)}

          <div className="nav-section">Infra</div>
          {INFRA.map(renderNavItem)}
        </nav>

        <div className="sidebar-footer">
          <div className="refresh-row">
            <div className={`refresh-dot${app.autoPolling ? '' : ' paused'}`} />
            <span>{app.autoPolling ? 'Auto-probe: 5s' : 'Paused'}</span>
          </div>
          <div className="sidebar-actions">
            <button className="btn btn-ghost btn-sidebar" onClick={app.toggleAutoPolling}>
              {app.autoPolling ? 'Pause' : 'Resume'}
            </button>
            <button className="btn btn-primary btn-sidebar" onClick={data.pingServices}>
              Refresh
            </button>
          </div>
          <div style={{ padding: '4px 6px 0' }}>
            <a
              href={CLIENT_URL}
              target="_blank"
              rel="noreferrer"
              className="btn btn-ghost btn-sidebar"
              style={{ width: '100%', textDecoration: 'none', gap: 6 }}
            >
              <ExternalLinkIcon style={{ width: 14, height: 14 }} />
              <span>Storefront (:5462)</span>
            </a>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className={`main-content${app.collapsed ? ' sidebar-collapsed' : ''}`}>
        {app.tab === 'dashboard' && (
          <Dashboard
            services={data.services}
            orders={data.orders}
            productsCount={data.products.length}
            usersCount={data.users.length}
            rustfsHealth={data.rustfsHealth}
            onNavigate={app.setTab}
            onSelectOrder={data.setSelectedOrder}
          />
        )}

        {app.tab === 'products' && (
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

        {app.tab === 'orders' && (
          <OrdersTab
            filteredOrders={data.filteredOrders}
            orderSearch={data.orderSearch}
            onOrderSearch={data.setOrderSearch}
            orderStatusFilter={data.orderStatusFilter}
            onStatusFilter={data.setOrderStatusFilter}
            onSelectOrder={data.setSelectedOrder}
            onUpdateStatus={data.handleUpdateOrderStatus}
          />
        )}

        {app.tab === 'users' && (
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

        {app.tab === 'task-queues' && <TaskQueuesTab />}

        {app.tab === 'kv-keys' && <KvKeysTab />}

        {app.tab === 'storage' && <StorageTab />}

        {app.tab === 'persistence' && (
          <PersistenceTab
            rustfsHealth={data.rustfsHealth}
            onPingRustFS={data.pingRustFS}
            services={data.services}
            onRefreshServices={data.pingServices}
          />
        )}

        {app.tab === 'config' && (
          <ConfigTab
            services={data.services}
            lastScanned={data.lastScanned}
            onSelectService={data.setSelectedService}
            onRefreshServices={data.pingServices}
          />
        )}
      </main>

      {/* Modals */}
      <ServiceModal service={data.selectedService} onClose={() => data.setSelectedService(null)} />

      <ProductModal
        isOpen={data.isProductModalOpen}
        editingProduct={data.editingProduct}
        onClose={() => data.setIsProductModalOpen(false)}
        onSave={data.handleSaveProduct}
      />

      <OrderModal order={data.selectedOrder} onClose={() => data.setSelectedOrder(null)} />

      <UserModal
        isOpen={data.isUserModalOpen}
        editingUser={data.editingUser}
        onClose={() => data.setIsUserModalOpen(false)}
        onSave={data.handleSaveUser}
      />
    </div>
  )
}
