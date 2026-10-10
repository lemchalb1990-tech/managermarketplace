// Tipos comunes de las integraciones con couriers (Chilexpress, Starken, Blue Express).

export type CourierKey = 'CHILEXPRESS' | 'STARKEN' | 'BLUEXPRESS';

export type CourierCredentials = Record<string, string | undefined>;

// Datos del remitente y valores por defecto del paquete, guardados en la conexión.
export interface CourierSettings {
  senderName?: string;
  senderRut?: string;
  senderPhone?: string;
  senderEmail?: string;
  originAddress?: string;
  originNumber?: string;
  originCommune?: string;
  originRegion?: string;
  // Paquete por defecto (cm / kg)
  defaultWeight?: number;
  defaultLength?: number;
  defaultWidth?: number;
  defaultHeight?: number;
  // Rutas de la API configurables (Starken / Blue Express): por confirmar con cada courier.
  baseUrl?: string;
  [k: string]: unknown;
}

export interface PackageInfo {
  weight: number; // kg
  length: number; // cm
  width: number;
  height: number;
  declaredValue: number; // CLP
  content: string;
}

export interface Destination {
  name: string;
  phone?: string;
  email?: string;
  address: string; // calle y número
  number?: string;
  supplement?: string; // depto, oficina
  commune: string;
  region?: string;
}

export interface QuoteOption {
  serviceCode: string;
  serviceName: string;
  price: number | null;
  days?: string | null;
}

export interface CreatedShipment {
  trackingNumber: string;
  serviceName?: string;
  price?: number | null;
  label?: { bytes: Buffer; mime: string; ext: string } | null;
  labelUrl?: string | null;
  raw?: unknown;
}

// Estado normalizado del envío.
export type ShipmentState = 'CREATED' | 'IN_TRANSIT' | 'OUT_FOR_DELIVERY' | 'DELIVERED' | 'EXCEPTION' | 'CANCELLED';

export interface TrackingEvent {
  date: string; // ISO
  description: string;
  location?: string | null;
}

export interface TrackingResult {
  state: ShipmentState;
  statusText: string;
  events: TrackingEvent[];
}

export interface CourierAdapter {
  key: CourierKey;
  test(creds: CourierCredentials, settings: CourierSettings): Promise<string>;
  quote(creds: CourierCredentials, settings: CourierSettings, dest: Destination, pkg: PackageInfo): Promise<QuoteOption[]>;
  create(
    creds: CourierCredentials,
    settings: CourierSettings,
    input: { dest: Destination; pkg: PackageInfo; serviceCode?: string; reference: string },
  ): Promise<CreatedShipment>;
  track(creds: CourierCredentials, settings: CourierSettings, trackingNumber: string): Promise<TrackingResult>;
}

// ── Utilidades compartidas ──────────────────────────────────────────────

export const normalize = (s: string) =>
  (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

// Clasifica un texto de estado del courier en el estado normalizado.
export function classifyStatus(text: string): ShipmentState {
  const t = normalize(text);
  if (/ENTREGAD|ENTREGA EXITOSA|DELIVERED/.test(t) && !/NO ENTREGAD|SIN ENTREGA/.test(t)) return 'DELIVERED';
  if (/ANULAD|CANCELAD/.test(t)) return 'CANCELLED';
  if (/EN REPARTO|EN RUTA DE ENTREGA|SALIDA A REPARTO|OUT FOR DELIVERY/.test(t)) return 'OUT_FOR_DELIVERY';
  if (/NO ENTREGAD|DEVUEL|SINIESTR|INCIDEN|DIRECCION INCORRECTA|RECHAZ|EXCEPCION|PROBLEMA/.test(t)) return 'EXCEPTION';
  if (/TRANSITO|RECIBID|RETIRAD|EN CAMINO|ADMITID|CENTRO DE DISTRIBUCION|EN PLANTA|DESPACHAD/.test(t)) return 'IN_TRANSIT';
  return 'CREATED';
}

// fetch con tiempo límite y mensaje de error útil (cuerpo de la respuesta incluido).
export async function httpJson(url: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<any> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), init.timeoutMs ?? 25000);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    const text = await res.text();
    let body: any = text;
    try { body = text ? JSON.parse(text) : null; } catch { /* respuesta no JSON */ }
    if (!res.ok) {
      const msg = typeof body === 'string' ? body.slice(0, 300) : JSON.stringify(body).slice(0, 300);
      throw new Error(`HTTP ${res.status} en ${new URL(url).pathname}: ${msg}`);
    }
    return body;
  } catch (e: any) {
    if (e?.name === 'AbortError') throw new Error(`El courier no respondió a tiempo (${new URL(url).host})`);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

// Busca el primer valor (string/número) cuyo nombre de campo coincida, en cualquier nivel.
export function findField(obj: any, names: string[], depth = 0): any {
  if (!obj || typeof obj !== 'object' || depth > 6) return undefined;
  for (const n of names) {
    if (obj[n] != null && typeof obj[n] !== 'object') return obj[n];
  }
  for (const v of Object.values(obj)) {
    const r = findField(v, names, depth + 1);
    if (r != null) return r;
  }
  return undefined;
}

export const pdfFromBase64 = (b64?: string | null) =>
  b64 ? { bytes: Buffer.from(String(b64).replace(/^data:[^,]+,/, ''), 'base64'), mime: 'application/pdf', ext: 'pdf' } : null;

// Fecha del courier a ISO: acepta "2026-10-10 14:30", "10-10-2026 14:30" o "10/10/2026"; si no se
// entiende, usa la hora actual (nunca lanza).
export function safeIso(date?: string | null, time?: string | null): string {
  const raw = `${date || ''} ${time || ''}`.trim();
  if (!raw) return new Date().toISOString();
  const m = raw.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})(?:[ T](\d{1,2}):(\d{2}))?/);
  const d = m ? new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]), Number(m[4] || 0), Number(m[5] || 0)) : new Date(raw);
  return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}
