// Clasificación de las peticiones que modifican datos para el historial de actividad: módulo,
// tipo de acción, entidad afectada y una pista legible. Las consultas (búsquedas, vistas
// previas, reportes, diagnósticos) no son acciones y no se registran.

export type ActivityAction =
  | 'CREAR' | 'EDITAR' | 'ELIMINAR' | 'IMPORTAR' | 'PUBLICAR' | 'SINCRONIZAR' | 'ESTADO'
  | 'UNIFICAR' | 'EMITIR' | 'SESION' | 'SESION_FALLIDA' | 'BLOQUEADO' | 'ALERTA';

export const ACTION_LABELS: Record<ActivityAction, string> = {
  CREAR: 'Crear', EDITAR: 'Editar', ELIMINAR: 'Eliminar', IMPORTAR: 'Importar', PUBLICAR: 'Publicar',
  SINCRONIZAR: 'Sincronizar', ESTADO: 'Cambio de estado', UNIFICAR: 'Unificar', EMITIR: 'Emitir documento',
  SESION: 'Inicio de sesión', SESION_FALLIDA: 'Inicio de sesión fallido', BLOQUEADO: 'Acción bloqueada', ALERTA: 'Alerta',
};

const VERB: Record<ActivityAction, string> = {
  CREAR: 'Creó', EDITAR: 'Editó', ELIMINAR: 'Eliminó', IMPORTAR: 'Importó', PUBLICAR: 'Publicó',
  SINCRONIZAR: 'Sincronizó', ESTADO: 'Cambió el estado de', UNIFICAR: 'Unificó', EMITIR: 'Emitió',
  SESION: 'Inició sesión', SESION_FALLIDA: 'Intento de inicio de sesión fallido', BLOQUEADO: 'Intentó eliminar (bloqueado)', ALERTA: 'Alerta',
};

// Primer segmento de la ruta (o los dos primeros) → módulo.
const MODULES: [RegExp, string][] = [
  [/^\/ecommerce\/ml\//, 'Mercado Libre'],
  [/^\/ecommerce\/connections\//, 'Marketplaces'],
  [/^\/ecommerce\//, 'Marketplaces'],
  [/^\/catalog\//, 'Catálogo'],
  [/^\/product-masters\//, 'Catálogo'],
  [/^\/pos\//, 'Ventas'],
  [/^\/orders(\/|$)/, 'Órdenes'],
  [/^\/returns(\/|$)/, 'Devoluciones'],
  [/^\/clients(\/|$)/, 'Clientes'],
  [/^\/inventory\//, 'Inventario'],
  [/^\/warehouses?(\/|$)/, 'Bodegas'],
  [/^\/purchases(\/|$)/, 'Compras'],
  [/^\/suppliers(\/|$)/, 'Proveedores'],
  [/^\/dropshipping(\/|$)/, 'Dropshipping'],
  [/^\/finance(\/|$)/, 'Finanzas'],
  [/^\/billing(\/|$)/, 'Facturación'],
  [/^\/(dispatch|drivers)(\/|$)/, 'Repartidores'],
  [/^\/users(\/|$)/, 'Usuarios'],
  [/^\/access-profiles(\/|$)/, 'Perfiles de acceso'],
  [/^\/companies(\/|$)/, 'Empresas'],
  [/^\/(settings|email)(\/|$)/, 'Configuración'],
  [/^\/profitability(\/|$)/, 'Rentabilidad'],
  [/^\/auth(\/|$)/, 'Sesión'],
];

export const MODULE_NAMES = Array.from(new Set(MODULES.map(([, m]) => m).concat(['Seguridad'])));

// POST que solo consultan o calculan (no cambian datos).
const READ_ONLY = /(preview|search|resolve-codes|\/test$|test-connection|check|diagnostic|thumbnail|account-info|app-setup|summary|report|export|template|print|labels?(\/|$)|notifications|\/seen|\/read$|refresh-token|calculate|quote|validate|lookup|suggest|sale-terms|categories|attributes|families|hierarchies|store-prices|predict|progress|status-check|publish-status|images-diagnostic|\/auth\/me|deploy)/i;

// Pistas legibles según el final de la ruta.
const HINTS: [RegExp, string][] = [
  [/\/images?(\/|$)/, 'imagen'], [/\/photos?(\/|$)/, 'foto'], [/\/stock$/, 'stock'],
  [/account-prices/, 'precios y títulos por cuenta'], [/channel-price/, 'precio por canal'],
  [/\/toggle$/, 'pausar o activar publicación'], [/\/publish/, 'publicación'], [/\/remote$/, 'borrado en la tienda'],
  [/\/listings?(\/|$)/, 'vínculo de publicación'], [/\/sync/, 'sincronización'], [/\/pull\//, 'traer desde Mercado Libre'],
  [/\/checks?(\/|$)/, 'verificación de productos'], [/\/status$/, 'estado'], [/bulk\/merge/, 'unificación de productos'],
  [/bulk/, 'en lote'], [/reimport/, 'reimportación'], [/\/answer/, 'respuesta a pregunta'], [/\/active$/, 'activar o desactivar'],
  [/\/primary$/, 'imagen principal'], [/\/link$/, 'vínculo manual'], [/import/, 'importación'], [/\/logo$/, 'logo'],
];

export interface RouteInfo {
  module: string;
  action: ActivityAction;
  hint: string | null;
  entity: string | null;     // 'product' | 'order' | 'sale' | 'user' | 'profile' | 'connection' | null
  entityId: string | null;
}

const ENTITY_PATTERNS: [RegExp, string][] = [
  [/\/catalog\/products\/(?!bulk|search|critical|categories|import)([^/]+)/, 'product'],
  [/\/products\/(?!bulk|search|critical)([^/]+)\/(publish|sync|toggle|pull|account-prices|walmart|listing|link|channel-price|remote|images)/, 'product'],
  [/\/ecommerce\/ml\/products\/([^/]+)/, 'product'],
  [/\/product-masters\/products\/([^/]+)/, 'product'],
  [/^\/orders\/([^/]+)/, 'order'],
  [/\/(pos|ecommerce\/ml)\/sales\/(?!bulk|summary|weekly|monthly|merge)([^/]+)/, 'sale'],
  [/^\/users\/([^/]+)/, 'user'],
  [/^\/access-profiles\/([^/]+)/, 'profile'],
  [/\/ecommerce\/(ml\/)?connections\/([^/]+)/, 'connection'],
];

export function classifyRequest(method: string, path: string): RouteInfo | null {
  const m = method.toUpperCase();
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(m)) return null;
  if (m !== 'DELETE' && READ_ONLY.test(path)) return null;
  const module = MODULES.find(([re]) => re.test(path))?.[1];
  if (!module) return null;

  let action: ActivityAction;
  if (m === 'DELETE' || /(bulk\/delete|bulk-delete|delete-listings)/.test(path)) action = 'ELIMINAR';
  else if (/bulk\/merge|merge-duplicate/.test(path)) action = 'UNIFICAR';
  else if (/import/.test(path)) action = 'IMPORTAR';
  else if (/\/publish/.test(path)) action = 'PUBLICAR';
  else if (/\/(sync|pull|reimport|resync)/.test(path)) action = 'SINCRONIZAR';
  else if (/\/(toggle|status|active|cancel|dispatch|receive|deliver)(\/|$)/.test(path)) action = 'ESTADO';
  else if (/\/billing\/.*(issue|emit|invoices$|send)/.test(path)) action = 'EMITIR';
  else action = m === 'POST' ? 'CREAR' : 'EDITAR';

  let entity: string | null = null;
  let entityId: string | null = null;
  for (const [re, kind] of ENTITY_PATTERNS) {
    const mm = re.exec(path);
    if (mm) {
      entity = kind;
      entityId = kind === 'connection' ? mm[2] : kind === 'sale' ? mm[2] : mm[1];
      break;
    }
  }
  const hint = HINTS.find(([re]) => re.test(path))?.[1] ?? null;
  return { module, action, hint, entity, entityId };
}

const NOUN: Record<string, string> = {
  product: 'el producto', order: 'la orden', sale: 'la venta', user: 'el usuario', profile: 'el perfil',
  connection: 'la conexión',
};

export function buildSummary(action: ActivityAction, info: { entity: string | null; label: string | null; hint: string | null; module: string }) {
  const verb = VERB[action];
  const target = info.entity ? `${NOUN[info.entity] || ''}${info.label ? ` ${info.label}` : ''}`.trim() : (info.label || `en ${info.module}`);
  return `${verb} ${target}${info.hint ? ` (${info.hint})` : ''}`.replace(/\s+/g, ' ').trim();
}
