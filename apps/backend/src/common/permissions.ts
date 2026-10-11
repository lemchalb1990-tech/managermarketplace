import { Role } from '@prisma/client';

/**
 * Catálogo de permisos "por página". Cada key habilita una vista/función del
 * panel. El comodín '*' concede todo (reservado para SUPER_ADMIN y el perfil
 * de sistema "Acceso total").
 *
 * Los grupos se usan tanto para validar keys entrantes como para dibujar el
 * árbol de checkboxes en el editor de perfiles del frontend.
 */
export const PERMISSION_GROUPS: {
  key: string;
  label: string;
  items: { key: string; label: string }[];
}[] = [
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
    key: 'mercadolibre',
    label: 'Mercado Libre',
    items: [
      { key: 'ml.preguntas', label: 'Preguntas' },
      { key: 'ml.reclamos', label: 'Reclamos' },
      { key: 'ml.devoluciones', label: 'Devoluciones' },
      { key: 'ml.calificaciones', label: 'Calificaciones' },
      { key: 'ml.promociones', label: 'Promociones' },
      { key: 'ml.conexiones', label: 'Conexiones' },
    ],
  },
  {
    key: 'catalogo',
    label: 'Catálogo y bodega',
    items: [
      { key: 'catalog', label: 'Catálogo' },
      { key: 'warehouses', label: 'Bodegas' },
      { key: 'inventory', label: 'Inventario: disponibilidad e historial' },
      { key: 'inventory.adjust', label: 'Inventario: ajustes y cuadratura' },
      { key: 'transfers', label: 'Traspasos: crear, despachar y anular' },
      { key: 'transfers.receive', label: 'Traspasos: recibir' },
      { key: 'purchases', label: 'Compras' },
      { key: 'suppliers', label: 'Proveedores' },
      { key: 'dropshipping', label: 'Dropshipping' },
      { key: 'rentabilidad', label: 'Rentabilidad' },
    ],
  },
  {
    key: 'finanzas',
    label: 'Finanzas',
    items: [{ key: 'finance', label: 'Finanzas: plan de cuentas, movimientos y presupuesto' }],
  },
  {
    key: 'operacion',
    label: 'Operación',
    items: [
      { key: 'warehouse.board', label: 'Tablero de bodega' },
      { key: 'warehouse.picking', label: 'Picking' },
      { key: 'warehouse.packing', label: 'Packing' },
    ],
  },
  {
    key: 'repartidores',
    label: 'Repartidores',
    items: [
      { key: 'despachos', label: 'Rutas' },
      { key: 'mis-rutas', label: 'Mis rutas (repartidor)' },
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
      { key: 'activity', label: 'Historial de actividad' },
    ],
  },
  {
    // Restricciones (en negativo para no cambiar perfiles existentes: sin marcar = sin
    // restricción). Ver DeleteRestrictionInterceptor.
    key: 'restricciones',
    label: 'Restricciones',
    items: [{ key: 'no-delete', label: 'No puede eliminar registros (productos, ventas, publicaciones, etc.)' }],
  },
  {
    key: 'plataforma',
    label: 'Administrador de plataforma',
    items: [
      { key: 'companies', label: 'Empresas' },
      { key: 'connections', label: 'Conexiones globales' },
    ],
  },
  {
    key: 'admin',
    label: 'Ajustes del sistema',
    items: [
      { key: 'emails', label: 'Correos' },
      { key: 'settings', label: 'Configuración' },
    ],
  },
];

export const ALL_PERMISSION_KEYS: string[] = PERMISSION_GROUPS.flatMap((g) =>
  g.items.map((i) => i.key),
);

// Keys de módulos ya eliminados que pueden seguir guardadas en perfiles antiguos
// (p.ej. 'shipping', del módulo de Envíos). Se descartan al guardar en vez de rechazar
// el perfil completo.
export const RETIRED_PERMISSION_KEYS: string[] = ['shipping'];

export function isValidPermissionKey(k: string): boolean {
  return k === '*' || ALL_PERMISSION_KEYS.includes(k);
}

/** Permisos por defecto derivados del rol (compatibilidad hacia atrás). */
export const ROLE_DEFAULT_PERMISSIONS: Record<Role, string[]> = {
  [Role.SUPER_ADMIN]: ['*'],
  [Role.COMPANY_ADMIN]: [
    'dashboard',
    'orders',
    'returns',
    'sales',
    'pos',
    'clientes',
    'ecommerce',
    'billing',
    'ml.preguntas',
    'ml.reclamos',
    'ml.devoluciones',
    'ml.calificaciones',
    'ml.promociones',
    'ml.conexiones',
    'catalog',
    'warehouses',
    'inventory',
    'inventory.adjust',
    'transfers',
    'transfers.receive',
    'purchases',
    'suppliers',
    'dropshipping',
    'rentabilidad',
    'finance',
    'warehouse.board',
    'warehouse.picking',
    'warehouse.packing',
    'despachos',
    'drivers.fleet',
    'drivers.metrics',
    'drivers.payments',
    'drivers.zones',
    'users',
    'access-profiles',
    'activity',
    'emails',
    'settings',
  ],
  [Role.CATALOG_MANAGER]: [
    'dashboard',
    'orders',
    'returns',
    'sales',
    'pos',
    'clientes',
    'ecommerce',
    'billing',
    'ml.preguntas',
    'ml.reclamos',
    'ml.devoluciones',
    'ml.calificaciones',
    'ml.promociones',
    'ml.conexiones',
    'catalog',
    'warehouses',
    'inventory',
    'inventory.adjust',
    'transfers',
    'transfers.receive',
    'purchases',
    'suppliers',
    'dropshipping',
    'rentabilidad',
    'warehouse.board',
    'warehouse.picking',
    'warehouse.packing',
    'despachos',
    'drivers.fleet',
    'drivers.metrics',
    'drivers.zones',
  ],
  [Role.VENDEDOR]: [
    'orders',
    'returns',
    'sales',
    'pos',
    'clientes',
    'ml.preguntas',
    'ml.reclamos',
    'ml.devoluciones',
    'ml.calificaciones',
    'warehouse.picking',
    'warehouse.packing',
  ],
  [Role.DESPACHADOR]: ['mis-rutas', 'warehouse.picking', 'warehouse.packing'],
  [Role.ORDER_MANAGER]: [
    'clientes',
  ],
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

// Restricción "No puede eliminar registros" (Super Admin nunca la tiene).
export const NO_DELETE_PERMISSION = 'no-delete';
export function cannotDelete(user: { role: Role; accessProfile?: { permissions: string[] } | null }): boolean {
  if (user.role === Role.SUPER_ADMIN) return false;
  return permissionsForUser(user).includes(NO_DELETE_PERMISSION);
}

// ── Perfil de acceso → nivel interno (rol) ───────────────────────────────
// Al crear un usuario solo se elige el perfil de acceso. El servidor todavía valida muchas
// páginas por rol, así que el rol se calcula del perfil: el de menor nivel que puede usar
// TODAS las páginas marcadas. Roles que el servidor acepta en cada página (mismas listas que
// el menú); las páginas que el servidor valida solo por permiso aceptan cualquier rol.
const ANY: Role[] = [Role.COMPANY_ADMIN, Role.CATALOG_MANAGER, Role.VENDEDOR, Role.DESPACHADOR, Role.ORDER_MANAGER];
const CA_CM: Role[] = [Role.COMPANY_ADMIN, Role.CATALOG_MANAGER];
const CA_CM_V: Role[] = [Role.COMPANY_ADMIN, Role.CATALOG_MANAGER, Role.VENDEDOR];
export const PAGE_ROLES: Record<string, Role[]> = {
  dashboard: CA_CM,
  orders: CA_CM_V, returns: ANY, sales: CA_CM_V, pos: CA_CM_V,
  clientes: [Role.COMPANY_ADMIN, Role.CATALOG_MANAGER, Role.VENDEDOR, Role.ORDER_MANAGER],
  ecommerce: CA_CM, billing: CA_CM, dropshipping: CA_CM,
  'ml.preguntas': CA_CM_V, 'ml.reclamos': CA_CM_V, 'ml.devoluciones': CA_CM_V, 'ml.calificaciones': CA_CM_V,
  'ml.promociones': ANY, 'ml.conexiones': CA_CM,
  catalog: CA_CM, warehouses: CA_CM, inventory: ANY, 'inventory.adjust': ANY, transfers: ANY, 'transfers.receive': ANY,
  purchases: CA_CM, suppliers: CA_CM, rentabilidad: CA_CM,
  finance: ANY,
  'warehouse.board': ANY, 'warehouse.picking': ANY, 'warehouse.packing': ANY,
  despachos: CA_CM, 'mis-rutas': [Role.DESPACHADOR],
  'drivers.fleet': ANY, 'drivers.metrics': ANY, 'drivers.payments': ANY, 'drivers.zones': ANY,
  users: [Role.COMPANY_ADMIN], 'access-profiles': [Role.COMPANY_ADMIN], activity: ANY,
  emails: [Role.COMPANY_ADMIN], settings: [Role.COMPANY_ADMIN],
};
// De menor a mayor nivel: se elige el primero que cubre todas las páginas del perfil.
const ROLE_LEVELS: Role[] = [Role.ORDER_MANAGER, Role.DESPACHADOR, Role.VENDEDOR, Role.CATALOG_MANAGER, Role.COMPANY_ADMIN];

export function roleForPermissions(perms: string[]): { role: Role; uncovered: string[] } {
  if (perms.includes('*')) return { role: Role.COMPANY_ADMIN, uncovered: [] };
  const pages = perms.filter((p) => PAGE_ROLES[p]);
  for (const r of ROLE_LEVELS) {
    if (pages.every((p) => PAGE_ROLES[p].includes(r))) return { role: r, uncovered: [] };
  }
  // Ningún nivel cubre todo (p. ej. "Mis rutas" junto a páginas de administración): el que cubre más.
  let best: Role = Role.COMPANY_ADMIN;
  let bestMissing = pages.filter((p) => !PAGE_ROLES[p].includes(best));
  for (const r of ROLE_LEVELS) {
    const missing = pages.filter((p) => !PAGE_ROLES[p].includes(r));
    if (missing.length < bestMissing.length) { best = r; bestMissing = missing; }
  }
  return { role: best, uncovered: bestMissing };
}

// Perfiles con que parte cada empresa (editables): Administrador, Vendedor y Gestor de catálogo.
// Despachador y Admin. pedidos solo se crean si la empresa ya tenía usuarios con esos roles.
export const DEFAULT_PROFILES: { name: string; role: Role; base: boolean }[] = [
  { name: 'Administrador', role: Role.COMPANY_ADMIN, base: true },
  { name: 'Vendedor', role: Role.VENDEDOR, base: true },
  { name: 'Gestor de catálogo', role: Role.CATALOG_MANAGER, base: true },
  { name: 'Despachador', role: Role.DESPACHADOR, base: false },
  { name: 'Admin. pedidos', role: Role.ORDER_MANAGER, base: false },
];
