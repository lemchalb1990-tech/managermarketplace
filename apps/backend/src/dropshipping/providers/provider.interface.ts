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

// Conector para proveedores con API autenticada (login + token), a diferencia del
// conector FEED (URL pública sin auth) que ya maneja DropshippingService directamente.
export interface DropshipCatalogProvider {
  testConnection(credentials: Record<string, string>): Promise<{ success: boolean; message?: string }>;
  fetchCatalog(
    credentials: Record<string, string>,
    tokenCache: DropshipTokenCache | null,
  ): Promise<DropshipCatalogFetchResult>;
}
