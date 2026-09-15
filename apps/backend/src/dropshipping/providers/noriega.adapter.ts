import { Injectable, Logger } from '@nestjs/common';
import {
  DropshipCatalogFetchResult, DropshipCatalogPage, DropshipCatalogProvider,
  DropshipCatalogRow, DropshipTokenCache,
} from './provider.interface';

// Ver "API de Productos Noriega — Guía de Inicio Rápido" (proveedor externo).
const DEFAULT_BASE_URL = 'http://190.208.53.9:3004';
// Noriega limita a 100 requests/min; con ~5.000 productos por página alcanzan pocas
// páginas para el catálogo completo, pero igual espaciamos las requests por margen.
const REQUEST_DELAY_MS = 650;
// Refresca el token un poco antes de que venza (venceEn: "8h") en vez de esperar el 401.
const TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000;
// Si el proveedor no responde en este tiempo (red caída, servidor colgado) cortamos con
// un error claro en vez de dejar la request pegada indefinidamente.
const REQUEST_TIMEOUT_MS = 20_000;
// Corta un loop infinito si el proveedor nunca manda hayMas:false (o siguientePagina no avanza).
const MAX_PAGES_SAFETY = 50;

interface NoriegaLoginResponse {
  ok: boolean;
  token: string;
  venceEnSegundos: number;
}

interface NoriegaProductsResponse {
  ok: boolean;
  datos: Array<Record<string, any>>;
  hayMas: boolean;
  siguientePagina?: number;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function baseUrl(credentials: Record<string, string>): string {
  return (credentials.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
}

async function fetchWithTimeout(url: string, init: RequestInit = {}, timeoutMs = REQUEST_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      throw new Error(`El proveedor no respondió en ${Math.round(timeoutMs / 1000)}s (¿URL/red caída?)`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function mapRow(rec: Record<string, any>): DropshipCatalogRow {
  const sku = String(rec.sku ?? '').trim();
  const cost = rec.precioFinal ?? rec.precio;
  // La marca/modelo/año de aplicación no tienen columna propia en nuestro catálogo:
  // se guardan en la descripción para no perder el dato de compatibilidad.
  const compat = [rec.marca, rec.modelo, rec.desde && rec.hasta ? `${rec.desde}-${rec.hasta}` : null]
    .filter(Boolean).join(' ');
  return {
    sku,
    name: [rec.nombre_producto, rec.marca_producto].filter(Boolean).join(' ').trim() || undefined,
    description: compat || undefined,
    stock: rec.stock != null ? Math.max(0, Math.round(Number(rec.stock))) : undefined,
    cost: cost != null ? Number(cost) : undefined,
    price: rec.precio != null ? Number(rec.precio) : undefined,
  };
}

@Injectable()
export class NoriegaAdapter implements DropshipCatalogProvider {
  private readonly logger = new Logger(NoriegaAdapter.name);

  private async login(credentials: Record<string, string>): Promise<DropshipTokenCache> {
    const { rut, usuario, password } = credentials;
    if (!rut || !usuario || !password) {
      throw new Error('Faltan credenciales (rut, usuario, password) para el proveedor');
    }
    const res = await fetchWithTimeout(`${baseUrl(credentials)}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rut, usuario, password }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data?.token) {
      throw new Error(data?.message || `No se pudo autenticar con el proveedor (${res.status})`);
    }
    const login = data as NoriegaLoginResponse;
    // Si el proveedor no manda venceEnSegundos con el nombre/forma esperada, cae a 8h
    // (documentado) en vez de construir una fecha inválida que después Prisma rechaza.
    const seconds = Number(login.venceEnSegundos);
    const ttlSeconds = Number.isFinite(seconds) && seconds > 0 ? seconds : 8 * 60 * 60;
    return {
      token: login.token,
      expiresAt: new Date(Date.now() + ttlSeconds * 1000),
    };
  }

  async testConnection(credentials: Record<string, string>): Promise<{ success: boolean; message?: string }> {
    try {
      await this.login(credentials);
      return { success: true };
    } catch (err: any) {
      return { success: false, message: err?.message || 'No se pudo conectar con el proveedor' };
    }
  }

  // Trae UNA sola página del proveedor (hasta 5.000 productos). Se usa para el buscador
  // "Agregar productos": muestra resultados enseguida en vez de esperar el catálogo entero.
  async fetchPage(
    credentials: Record<string, string>,
    tokenCache: DropshipTokenCache | null,
    page: number,
  ): Promise<DropshipCatalogPage> {
    let cache = tokenCache && tokenCache.expiresAt.getTime() - Date.now() > TOKEN_REFRESH_MARGIN_MS
      ? tokenCache
      : await this.login(credentials);

    const url = `${baseUrl(credentials)}/api/productos?pagina=${page}`;
    let res = await fetchWithTimeout(url, { headers: { Authorization: `Bearer ${cache.token}` } });
    if (res.status === 401) {
      cache = await this.login(credentials);
      res = await fetchWithTimeout(url, { headers: { Authorization: `Bearer ${cache.token}` } });
    }
    if (!res.ok) throw new Error(`El proveedor respondió ${res.status} en la página ${page}`);

    const data = (await res.json()) as NoriegaProductsResponse;
    const rows = (data.datos || []).map(mapRow).filter((r) => r.sku);
    return {
      rows,
      hasMore: !!data.hayMas,
      nextPage: data.hayMas ? (data.siguientePagina ?? page + 1) : null,
      tokenCache: cache,
    };
  }

  // Trae el catálogo completo (todas las páginas). Se usa solo para el sync de
  // actualización de precio/stock de productos ya vinculados.
  async fetchCatalog(
    credentials: Record<string, string>,
    tokenCache: DropshipTokenCache | null,
  ): Promise<DropshipCatalogFetchResult> {
    let cache = tokenCache;
    const rows: DropshipCatalogRow[] = [];
    let pagina = 1;
    let pageCount = 0;

    while (true) {
      pageCount++;
      if (pageCount > MAX_PAGES_SAFETY) {
        throw new Error(`Se alcanzaron ${MAX_PAGES_SAFETY} páginas sin terminar; el proveedor podría no estar indicando el fin del catálogo correctamente`);
      }

      const result = await this.fetchPage(credentials, cache, pagina);
      cache = result.tokenCache;
      rows.push(...result.rows);

      if (!result.hasMore || result.nextPage == null) break;
      pagina = result.nextPage;
      await sleep(REQUEST_DELAY_MS);
    }

    this.logger.log(`Catálogo Noriega descargado: ${rows.length} productos`);
    return { rows, tokenCache: cache! };
  }
}
