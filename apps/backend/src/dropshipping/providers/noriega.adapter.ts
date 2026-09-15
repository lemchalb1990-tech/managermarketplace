import { Injectable, Logger } from '@nestjs/common';
import { DropshipCatalogFetchResult, DropshipCatalogProvider, DropshipCatalogRow, DropshipTokenCache } from './provider.interface';

// Ver "API de Productos Noriega — Guía de Inicio Rápido" (proveedor externo).
const DEFAULT_BASE_URL = 'http://190.208.53.9:3004';
// Noriega limita a 100 requests/min; con ~5.000 productos por página alcanzan pocas
// páginas para el catálogo completo, pero igual espaciamos las requests por margen.
const REQUEST_DELAY_MS = 650;
// Refresca el token un poco antes de que venza (venceEn: "8h") en vez de esperar el 401.
const TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000;

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
    const res = await fetch(`${baseUrl(credentials)}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rut, usuario, password }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data?.token) {
      throw new Error(data?.message || `No se pudo autenticar con el proveedor (${res.status})`);
    }
    const login = data as NoriegaLoginResponse;
    return {
      token: login.token,
      expiresAt: new Date(Date.now() + login.venceEnSegundos * 1000),
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

  async fetchCatalog(
    credentials: Record<string, string>,
    tokenCache: DropshipTokenCache | null,
  ): Promise<DropshipCatalogFetchResult> {
    let cache = tokenCache && tokenCache.expiresAt.getTime() - Date.now() > TOKEN_REFRESH_MARGIN_MS
      ? tokenCache
      : await this.login(credentials);

    const rows: DropshipCatalogRow[] = [];
    let pagina = 1;
    let reloginAttempted = false;

    while (true) {
      const res = await fetch(`${baseUrl(credentials)}/api/productos?pagina=${pagina}`, {
        headers: { Authorization: `Bearer ${cache.token}` },
      });

      if (res.status === 401 && !reloginAttempted) {
        // El token cacheado venció antes de lo esperado: reloguea una vez y reintenta la página.
        reloginAttempted = true;
        cache = await this.login(credentials);
        continue;
      }
      if (!res.ok) {
        throw new Error(`El proveedor respondió ${res.status} en la página ${pagina}`);
      }

      const data = (await res.json()) as NoriegaProductsResponse;
      rows.push(...(data.datos || []).map(mapRow).filter((r) => r.sku));

      if (!data.hayMas) break;
      pagina = data.siguientePagina ?? pagina + 1;
      reloginAttempted = false;
      await sleep(REQUEST_DELAY_MS);
    }

    this.logger.log(`Catálogo Noriega descargado: ${rows.length} productos`);
    return { rows, tokenCache: cache };
  }
}
