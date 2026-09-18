// Service origins, hardcoded the same way the rest of this admin app does it
// (see StorageTab.tsx, modals/ProductModal.tsx, config/PersistencePanel.tsx,
// hooks/useEcommerceData.ts). Centralised here only for the origins that more
// than one screen needs, so there is a single place to change a port.
//
// Note: the API gateway does NOT proxy the queue/cache introspection routes,
// so those calls go straight to ms-order on 5465.

export const ORDER_SERVICE_URL = 'http://localhost:5465'
