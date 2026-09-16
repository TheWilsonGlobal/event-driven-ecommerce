import { useState, useMemo } from 'react';
import type { ServiceItem, UserRecord, ProductRecord, OrderRecord } from './types';
import { INITIAL_SERVICES, INITIAL_USERS, INITIAL_PRODUCTS, INITIAL_ORDERS } from './data/seed';
import { useHealthMonitoring } from './hooks/useHealthMonitoring';

// Components & Tabs
import AdminHeader from './components/AdminHeader';
import ServicesTab from './tabs/ServicesTab';
import UsersTab from './tabs/UsersTab';
import ProductsTab from './tabs/ProductsTab';
import OrdersTab from './tabs/OrdersTab';
import PersistenceTab from './tabs/PersistenceTab';
import ConfigTab from './tabs/ConfigTab';

// Modals
import ServiceModal from './modals/ServiceModal';
import OrderModal from './modals/OrderModal';
import UserViewModal from './modals/UserViewModal';
import UserFormModal from './modals/UserFormModal';
import ProductFormModal from './modals/ProductFormModal';

export default function App() {
  const [activeTab, setActiveTab] = useState<'services' | 'users' | 'products' | 'orders' | 'persistence' | 'config'>('services');
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Core Data States
  const [services, setServices] = useState<ServiceItem[]>(INITIAL_SERVICES);
  const [users, setUsers] = useState<UserRecord[]>(INITIAL_USERS);
  const [products, setProducts] = useState<ProductRecord[]>(INITIAL_PRODUCTS);
  const [orders, setOrders] = useState<OrderRecord[]>(INITIAL_ORDERS);

  // Health & RustFS Monitoring Hook
  const { lastUpdated, autoRefresh, setAutoRefresh, rustfsHealth, pingRustFS, pingServices } =
    useHealthMonitoring(services, setServices);

  // Selection / Modal States
  const [selectedService, setSelectedService] = useState<ServiceItem | null>(null);
  const [selectedOrder, setSelectedOrder] = useState<OrderRecord | null>(null);
  const [selectedUser, setSelectedUser] = useState<UserRecord | null>(null);

  // Form Modals
  const [isUserModalOpen, setIsUserModalOpen] = useState<boolean>(false);
  const [editingUser, setEditingUser] = useState<UserRecord | null>(null);
  const [isProductModalOpen, setIsProductModalOpen] = useState<boolean>(false);
  const [editingProduct, setEditingProduct] = useState<ProductRecord | null>(null);

  // Filtering & Search
  const [userSearch, setUserSearch] = useState<string>('');
  const [userRoleFilter, setUserRoleFilter] = useState<string>('ALL');
  const [productSearch, setProductSearch] = useState<string>('');
  const [productCategoryFilter, setProductCategoryFilter] = useState<string>('ALL');
  const [orderSearch, setOrderSearch] = useState<string>('');
  const [orderStatusFilter, setOrderStatusFilter] = useState<string>('ALL');

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  // User Handlers
  const handleSaveUser = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const firstName = formData.get('firstName') as string;
    const lastName = formData.get('lastName') as string;
    const email = formData.get('email') as string;
    const role = formData.get('role') as any;
    const isActive = formData.get('isActive') === 'on';

    if (editingUser) {
      setUsers((prev) =>
        prev.map((u) =>
          u.id === editingUser.id
            ? { ...u, firstName, lastName, email, role, isActive }
            : u
        )
      );
      showToast(`User ${firstName} updated successfully!`);
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
      };
      setUsers((prev) => [newUser, ...prev]);
      showToast(`User ${firstName} created successfully!`);
    }
    setIsUserModalOpen(false);
    setEditingUser(null);
  };

  const handleDeleteUser = (id: string) => {
    if (!confirm('Are you sure you want to delete this user?')) return;
    setUsers((prev) => prev.filter((u) => u.id !== id));
    showToast('User deleted from database');
  };

  const handleToggleUserStatus = (user: UserRecord) => {
    setUsers((prev) =>
      prev.map((u) => (u.id === user.id ? { ...u, isActive: !u.isActive } : u))
    );
    showToast(`User ${user.firstName} ${!user.isActive ? 'activated' : 'deactivated'}`);
  };

  // Product Handlers
  const handleSaveProduct = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const title = formData.get('title') as string;
    const sku = formData.get('sku') as string;
    const price = parseFloat(formData.get('price') as string) || 99.99;
    const compareAtPrice = parseFloat(formData.get('compareAtPrice') as string) || price * 1.2;
    const stock = parseInt(formData.get('stock') as string, 10) || 50;
    const description = formData.get('description') as string;
    const categoryName = formData.get('category') as string;
    const imageUrl = (formData.get('imageUrl') as string) || 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=800&q=80';

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
      );
      showToast(`Product "${title}" updated!`);
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
      };
      setProducts((prev) => [newProd, ...prev]);
      showToast(`Product "${title}" added to catalog!`);
    }
    setIsProductModalOpen(false);
    setEditingProduct(null);
  };

  const handleDeleteProduct = (id: string) => {
    if (!confirm('Are you sure you want to delete this product?')) return;
    setProducts((prev) => prev.filter((p) => p.id !== id));
    showToast('Product deleted');
  };

  // Order Handlers
  const handleUpdateOrderStatus = (orderId: string, newStatus: any) => {
    setOrders((prev) =>
      prev.map((o) => (o.id === orderId ? { ...o, status: newStatus } : o))
    );
    showToast(`Order status transitioned to ${newStatus}`);
    if (selectedOrder?.id === orderId) {
      setSelectedOrder((prev) => (prev ? { ...prev, status: newStatus } : null));
    }
  };

  // Filtered lists
  const filteredUsers = useMemo(() => {
    return users.filter((u) => {
      const matchesSearch =
        u.firstName.toLowerCase().includes(userSearch.toLowerCase()) ||
        u.lastName.toLowerCase().includes(userSearch.toLowerCase()) ||
        u.email.toLowerCase().includes(userSearch.toLowerCase());
      const matchesRole = userRoleFilter === 'ALL' || u.role === userRoleFilter;
      return matchesSearch && matchesRole;
    });
  }, [users, userSearch, userRoleFilter]);

  const filteredProducts = useMemo(() => {
    return products.filter((p) => {
      const matchesSearch =
        p.title.toLowerCase().includes(productSearch.toLowerCase()) ||
        p.sku.toLowerCase().includes(productSearch.toLowerCase()) ||
        p.description.toLowerCase().includes(productSearch.toLowerCase());
      const matchesCategory = productCategoryFilter === 'ALL' || p.category.name === productCategoryFilter;
      return matchesSearch && matchesCategory;
    });
  }, [products, productSearch, productCategoryFilter]);

  const filteredOrders = useMemo(() => {
    return orders.filter((o) => {
      const matchesSearch =
        o.orderNumber.toLowerCase().includes(orderSearch.toLowerCase()) ||
        o.customerName.toLowerCase().includes(orderSearch.toLowerCase()) ||
        o.customerEmail.toLowerCase().includes(orderSearch.toLowerCase());
      const matchesStatus = orderStatusFilter === 'ALL' || o.status === orderStatusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [orders, orderSearch, orderStatusFilter]);

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 font-sans pb-16">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 bg-indigo-600 text-white px-5 py-3 rounded-xl shadow-2xl flex items-center gap-3 border border-indigo-400 animate-bounce">
          <span>✓</span>
          <span className="text-sm font-semibold">{toastMessage}</span>
        </div>
      )}

      {/* Header with Navigation Tabs */}
      <AdminHeader
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        services={services}
        usersCount={users.length}
        productsCount={products.length}
        ordersCount={orders.length}
        autoRefresh={autoRefresh}
        setAutoRefresh={setAutoRefresh}
        onRefresh={pingServices}
      />

      {/* Main Content Area */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-6">
        {activeTab === 'services' && (
          <ServicesTab
            services={services}
            lastUpdated={lastUpdated}
            onSelectService={setSelectedService}
          />
        )}

        {activeTab === 'users' && (
          <UsersTab
            filteredUsers={filteredUsers}
            userSearch={userSearch}
            onUserSearch={setUserSearch}
            userRoleFilter={userRoleFilter}
            onRoleFilter={setUserRoleFilter}
            onSelectUser={setSelectedUser}
            onEditUser={(u) => {
              setEditingUser(u);
              setIsUserModalOpen(true);
            }}
            onDeleteUser={handleDeleteUser}
            onAddUser={() => {
              setEditingUser(null);
              setIsUserModalOpen(true);
            }}
            onToggleStatus={handleToggleUserStatus}
          />
        )}

        {activeTab === 'products' && (
          <ProductsTab
            filteredProducts={filteredProducts}
            productSearch={productSearch}
            onProductSearch={setProductSearch}
            productCategoryFilter={productCategoryFilter}
            onCategoryFilter={setProductCategoryFilter}
            onEditProduct={(p) => {
              setEditingProduct(p);
              setIsProductModalOpen(true);
            }}
            onDeleteProduct={handleDeleteProduct}
            onAddProduct={() => {
              setEditingProduct(null);
              setIsProductModalOpen(true);
            }}
          />
        )}

        {activeTab === 'orders' && (
          <OrdersTab
            filteredOrders={filteredOrders}
            orders={orders}
            orderSearch={orderSearch}
            onOrderSearch={setOrderSearch}
            orderStatusFilter={orderStatusFilter}
            onStatusFilter={setOrderStatusFilter}
            onSelectOrder={setSelectedOrder}
            onUpdateStatus={handleUpdateOrderStatus}
          />
        )}

        {activeTab === 'persistence' && (
          <PersistenceTab
            rustfsHealth={rustfsHealth}
            onPingRustFS={pingRustFS}
          />
        )}

        {activeTab === 'config' && <ConfigTab />}
      </main>

      {/* Modals */}
      <ServiceModal
        service={selectedService}
        onClose={() => setSelectedService(null)}
      />

      <OrderModal
        order={selectedOrder}
        onClose={() => setSelectedOrder(null)}
      />

      <UserViewModal
        user={selectedUser}
        onClose={() => setSelectedUser(null)}
      />

      <UserFormModal
        isOpen={isUserModalOpen}
        editingUser={editingUser}
        onClose={() => setIsUserModalOpen(false)}
        onSave={handleSaveUser}
      />

      <ProductFormModal
        isOpen={isProductModalOpen}
        editingProduct={editingProduct}
        onClose={() => setIsProductModalOpen(false)}
        onSave={handleSaveProduct}
      />
    </div>
  );
}
