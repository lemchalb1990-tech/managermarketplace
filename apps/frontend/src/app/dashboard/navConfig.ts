import { hasModule, planAllows, type PlanFeature } from '@/lib/modules';
import { can } from '@/lib/permissions';

// superOnly: visible solo para Super Admin aunque el perfil de acceso traiga '*' o la key.
// anyPerm: el ítem se ve con cualquiera de esos permisos (además de `perm`).
// planFeature: función del plan comercial que debe incluir la empresa (si no, se oculta).
// adminWithoutModule: sin el módulo, igual lo ve el administrador de la empresa (p. ej. Órdenes
// como historial cuando la empresa no usa el proceso de órdenes).
// Visibilidad = mismo criterio que el servidor: la mayoría de las páginas las valida por ROL
// (el ítem exige el permiso Y uno de `roles`); las que el servidor valida solo por PERMISO
// (permOnly) se muestran con el permiso aunque el rol no esté en la lista. Así un perfil
// amplio (p. ej. "Acceso total") en un rol menor no ve opciones que luego dirían
// "No tienes permisos para esta acción".
export type NavItem = { href: string; label: string; perm: string; anyPerm?: string[]; roles: string[]; module: string | null; superOnly?: boolean; planFeature?: PlanFeature; permOnly?: boolean; adminWithoutModule?: boolean };
export type NavGroup = { key: string; label: string; items: NavItem[] };

// Estructura por secciones (estilo consola de operación). Cada ítem conserva su
// gate por rol y por módulo; los grupos sin ítems visibles se ocultan solos.
export const navGroups: NavGroup[] = [
  {
    key: 'inicio',
    label: '',
    items: [
      { href: '/dashboard', label: 'Inicio', perm: 'dashboard', roles: ['SUPER_ADMIN', 'COMPANY_ADMIN', 'CATALOG_MANAGER'], module: null },
    ],
  },
  {
    key: 'ventas',
    label: 'Ventas',
    items: [
      { href: '/dashboard/pos', label: 'Punto de Venta', perm: 'pos', roles: ['SUPER_ADMIN', 'COMPANY_ADMIN', 'CATALOG_MANAGER', 'VENDEDOR'], module: 'pos' },
      { href: '/dashboard/pos/ordenes-trabajo', label: 'Órdenes de trabajo', perm: 'pos.work-orders', roles: ['SUPER_ADMIN', 'COMPANY_ADMIN', 'CATALOG_MANAGER', 'VENDEDOR'], module: 'pos' },
      { href: '/dashboard/pos/cierre-caja', label: 'Cierre de caja', perm: 'pos', roles: ['SUPER_ADMIN', 'COMPANY_ADMIN', 'CATALOG_MANAGER', 'VENDEDOR'], module: 'pos' },
      { href: '/dashboard/clientes', label: 'Registro de Clientes', perm: 'clientes', roles: ['SUPER_ADMIN', 'COMPANY_ADMIN', 'CATALOG_MANAGER', 'VENDEDOR', 'ORDER_MANAGER'], module: null },
      { href: '/dashboard/devoluciones', label: 'Devoluciones', perm: 'returns', roles: ['SUPER_ADMIN', 'COMPANY_ADMIN', 'CATALOG_MANAGER', 'VENDEDOR'], module: null, permOnly: true },
      { href: '/dashboard/orders', label: 'Órdenes', perm: 'orders', roles: ['SUPER_ADMIN', 'COMPANY_ADMIN', 'CATALOG_MANAGER', 'VENDEDOR'], module: 'orders', adminWithoutModule: true },
      { href: '/dashboard/sales', label: 'Reporte de Ventas', perm: 'sales', roles: ['SUPER_ADMIN', 'COMPANY_ADMIN', 'CATALOG_MANAGER', 'VENDEDOR'], module: 'sales' },
      { href: '/dashboard/reportes', label: 'Reportes Detalles de Ventas', perm: 'sales.reports', roles: ['SUPER_ADMIN', 'COMPANY_ADMIN'], module: 'detailed_reports', permOnly: true },
    ],
  },
  {
    key: 'canales',
    label: 'Sincronizaciones',
    items: [
      { href: '/dashboard/mis-conexiones', label: 'Mis conexiones', perm: 'ecommerce.connections', roles: ['SUPER_ADMIN', 'COMPANY_ADMIN', 'CATALOG_MANAGER'], module: 'ecommerce' },
      { href: '/dashboard/ecommerce', label: 'E-commerce', perm: 'ecommerce', roles: ['SUPER_ADMIN', 'COMPANY_ADMIN', 'CATALOG_MANAGER'], module: 'ecommerce' },
      { href: '/dashboard/billing', label: 'Facturación', perm: 'billing', roles: ['SUPER_ADMIN', 'COMPANY_ADMIN', 'CATALOG_MANAGER'], module: 'billing' },
      { href: '/dashboard/couriers', label: 'Couriers', perm: 'couriers', roles: ['SUPER_ADMIN', 'COMPANY_ADMIN'], module: 'ecommerce' },
      { href: '/dashboard/dropshipping', label: 'Dropshipping', perm: 'dropshipping', roles: ['SUPER_ADMIN', 'COMPANY_ADMIN', 'CATALOG_MANAGER'], module: 'dropshipping' },
    ],
  },
  {
    key: 'mercadolibre',
    label: 'Mercado Libre',
    items: [
      { href: '/dashboard/mercadolibre/preguntas', label: 'Preguntas', perm: 'ml.preguntas', roles: ['SUPER_ADMIN', 'COMPANY_ADMIN', 'CATALOG_MANAGER', 'VENDEDOR'], module: 'ecommerce' },
      { href: '/dashboard/mercadolibre/mensajes', label: 'Mensajes', perm: 'ml.mensajes', roles: ['SUPER_ADMIN', 'COMPANY_ADMIN', 'CATALOG_MANAGER', 'VENDEDOR'], module: 'ecommerce' },
      { href: '/dashboard/mercadolibre/reclamos', label: 'Reclamos', perm: 'ml.reclamos', roles: ['SUPER_ADMIN', 'COMPANY_ADMIN', 'CATALOG_MANAGER', 'VENDEDOR'], module: 'ecommerce' },
      { href: '/dashboard/mercadolibre/devoluciones', label: 'Devoluciones', perm: 'ml.devoluciones', roles: ['SUPER_ADMIN', 'COMPANY_ADMIN', 'CATALOG_MANAGER', 'VENDEDOR'], module: 'ecommerce' },
      { href: '/dashboard/mercadolibre/calificaciones', label: 'Calificaciones', perm: 'ml.calificaciones', roles: ['SUPER_ADMIN', 'COMPANY_ADMIN', 'CATALOG_MANAGER', 'VENDEDOR'], module: 'ecommerce' },
      { href: '/dashboard/mercadolibre/promociones', label: 'Promociones', perm: 'ml.promociones', roles: ['SUPER_ADMIN', 'COMPANY_ADMIN', 'CATALOG_MANAGER'], module: 'ecommerce', planFeature: 'ML_PROMOTIONS', permOnly: true },
      { href: '/dashboard/mercadolibre/registros-sin-conexion', label: 'Registros sin conexión', perm: 'connections', roles: ['SUPER_ADMIN'], module: null, superOnly: true },
    ],
  },
  {
    key: 'catalogo',
    label: 'Catálogo y bodega',
    items: [
      { href: '/dashboard/catalog', label: 'Catálogo', perm: 'catalog', roles: ['SUPER_ADMIN', 'COMPANY_ADMIN', 'CATALOG_MANAGER'], module: 'catalog' },
      { href: '/dashboard/warehouses', label: 'Bodegas', perm: 'warehouses', roles: ['SUPER_ADMIN', 'COMPANY_ADMIN', 'CATALOG_MANAGER'], module: 'catalog' },
      { href: '/dashboard/inventario', label: 'Inventario y traspasos', perm: 'inventory', anyPerm: ['warehouses', 'transfers', 'transfers.receive'], roles: ['SUPER_ADMIN', 'COMPANY_ADMIN', 'CATALOG_MANAGER'], module: 'catalog', permOnly: true },
      { href: '/dashboard/purchases', label: 'Compras', perm: 'purchases', roles: ['SUPER_ADMIN', 'COMPANY_ADMIN', 'CATALOG_MANAGER'], module: 'purchases' },
      { href: '/dashboard/suppliers', label: 'Proveedores', perm: 'suppliers', roles: ['SUPER_ADMIN', 'COMPANY_ADMIN', 'CATALOG_MANAGER'], module: 'purchases' },
      { href: '/dashboard/rentabilidad', label: 'Rentabilidad', perm: 'rentabilidad', roles: ['SUPER_ADMIN', 'COMPANY_ADMIN', 'CATALOG_MANAGER'], module: 'rentabilidad' },
    ],
  },
  {
    key: 'finanzas',
    label: 'Finanzas',
    items: [
      { href: '/dashboard/finanzas', label: 'Finanzas y presupuesto', perm: 'finance', roles: ['SUPER_ADMIN', 'COMPANY_ADMIN'], module: 'finance', permOnly: true },
    ],
  },
  {
    key: 'operacion',
    label: 'Operación',
    items: [
      { href: '/dashboard/orders/escanear', label: 'Escanear', perm: 'orders.scan', roles: ['SUPER_ADMIN', 'COMPANY_ADMIN', 'CATALOG_MANAGER', 'VENDEDOR'], module: 'orders' },
      { href: '/dashboard/bodega', label: 'Tablero de bodega', perm: 'warehouse.board', roles: ['SUPER_ADMIN', 'COMPANY_ADMIN', 'CATALOG_MANAGER'], module: 'orders', permOnly: true },
      { href: '/dashboard/bodega/picking', label: 'Picking', perm: 'warehouse.picking', roles: ['SUPER_ADMIN', 'COMPANY_ADMIN', 'CATALOG_MANAGER', 'VENDEDOR', 'DESPACHADOR'], module: 'orders', planFeature: 'PICKING', permOnly: true },
      { href: '/dashboard/bodega/packing', label: 'Packing', perm: 'warehouse.packing', roles: ['SUPER_ADMIN', 'COMPANY_ADMIN', 'CATALOG_MANAGER', 'VENDEDOR', 'DESPACHADOR'], module: 'orders', planFeature: 'PICKING', permOnly: true },
    ],
  },
  {
    key: 'repartidores',
    label: 'Repartidores',
    items: [
      { href: '/dashboard/despachos', label: 'Rutas', perm: 'despachos', roles: ['SUPER_ADMIN', 'COMPANY_ADMIN', 'CATALOG_MANAGER'], module: 'dispatch' },
      { href: '/dashboard/mis-rutas', label: 'Mis rutas', perm: 'mis-rutas', roles: ['DESPACHADOR'], module: 'dispatch' },
      { href: '/dashboard/repartidores/flota', label: 'Flota', perm: 'drivers.fleet', roles: ['SUPER_ADMIN', 'COMPANY_ADMIN', 'CATALOG_MANAGER'], module: 'dispatch', permOnly: true },
      { href: '/dashboard/repartidores/metricas', label: 'Métricas', perm: 'drivers.metrics', roles: ['SUPER_ADMIN', 'COMPANY_ADMIN', 'CATALOG_MANAGER'], module: 'dispatch', permOnly: true },
      { href: '/dashboard/repartidores/remuneracion', label: 'Remuneración', perm: 'drivers.payments', roles: ['SUPER_ADMIN', 'COMPANY_ADMIN'], module: 'dispatch', permOnly: true },
      { href: '/dashboard/repartidores/zonas', label: 'Zonas de demanda', perm: 'drivers.zones', roles: ['SUPER_ADMIN', 'COMPANY_ADMIN', 'CATALOG_MANAGER'], module: 'dispatch', permOnly: true },
    ],
  },
  {
    key: 'colaboradores',
    label: 'Colaboradores',
    items: [
      { href: '/dashboard/users', label: 'Usuarios', perm: 'users', roles: ['SUPER_ADMIN', 'COMPANY_ADMIN'], module: null },
      { href: '/dashboard/access-profiles', label: 'Perfiles de acceso', perm: 'access-profiles', roles: ['SUPER_ADMIN', 'COMPANY_ADMIN'], module: null },
      { href: '/dashboard/actividad', label: 'Historial de actividad', perm: 'activity', roles: ['SUPER_ADMIN', 'COMPANY_ADMIN', 'CATALOG_MANAGER', 'VENDEDOR', 'ORDER_MANAGER', 'DESPACHADOR'], module: null },
    ],
  },
  {
    key: 'plataforma',
    label: 'Administrador de plataforma',
    items: [
      { href: '/dashboard/companies', label: 'Empresas', perm: 'companies', roles: ['SUPER_ADMIN'], module: null, superOnly: true },
      { href: '/dashboard/connections', label: 'Conexiones', perm: 'connections', roles: ['SUPER_ADMIN'], module: null, superOnly: true },
      { href: '/dashboard/sincronizadores', label: 'Sincronizadores', perm: 'connections', roles: ['SUPER_ADMIN'], module: null, superOnly: true },
      { href: '/dashboard/verificador', label: 'Verificador de órdenes', perm: 'connections', roles: ['SUPER_ADMIN'], module: null, superOnly: true },
      { href: '/dashboard/carga-masiva', label: 'Carga masiva de productos', perm: 'companies', roles: ['SUPER_ADMIN'], module: null, superOnly: true },
      { href: '/dashboard/probar-permisos', label: 'Probar permisos', perm: 'companies', roles: ['SUPER_ADMIN'], module: null, superOnly: true },
      { href: '/dashboard/ajustes-sistema', label: 'Ajustes del sistema', perm: 'connections', roles: ['SUPER_ADMIN'], module: null, superOnly: true },
      { href: '/dashboard/correos-plataforma', label: 'Correos de la plataforma', perm: 'connections', roles: ['SUPER_ADMIN'], module: null, superOnly: true },
      { href: '/dashboard/planes', label: 'Planes', perm: 'companies', roles: ['SUPER_ADMIN'], module: null, superOnly: true },
      { href: '/dashboard/ia', label: 'Inteligencia artificial', perm: 'companies', roles: ['SUPER_ADMIN'], module: null, superOnly: true },
    ],
  },
  {
    key: 'admin',
    label: 'Ajustes del sistema',
    items: [
      { href: '/dashboard/emails', label: 'Correos', perm: 'emails', roles: ['SUPER_ADMIN', 'COMPANY_ADMIN'], module: null },
      { href: '/dashboard/settings', label: 'Configuración', perm: 'settings', roles: ['SUPER_ADMIN', 'COMPANY_ADMIN'], module: null },
      { href: '/dashboard/diseno-documentos', label: 'Diseño de documentos', perm: 'print.design', roles: ['SUPER_ADMIN', 'COMPANY_ADMIN'], module: null, permOnly: true },
      { href: '/dashboard/uso', label: 'Uso', perm: 'usage', roles: ['SUPER_ADMIN', 'COMPANY_ADMIN'], module: null },
    ],
  },
];

// Ítems del menú que ve un usuario (también lo usa «Probar permisos» con el usuario simulado).
export function navItemVisible(user: any, n: NavItem): boolean {
  return (!n.superOnly || user.role === 'SUPER_ADMIN')
    && (n.permOnly || user.role === 'SUPER_ADMIN' || n.roles.includes(user.role))
    && (can(user, n.perm, n.roles) || (n.anyPerm ?? []).some((p) => can(user, p, n.roles)))
    && (hasModule(user, n.module) || (!!n.adminWithoutModule && user.role === 'COMPANY_ADMIN'))
    && planAllows(user, n.planFeature);
}

export function visibleNavGroups(user: any): NavGroup[] {
  return navGroups
    .map((g) => ({ ...g, items: g.items.filter((n) => navItemVisible(user, n)) }))
    .filter((g) => g.items.length > 0);
}
