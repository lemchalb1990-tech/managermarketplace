// Fila normalizada de catálogo, misma forma que ya consume DropshippingService al
// crear/actualizar DropshipProduct y Product a partir de un feed CSV/JSON.
export interface DropshipCatalogRow {
  sku: string;
  name?: string;
  description?: string;
  imageUrl?: string;
  stock?: number;
  cost?: number;
  price?: number;
}

export interface DropshipTokenCache {
  token: string;
  expiresAt: Date;
}

export interface DropshipCatalogFetchResult {
  rows: DropshipCatalogRow[];
  tokenCache: DropshipTokenCache;
}

export interface DropshipCatalogPage {
  rows: DropshipCatalogRow[];
  hasMore: boolean;
  nextPage: number | null;
  tokenCache: DropshipTokenCache;
}

function stripBullet(line: string): string {
  return line.replace(/^-\s*/, '').trim();
}

// Algunos proveedores (ej. Noriega) repiten el mismo SKU una vez por cada modelo de
// vehículo al que aplica, con el resto de los datos idénticos. Junta esas filas en una
// sola y deja las descripciones distintas como lista, en vez de perder todas menos una.
export function mergeDuplicateSkuRows(rows: DropshipCatalogRow[]): DropshipCatalogRow[] {
  const bySku = new Map<string, DropshipCatalogRow[]>();
  const order: string[] = [];
  for (const row of rows) {
    if (!bySku.has(row.sku)) { bySku.set(row.sku, []); order.push(row.sku); }
    bySku.get(row.sku)!.push(row);
  }
  return order.map((sku) => {
    const group = bySku.get(sku)!;
    const base = group[0];
    if (group.length === 1) return base;
    const lines = Array.from(new Set(
      group.flatMap((r) => (r.description || '').split('\n').map(stripBullet).filter(Boolean)),
    ));
    return {
      ...base,
      description: lines.length > 1 ? lines.map((l) => `- ${l}`).join('\n') : (lines[0] ?? base.description),
    };
  });
}

// Conector para proveedores con API autenticada (login + token), a diferencia del
// conector FEED (URL pública sin auth) que ya maneja DropshippingService directamente.
export interface DropshipCatalogProvider {
  testConnection(credentials: Record<string, string>): Promise<{ success: boolean; message?: string }>;
  // Catálogo completo (todas las páginas) — para refrescar productos ya vinculados.
  fetchCatalog(
    credentials: Record<string, string>,
    tokenCache: DropshipTokenCache | null,
  ): Promise<DropshipCatalogFetchResult>;
  // Una sola página — para que el buscador muestre resultados sin esperar todo el catálogo.
  fetchPage(
    credentials: Record<string, string>,
    tokenCache: DropshipTokenCache | null,
    page: number,
  ): Promise<DropshipCatalogPage>;
}
