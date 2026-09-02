import { Role } from '@prisma/client';

/**
 * Catálogo de permisos "por página". Cada key habilita una vista/función del
 * panel. El comodín '*' concede todo (reservado para SUPER_ADMIN y el perfil
 * de sistema "Acceso total").
 *
 * Los grupos se usan tanto para validar keys entrantes como para dibujar el
 * árbol de checkboxes en el editor de perfiles del frontend.
 */
export const PERMISSION_GROUPS: { key: string; label: string; items: { key: string; label: string }[] }[] = [
  {
    key: 'inicio',
    label: 'Inicio',
    items: [{ key: 'dashboard', label: 'Panel de inicio' }],
  },
  {
    key: 'ventas',
    label: 'Ventas',
    items: [
      { key: 'orders', label: 'Órdenes' },
      { key: 'shipping', label: 'Órdenes y envíos (despacho)' },
      { key: 'returns', label: 'Devoluciones' },
      { key: 'sales', label: 'Ventas' },
      { key: 'pos', label: 'Punto de venta' },
      { key: 'clientes', label: 'Clientes' },
    ],
  },
  {
    key: 'canales',
    label: 'Canales',
    items: [
      { key: 'ecommerce', label: 'E-commerce / Marketplaces' },
      { key: 'billing', label: 'Facturación electrónica' },
    ],
  },
  {
    key: 'catalogo',
    label: 'Catálogo y bodega',
    items: [
      { key: 'catalog', label: 'Catálogo' },
      { key: 'warehouses', label: 'Bodegas' },
      { key: 'purchases', label: 'Compras' },
      { key: 'suppliers', label: 'Proveedores' },
      { key: 'rentabilidad', label: 'Rentabilidad' },
    ],
  },
  {
    key: 'operacion',
    label: 'Operación de bodega',
    items: [
      { key: 'warehouse.board', label: 'Tablero de bodega' },
      { key: 'warehouse.picking', label: 'Picking' },
      { key: 'warehouse.packing', label: 'Packing' },
    ],
  },
  {
    key: 'pedidos',
    label: 'Pedidos internos',
    items: [
      { key: 'pedidos.crear', label: 'Crear solicitudes' },
      { key: 'pedidos.mis', label: 'Ver mis solicitudes' },
      { key: 'pedidos.aprobar', label: 'Aprobar pedidos' },
    ],
  },
  {
    key: 'despacho',
    label: 'Despacho',
    items: [
      { key: 'despachos', label: 'Despachos (rutas)' },
      { key: 'mis-rutas', label: 'Mis rutas (repartidor)' },
    ],
  },
  {
    key: 'repartidores',
    label: 'Repartidores',
    items: [
      { key: 'drivers.fleet', label: 'Flota' },
      { key: 'drivers.metrics', label: 'Métricas' },
      { key: 'drivers.payments', label: 'Remuneración de repartos' },
      { key: 'drivers.zones', label: 'Zonas de demanda' },
    ],
  },
  {
    key: 'colaboradores',
    label: 'Colaboradores',
    items: [
      { key: 'users', label: 'Usuarios' },
      { key: 'access-profiles', label: 'Perfiles de acceso' },
    ],
  },
  {
    key: 'admin',
    label: 'Administración',
    items: [
      { key: 'companies', label: 'Empresas' },
      { key: 'connections', label: 'Conexiones globales' },
      { key: 'emails', label: 'Correos' },
      { key: 'settings', label: 'Configuración' },
    ],
  },
];

export const ALL_PERMISSION_KEYS: string[] = PERMISSION_GROUPS.flatMap((g) => g.items.map((i) => i.key));

export function isValidPermissionKey(k: string): boolean {
  return k === '*' || ALL_PERMISSION_KEYS.includes(k);
}

/** Permisos por defecto derivados del rol (compatibilidad hacia atrás). */
export const ROLE_DEFAULT_PERMISSIONS: Record<Role, string[]> = {
  [Role.SUPER_ADMIN]: ['*'],
  [Role.COMPANY_ADMIN]: [
    'dashboard', 'orders', 'shipping', 'returns', 'sales', 'pos', 'clientes',
    'ecommerce', 'billing',
    'catalog', 'warehouses', 'purchases', 'suppliers', 'rentabilidad',
    'warehouse.board', 'warehouse.picking', 'warehouse.packing',
    'pedidos.crear', 'pedidos.mis', 'pedidos.aprobar',
    'despachos', 'drivers.fleet', 'drivers.metrics', 'drivers.payments', 'drivers.zones',
    'users', 'access-profiles',
    'emails',
  ],
  [Role.CATALOG_MANAGER]: [
    'dashboard', 'orders', 'shipping', 'returns', 'sales', 'pos', 'clientes',
    'ecommerce', 'billing',
    'catalog', 'warehouses', 'purchases', 'suppliers', 'rentabilidad',
    'warehouse.board', 'warehouse.picking', 'warehouse.packing',
    'pedidos.crear', 'pedidos.mis',
    'despachos', 'drivers.fleet', 'drivers.metrics', 'drivers.zones',
  ],
  [Role.VENDEDOR]: [
    'orders', 'shipping', 'returns', 'sales', 'pos', 'clientes',
    'warehouse.picking', 'warehouse.packing',
    'pedidos.crear', 'pedidos.mis',
  ],
  [Role.DESPACHADOR]: ['mis-rutas', 'warehouse.picking', 'warehouse.packing'],
  [Role.ORDER_MANAGER]: ['clientes', 'pedidos.crear', 'pedidos.mis', 'pedidos.aprobar'],
};

/**
 * Permisos efectivos de un usuario (ya cargado con accessProfile).
 * SUPER_ADMIN siempre '*'. Si hay perfil, manda el perfil. Si no, el rol.
 */
export function permissionsForUser(user: {
  role: Role;
  accessProfile?: { permissions: string[] } | null;
}): string[] {
  if (user.role === Role.SUPER_ADMIN) return ['*'];
  if (user.accessProfile) return user.accessProfile.permissions ?? [];
  return ROLE_DEFAULT_PERMISSIONS[user.role] ?? [];
}

export function hasPermission(perms: string[], key: string): boolean {
  return perms.includes('*') || perms.includes(key);
}
