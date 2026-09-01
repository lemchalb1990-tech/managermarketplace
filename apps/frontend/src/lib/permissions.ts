// Permisos "por página" en el frontend. Deben coincidir con
// apps/backend/src/common/permissions.ts (mismos keys).

export const PERMISSION_GROUPS: { key: string; label: string; items: { key: string; label: string }[] }[] = [
  { key: 'inicio', label: 'Inicio', items: [{ key: 'dashboard', label: 'Panel de inicio' }] },
  {
    key: 'ventas', label: 'Ventas', items: [
      { key: 'orders', label: 'Órdenes' },
      { key: 'shipping', label: 'Órdenes y envíos (despacho)' },
      { key: 'returns', label: 'Devoluciones' },
      { key: 'sales', label: 'Ventas' },
      { key: 'pos', label: 'Punto de venta' },
      { key: 'clientes', label: 'Clientes' },
    ],
  },
  {
    key: 'canales', label: 'Canales', items: [
      { key: 'ecommerce', label: 'E-commerce / Marketplaces' },
      { key: 'billing', label: 'Facturación electrónica' },
    ],
  },
  {
    key: 'catalogo', label: 'Catálogo y bodega', items: [
      { key: 'catalog', label: 'Catálogo' },
      { key: 'warehouses', label: 'Bodegas' },
      { key: 'purchases', label: 'Compras' },
      { key: 'suppliers', label: 'Proveedores' },
      { key: 'rentabilidad', label: 'Rentabilidad' },
    ],
  },
  {
    key: 'operacion', label: 'Operación de bodega', items: [
      { key: 'warehouse.board', label: 'Tablero de bodega' },
      { key: 'warehouse.picking', label: 'Picking' },
      { key: 'warehouse.packing', label: 'Packing' },
    ],
  },
  {
    key: 'pedidos', label: 'Pedidos internos', items: [
      { key: 'pedidos.crear', label: 'Crear solicitudes' },
      { key: 'pedidos.mis', label: 'Ver mis solicitudes' },
      { key: 'pedidos.aprobar', label: 'Aprobar pedidos' },
    ],
  },
  {
    key: 'despacho', label: 'Despacho', items: [
      { key: 'despachos', label: 'Despachos (rutas)' },
      { key: 'mis-rutas', label: 'Mis rutas (repartidor)' },
    ],
  },
  {
    key: 'colaboradores', label: 'Colaboradores', items: [
      { key: 'users', label: 'Usuarios' },
      { key: 'access-profiles', label: 'Perfiles de acceso' },
    ],
  },
  {
    key: 'admin', label: 'Administración', items: [
      { key: 'companies', label: 'Empresas' },
      { key: 'connections', label: 'Conexiones globales' },
      { key: 'emails', label: 'Correos' },
      { key: 'settings', label: 'Configuración' },
    ],
  },
];

export const ALL_PERMISSION_KEYS = PERMISSION_GROUPS.flatMap((g) => g.items.map((i) => i.key));

/**
 * ¿El usuario puede ver/usar `key`?
 * - SUPER_ADMIN siempre puede.
 * - Si el token trae `permissions` (sesión nueva), se usa esa lista.
 * - Si no (sesión antigua), se cae al gate por `roles` que provea el caller.
 */
export function can(user: any, key: string, fallbackRoles?: string[]): boolean {
  if (!user) return false;
  if (user.role === 'SUPER_ADMIN') return true;
  if (Array.isArray(user.permissions)) {
    return user.permissions.includes('*') || user.permissions.includes(key);
  }
  if (fallbackRoles) return fallbackRoles.includes(user.role);
  return false;
}
