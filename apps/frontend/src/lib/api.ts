const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

export class ApiError extends Error {
  mlErrors?: string[];
  constructor(message: string, mlErrors?: string[]) {
    super(message);
    this.name = 'ApiError';
    this.mlErrors = mlErrors;
  }
}

export async function apiFetch<T>(
  path: string,
  options?: RequestInit,
  token?: string,
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options?.headers as Record<string, string>),
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${API_URL}/api${path}`, { ...options, headers });
  if (!res.ok) {
    const errData = await res.json().catch(() => ({ message: 'Error desconocido' }));
    throw new ApiError(errData.message || `Error ${res.status}`, errData.mlErrors);
  }
  return res.json();
}

export async function apiUpload<T>(path: string, file: File, token: string): Promise<T> {
  const formData = new FormData();
  formData.append('file', file);
  const res = await fetch(`${API_URL}/api${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: formData,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: 'Error desconocido' }));
    throw new Error(err.message || `Error ${res.status}`);
  }
  return res.json();
}

export async function apiUploadForm<T>(
  path: string,
  fields: Record<string, string | undefined>,
  file: File | null,
  token: string,
  method: string = 'POST',
): Promise<T> {
  const formData = new FormData();
  for (const [k, v] of Object.entries(fields)) {
    if (v !== undefined) formData.append(k, v);
  }
  if (file) formData.append('file', file);
  const res = await fetch(`${API_URL}/api${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}` },
    body: formData,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: 'Error desconocido' }));
    throw new Error(err.message || `Error ${res.status}`);
  }
  return res.json();
}

export const imgUrl = (path: string) => /^https?:\/\//.test(path) ? path : `${API_URL}${path}`;

// Algunos proveedores DTE (ej. Facto) devuelven el PDF/XML embebido como data: URI en vez
// de una URL hosteada. Chrome bloquea la navegación directa a un data: URI abierto desde un
// link (sale en blanco) — hay que convertirlo a blob: primero para poder abrirlo/descargarlo.
export async function openDocumentUrl(url: string): Promise<void> {
  if (!url.startsWith('data:')) {
    window.open(url, '_blank', 'noopener,noreferrer');
    return;
  }
  const blob = await fetch(url).then((r) => r.blob());
  const blobUrl = URL.createObjectURL(blob);
  window.open(blobUrl, '_blank', 'noopener,noreferrer');
  setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
}

export async function apiDownload(path: string, token: string, filename: string): Promise<void> {
  const res = await fetch(`${API_URL}/api${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: 'Error desconocido' }));
    throw new Error(err.message || `Error ${res.status}`);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export const api = {
  login: (email: string, password: string) =>
    apiFetch<{ access_token: string; user: any }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),
  me: (token: string) => apiFetch<any>('/auth/me', {}, token),
  companies: {
    list: (token: string) => apiFetch<any[]>('/companies', {}, token),
    create: (data: any, token: string) =>
      apiFetch<any>('/companies', { method: 'POST', body: JSON.stringify(data) }, token),
    update: (id: string, data: any, token: string) =>
      apiFetch<any>(`/companies/${id}`, { method: 'PATCH', body: JSON.stringify(data) }, token),
    remove: (id: string, token: string) =>
      apiFetch<any>(`/companies/${id}`, { method: 'DELETE' }, token),
    deleteAllListings: (id: string, token: string) =>
      apiFetch<{ deleted: number }>(`/companies/${id}/delete-listings`, { method: 'POST' }, token),
  },
  users: {
    list: (token: string) => apiFetch<any[]>('/users', {}, token),
    create: (data: any, token: string) =>
      apiFetch<any>('/users', { method: 'POST', body: JSON.stringify(data) }, token),
    update: (id: string, data: any, token: string) =>
      apiFetch<any>(`/users/${id}`, { method: 'PATCH', body: JSON.stringify(data) }, token),
  },
  catalog: {
    list: (token: string, companyId?: string) => {
      const q = new URLSearchParams();
      if (companyId) q.set('companyId', companyId);
      return apiFetch<any[]>(`/catalog/products?${q}`, {}, token);
    },
    categories: (token: string, companyId?: string) => {
      const q = new URLSearchParams();
      if (companyId) q.set('companyId', companyId);
      return apiFetch<string[]>(`/catalog/products/categories?${q}`, {}, token);
    },
    search: (params: { page?: number; search?: string; warehouseId?: string; category?: string; type?: string; active?: string; companyId?: string; inStock?: boolean; pageSize?: number; sortBy?: string; sortDir?: 'asc' | 'desc' }, token: string) => {
      const q = new URLSearchParams();
      if (params.page) q.set('page', String(params.page));
      if (params.search) q.set('search', params.search);
      if (params.warehouseId) q.set('warehouseId', params.warehouseId);
      if (params.category) q.set('category', params.category);
      if (params.type) q.set('type', params.type);
      if (params.active) q.set('active', params.active);
      if (params.companyId) q.set('companyId', params.companyId);
      if (params.inStock) q.set('inStock', 'true');
      if (params.pageSize) q.set('pageSize', String(params.pageSize));
      if (params.sortBy) q.set('sortBy', params.sortBy);
      if (params.sortDir) q.set('sortDir', params.sortDir);
      return apiFetch<{ products: any[]; total: number; page: number; pages: number }>(`/catalog/products/search?${q}`, {}, token);
    },
    create: (data: any, token: string) =>
      apiFetch<any>('/catalog/products', { method: 'POST', body: JSON.stringify(data) }, token),
    get: (id: string, token: string) => apiFetch<any>(`/catalog/products/${id}`, {}, token),
    update: (id: string, data: any, token: string) =>
      apiFetch<any>(`/catalog/products/${id}`, { method: 'PATCH', body: JSON.stringify(data) }, token),
    adjustStock: (id: string, quantity: number, token: string) =>
      apiFetch<any>(`/catalog/products/${id}/stock`, { method: 'PATCH', body: JSON.stringify({ quantity }) }, token),
    uploadImage: (id: string, file: File, token: string) =>
      apiUpload<any>(`/catalog/products/${id}/images`, file, token),
    deleteImage: (id: string, imageId: string, token: string) =>
      apiFetch<any>(`/catalog/products/${id}/images/${imageId}`, { method: 'DELETE' }, token),
    setPrimaryImage: (id: string, imageId: string, token: string) =>
      apiFetch<any>(`/catalog/products/${id}/images/${imageId}/primary`, { method: 'PATCH' }, token),
    bulkSetActive: (ids: string[], active: boolean, token: string) =>
      apiFetch<{ updated: number }>('/catalog/products/bulk/active', { method: 'PATCH', body: JSON.stringify({ ids, active }) }, token),
    bulkDelete: (ids: string[], token: string) =>
      apiFetch<{ deleted: number; failed: { id: string; name: string; reason: string; canForce?: boolean }[] }>(
        '/catalog/products/bulk/delete', { method: 'POST', body: JSON.stringify({ ids }) }, token),
    forceDelete: (id: string, token: string) =>
      apiFetch<{ deleted: boolean }>(`/catalog/products/${id}/force`, { method: 'DELETE' }, token),
    bulkDeleteListings: (ids: string[], token: string) =>
      apiFetch<{ deleted: number }>(
        '/catalog/products/bulk/delete-listings', { method: 'POST', body: JSON.stringify({ ids }) }, token),
    deleteListing: (productId: string, connectionId: string, token: string) =>
      apiFetch<{ deleted: boolean }>(
        `/catalog/products/${productId}/listings/${connectionId}`, { method: 'DELETE' }, token),
    downloadBulkTemplate: (token: string, companyId?: string) =>
      apiDownload(
        `/catalog/products/bulk/import-template${companyId ? `?companyId=${companyId}` : ''}`,
        token, 'plantilla-stock-precios.xlsx',
      ),
    bulkImport: (file: File, token: string, companyId?: string) =>
      apiUpload<{ updated: number; skipped: number; errors: { row: number; sku: string; reason: string }[] }>(
        `/catalog/products/bulk/import${companyId ? `?companyId=${companyId}` : ''}`, file, token),
  },
  marketplace: {
    getSettings: (token: string, companyId?: string) =>
      apiFetch<{ mlClientId: string | null; hasSecret: boolean }>(
        `/ecommerce/ml/settings${companyId ? `?companyId=${companyId}` : ''}`, {}, token),
    saveCredentials: (data: { mlClientId: string; mlClientSecret: string; companyId?: string }, token: string) =>
      apiFetch<any>('/ecommerce/ml/credentials', { method: 'PATCH', body: JSON.stringify(data) }, token),
    createConnection: (data: { name: string; mlClientId: string; mlClientSecret: string; companyId?: string }, token: string) =>
      apiFetch<any>('/ecommerce/ml/connections', { method: 'POST', body: JSON.stringify(data) }, token),
    authorize: (connectionId: string, token: string) =>
      apiFetch<{ authUrl: string }>(`/ecommerce/ml/connections/${connectionId}/authorize`, { method: 'POST' }, token),
    searchCategories: (q: string, token: string) =>
      apiFetch<{ id: string; name: string }[]>(
        `/ecommerce/ml/categories/search?q=${encodeURIComponent(q)}`, {}, token),
    getCategoryAttributes: (categoryId: string, token: string) =>
      apiFetch<{ attributes: any[]; supportsHtml: boolean }>(
        `/ecommerce/ml/categories/${categoryId}/attributes`, {}, token),
    connections: (token: string, companyId?: string) =>
      apiFetch<any[]>(`/ecommerce/ml/connections${companyId ? `?companyId=${companyId}` : ''}`, {}, token),
    deleteConnection: (id: string, token: string) =>
      apiFetch<any>(`/ecommerce/ml/connections/${id}`, { method: 'DELETE' }, token),
    refreshConnection: (id: string, token: string) =>
      apiFetch<{ id: string; name: string; active: boolean; expiresAt: string | null }>(
        `/ecommerce/ml/connections/${id}/refresh`, { method: 'POST' }, token),
    debugOrder: (connectionId: string, orderId: string, token: string) =>
      apiFetch<any>(`/ecommerce/ml/connections/${connectionId}/debug-order/${orderId}`, {}, token),
    publish: (productId: string, connectionId: string, token: string) =>
      apiFetch<any>(`/ecommerce/ml/products/${productId}/publish/${connectionId}`, { method: 'POST' }, token),
    sync: (productId: string, connectionId: string, token: string) =>
      apiFetch<any>(`/ecommerce/ml/products/${productId}/sync/${connectionId}`, { method: 'POST' }, token),
    syncAll: (productId: string, token: string) =>
      apiFetch<{
        syncedCount: number; failedCount: number;
        results: Array<{ connectionId: string; connectionName: string; success: boolean; warnings: string[]; error: string | null }>;
      }>(`/ecommerce/ml/products/${productId}/sync-all`, { method: 'POST' }, token),
    toggleListing: (productId: string, connectionId: string, token: string) =>
      apiFetch<any>(`/ecommerce/ml/products/${productId}/toggle/${connectionId}`, { method: 'PATCH' }, token),
    previewImport: (connectionId: string, scrollId: string | null, token: string) =>
      apiFetch<{
        connectionName: string;
        total: number;
        hasMore: boolean;
        nextScrollId: string | null;
        alreadyImportedCount: number;
        items: Array<{
          externalId: string; title: string; price: number; stock: number;
          thumbnail: string | null; permalink: string; status: string; sku: string | null;
          matchedProductId: string | null; matchedProductName: string | null;
        }>;
      }>(`/ecommerce/ml/connections/${connectionId}/import/preview${scrollId ? `?scrollId=${encodeURIComponent(scrollId)}` : ''}`, {}, token),
    confirmImport: (connectionId: string, externalIds: string[], unlinkIds: string[], token: string) =>
      apiFetch<{ imported: number; linked: number; skipped: number; errors: string[] }>(
        `/ecommerce/ml/connections/${connectionId}/import/confirm`,
        { method: 'POST', body: JSON.stringify({ externalIds, unlinkIds }) },
        token,
      ),
    previewSalesImport: (connectionId: string, params: { from?: string; to?: string }, token: string) => {
      const q = new URLSearchParams();
      if (params.from) q.set('from', params.from);
      if (params.to) q.set('to', params.to);
      return apiFetch<{
        connectionName: string;
        total: number;
        truncated: boolean;
        alreadyImportedCount: number;
        orders: Array<{
          externalId: string; date: string; total: number; buyerNickname: string | null;
          importable: boolean;
          items: Array<{ title: string; quantity: number; unitPrice: number; resolved: boolean; productName: string | null }>;
          charges: { shippingCost: number; marketplaceFee: number; taxes: number; coupon: number; totalPaid: number };
        }>;
      }>(`/ecommerce/ml/connections/${connectionId}/sales-import/preview?${q}`, {}, token);
    },
    confirmSalesImport: (connectionId: string, externalIds: string[], token: string) =>
      apiFetch<{ imported: number; skipped: number; errors: string[] }>(
        `/ecommerce/ml/connections/${connectionId}/sales-import/confirm`,
        { method: 'POST', body: JSON.stringify({ externalIds }) },
        token,
      ),
  },
  connections: {
    list: (token: string, params?: { marketplace?: string; companyId?: string }) => {
      const q = new URLSearchParams();
      if (params?.marketplace) q.set('marketplace', params.marketplace);
      if (params?.companyId) q.set('companyId', params.companyId);
      return apiFetch<any[]>(`/ecommerce/connections?${q}`, {}, token);
    },
    create: (data: { marketplace: string; name: string; credentials: Record<string, string>; companyId?: string }, token: string) =>
      apiFetch<any>('/ecommerce/connections', { method: 'POST', body: JSON.stringify(data) }, token),
    remove: (id: string, token: string) =>
      apiFetch<any>(`/ecommerce/connections/${id}`, { method: 'DELETE' }, token),
    test: (id: string, token: string) =>
      apiFetch<{ success: boolean; message?: string }>(`/ecommerce/connections/${id}/test`, { method: 'POST' }, token),
    publish: (connectionId: string, productId: string, token: string) =>
      apiFetch<any>(`/ecommerce/connections/${connectionId}/products/${productId}/publish`, { method: 'POST' }, token),
    link: (connectionId: string, productId: string, data: { externalId: string; externalUrl?: string }, token: string) =>
      apiFetch<any>(`/ecommerce/connections/${connectionId}/products/${productId}/link`, { method: 'POST', body: JSON.stringify(data) }, token),
    productListings: (productId: string, token: string) =>
      apiFetch<any[]>(`/ecommerce/connections/products/${productId}/listings`, {}, token),
  },
  billing: {
    connections: {
      list: (token: string, params?: { provider?: string; companyId?: string }) => {
        const q = new URLSearchParams();
        if (params?.provider) q.set('provider', params.provider);
        if (params?.companyId) q.set('companyId', params.companyId);
        const qs = q.toString();
        return apiFetch<any[]>(`/billing/connections${qs ? '?' + qs : ''}`, {}, token);
      },
      create: (data: { provider: string; name: string; credentials: Record<string, string>; companyId?: string }, token: string) =>
        apiFetch<any>('/billing/connections', { method: 'POST', body: JSON.stringify(data) }, token),
      remove: (id: string, token: string) =>
        apiFetch<any>(`/billing/connections/${id}`, { method: 'DELETE' }, token),
      test: (id: string, token: string) =>
        apiFetch<{ success: boolean; message?: string }>(`/billing/connections/${id}/test`, { method: 'POST' }, token),
    },
    invoices: {
      list: (token: string, params?: { page?: number; dteType?: string; status?: string; from?: string; to?: string; connectionId?: string; companyId?: string }) => {
        const q = new URLSearchParams();
        if (params?.page) q.set('page', String(params.page));
        if (params?.dteType) q.set('dteType', params.dteType);
        if (params?.status) q.set('status', params.status);
        if (params?.from) q.set('from', params.from);
        if (params?.to) q.set('to', params.to);
        if (params?.connectionId) q.set('connectionId', params.connectionId);
        if (params?.companyId) q.set('companyId', params.companyId);
        return apiFetch<any>(`/billing/invoices?${q}`, {}, token);
      },
      issue: (data: any, token: string) =>
        apiFetch<any>('/billing/invoices', { method: 'POST', body: JSON.stringify(data) }, token),
      saveDraft: (data: any, token: string) =>
        apiFetch<any>('/billing/invoices/draft', { method: 'POST', body: JSON.stringify(data) }, token),
      issueDraft: (id: string, token: string, data?: { markPaid?: boolean; paymentMethod?: string; paymentReference?: string }) =>
        apiFetch<any>(`/billing/invoices/${id}/issue`, { method: 'POST', body: JSON.stringify(data ?? {}) }, token),
      updateDraft: (id: string, data: any, token: string) =>
        apiFetch<any>(`/billing/invoices/${id}`, { method: 'PATCH', body: JSON.stringify(data) }, token),
      get: (id: string, token: string) =>
        apiFetch<any>(`/billing/invoices/${id}`, {}, token),
      remove: (id: string, token: string) =>
        apiFetch<{ deleted: boolean }>(`/billing/invoices/${id}`, { method: 'DELETE' }, token),
      cancel: (id: string, token: string) =>
        apiFetch<any>(`/billing/invoices/${id}/cancel`, { method: 'POST' }, token),
      pay: (id: string, data: { paymentMethod: string; paymentReference?: string; paidAt?: string }, token: string) =>
        apiFetch<any>(`/billing/invoices/${id}/pay`, { method: 'POST', body: JSON.stringify(data) }, token),
      unpay: (id: string, token: string) =>
        apiFetch<any>(`/billing/invoices/${id}/unpay`, { method: 'POST' }, token),
    },
    profile: {
      get: (token: string, companyId?: string) =>
        apiFetch<any>(`/billing/profile${companyId ? `?companyId=${companyId}` : ''}`, {}, token),
      save: (data: any, token: string, companyId?: string) =>
        apiFetch<any>('/billing/profile', { method: 'PUT', body: JSON.stringify({ ...data, companyId }) }, token),
      uploadLogo: (file: File, token: string, companyId?: string) =>
        apiUpload<any>(`/billing/profile/logo${companyId ? `?companyId=${companyId}` : ''}`, file, token),
    },
  },
  orders: {
    list: (token: string, params?: { status?: string; warehouseId?: string; from?: string; to?: string; page?: number; companyId?: string }) => {
      const q = new URLSearchParams();
      if (params?.status) q.set('status', params.status);
      if (params?.warehouseId) q.set('warehouseId', params.warehouseId);
      if (params?.from) q.set('from', params.from);
      if (params?.to) q.set('to', params.to);
      if (params?.page) q.set('page', String(params.page));
      if (params?.companyId) q.set('companyId', params.companyId);
      return apiFetch<any>(`/orders?${q}`, {}, token);
    },
    get: (id: string, token: string) => apiFetch<any>(`/orders/${id}`, {}, token),
    create: (data: any, token: string) =>
      apiFetch<any>('/orders', { method: 'POST', body: JSON.stringify(data) }, token),
    update: (id: string, data: any, token: string) =>
      apiFetch<any>(`/orders/${id}`, { method: 'PATCH', body: JSON.stringify(data) }, token),
    updateStatus: (id: string, status: string, token: string) =>
      apiFetch<any>(`/orders/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }, token),
    checkItem: (orderId: string, itemId: string, data: { checkedQty: number; notes?: string }, token: string) =>
      apiFetch<any>(`/orders/${orderId}/items/${itemId}/check`, { method: 'PATCH', body: JSON.stringify(data) }, token),
    uncheckItem: (orderId: string, itemId: string, token: string) =>
      apiFetch<any>(`/orders/${orderId}/items/${itemId}/uncheck`, { method: 'PATCH' }, token),
    uploadPhoto: (orderId: string, file: File, token: string) =>
      apiUpload<any>(`/orders/${orderId}/photos`, file, token),
    deletePhoto: (orderId: string, photoId: string, token: string) =>
      apiFetch<any>(`/orders/${orderId}/photos/${photoId}`, { method: 'DELETE' }, token),
  },
  warehouses: {
    list: (token: string, companyId?: string) =>
      apiFetch<any[]>(`/warehouses${companyId ? `?companyId=${companyId}` : ''}`, {}, token),
    create: (data: { name: string; description?: string }, token: string) =>
      apiFetch<any>('/warehouses', { method: 'POST', body: JSON.stringify(data) }, token),
    update: (id: string, data: { name?: string; description?: string; active?: boolean }, token: string) =>
      apiFetch<any>(`/warehouses/${id}`, { method: 'PATCH', body: JSON.stringify(data) }, token),
    remove: (id: string, token: string) =>
      apiFetch<any>(`/warehouses/${id}`, { method: 'DELETE' }, token),
  },
  suppliers: {
    list: (token: string, companyId?: string) => {
      const q = new URLSearchParams();
      if (companyId) q.set('companyId', companyId);
      return apiFetch<any[]>(`/suppliers?${q}`, {}, token);
    },
    create: (data: { name: string; taxId?: string; email?: string; phone?: string; address?: string; companyId?: string }, token: string) =>
      apiFetch<any>('/suppliers', { method: 'POST', body: JSON.stringify(data) }, token),
    update: (id: string, data: { name?: string; taxId?: string; email?: string; phone?: string; address?: string; active?: boolean }, token: string) =>
      apiFetch<any>(`/suppliers/${id}`, { method: 'PATCH', body: JSON.stringify(data) }, token),
    remove: (id: string, token: string) =>
      apiFetch<any>(`/suppliers/${id}`, { method: 'DELETE' }, token),
  },
  purchases: {
    list: (token: string, params?: { companyId?: string; page?: number }) => {
      const q = new URLSearchParams();
      if (params?.companyId) q.set('companyId', params.companyId);
      if (params?.page) q.set('page', String(params.page));
      return apiFetch<{ purchases: any[]; total: number; page: number; pages: number }>(`/purchases?${q}`, {}, token);
    },
    get: (id: string, token: string) => apiFetch<any>(`/purchases/${id}`, {}, token),
    create: (data: {
      supplierId: string; warehouseId: string; documentNumber?: string; date?: string; notes?: string; companyId?: string;
      items: Array<{ productId: string; quantity: number; unitCost: number }>;
    }, token: string) =>
      apiFetch<any>('/purchases', { method: 'POST', body: JSON.stringify(data) }, token),
  },
  stockTransfers: {
    list: (token: string, params?: { companyId?: string; page?: number }) => {
      const q = new URLSearchParams();
      if (params?.companyId) q.set('companyId', params.companyId);
      if (params?.page) q.set('page', String(params.page));
      return apiFetch<{ transfers: any[]; total: number; page: number; pages: number }>(`/stock-transfers?${q}`, {}, token);
    },
    create: (data: { productId: string; fromWarehouseId: string; toWarehouseId: string; quantity: number; reason?: string; companyId?: string }, token: string) =>
      apiFetch<any>('/stock-transfers', { method: 'POST', body: JSON.stringify(data) }, token),
  },
  dispatch: {
    listRoutes: (token: string, params?: { status?: string; date?: string; dispatcherId?: string }) => {
      const q = new URLSearchParams();
      if (params?.status) q.set('status', params.status);
      if (params?.date) q.set('date', params.date);
      if (params?.dispatcherId) q.set('dispatcherId', params.dispatcherId);
      return apiFetch<any[]>(`/dispatch/routes?${q}`, {}, token);
    },
    getRoute: (id: string, token: string) => apiFetch<any>(`/dispatch/routes/${id}`, {}, token),
    createRoute: (data: any, token: string) =>
      apiFetch<any>('/dispatch/routes', { method: 'POST', body: JSON.stringify(data) }, token),
    updateRoute: (id: string, data: any, token: string) =>
      apiFetch<any>(`/dispatch/routes/${id}`, { method: 'PATCH', body: JSON.stringify(data) }, token),
    deleteRoute: (id: string, token: string) =>
      apiFetch<any>(`/dispatch/routes/${id}`, { method: 'DELETE' }, token),
    startRoute: (id: string, token: string) =>
      apiFetch<any>(`/dispatch/routes/${id}/start`, { method: 'PATCH' }, token),
    cancelRoute: (id: string, token: string) =>
      apiFetch<any>(`/dispatch/routes/${id}/cancel`, { method: 'PATCH' }, token),
    optimizeRoute: (id: string, token: string) =>
      apiFetch<any>(`/dispatch/routes/${id}/optimize`, { method: 'PATCH' }, token),
    availableOrders: (token: string) => apiFetch<any[]>('/dispatch/routes/available-orders', {}, token),
    addStop: (routeId: string, data: any, token: string) =>
      apiFetch<any>(`/dispatch/routes/${routeId}/stops`, { method: 'POST', body: JSON.stringify(data) }, token),
    removeStop: (routeId: string, stopId: string, token: string) =>
      apiFetch<any>(`/dispatch/routes/${routeId}/stops/${stopId}`, { method: 'DELETE' }, token),
    reorderStops: (routeId: string, positions: { stopId: string; position: number }[], token: string) =>
      apiFetch<any>(`/dispatch/routes/${routeId}/stops/reorder`, { method: 'PATCH', body: JSON.stringify({ positions }) }, token),
    deliverStop: (routeId: string, stopId: string, data: { notes?: string; lat?: number; lng?: number }, file: File | null, token: string) =>
      apiUploadForm<any>(`/dispatch/routes/${routeId}/stops/${stopId}/deliver`, {
        notes: data.notes,
        lat: data.lat != null ? String(data.lat) : undefined,
        lng: data.lng != null ? String(data.lng) : undefined,
      }, file, token, 'PATCH'),
  },
  settings: {
    list: (token: string) => apiFetch<any[]>('/settings', {}, token),
    update: (settings: { key: string; value: string }[], token: string) =>
      apiFetch<any>('/settings', { method: 'PATCH', body: JSON.stringify({ settings }) }, token),
    platforms: {
      list: (token: string) => apiFetch<any[]>('/settings/platforms', {}, token),
      update: (platform: string, data: { displayName?: string; description?: string; logoUrl?: string }, token: string) =>
        apiFetch<any>(`/settings/platforms/${platform}`, { method: 'PATCH', body: JSON.stringify(data) }, token),
    },
  },
  pos: {
    createSale: (data: any, token: string) =>
      apiFetch<any>('/pos/sales', { method: 'POST', body: JSON.stringify(data) }, token),
    listSales: (params: { companyId?: string; channel?: string; from?: string; to?: string; page?: number; search?: string }, token: string) => {
      const q = new URLSearchParams();
      if (params.companyId) q.set('companyId', params.companyId);
      if (params.channel) q.set('channel', params.channel);
      if (params.from) q.set('from', params.from);
      if (params.to) q.set('to', params.to);
      if (params.page) q.set('page', String(params.page));
      if (params.search) q.set('search', params.search);
      return apiFetch<{ sales: any[]; total: number; page: number; pages: number }>(`/pos/sales?${q}`, {}, token);
    },
    getSale: (id: string, token: string) => apiFetch<any>(`/pos/sales/${id}`, {}, token),
    deleteSale: (id: string, token: string) =>
      apiFetch<{ deleted: boolean }>(`/pos/sales/${id}`, { method: 'DELETE' }, token),
    bulkDeleteSales: (ids: string[], token: string) =>
      apiFetch<{ deleted: number; failed: { id: string; reason: string }[] }>(
        '/pos/sales/bulk-delete', { method: 'POST', body: JSON.stringify({ ids }) }, token),
    summary: (params: { companyId?: string; date?: string }, token: string) => {
      const q = new URLSearchParams();
      if (params.companyId) q.set('companyId', params.companyId);
      if (params.date) q.set('date', params.date);
      return apiFetch<any>(`/pos/sales/summary?${q}`, {}, token);
    },
    weeklySales: (token: string, params?: { companyId?: string; days?: number }) => {
      const q = new URLSearchParams();
      if (params?.companyId) q.set('companyId', params.companyId);
      if (params?.days) q.set('days', String(params.days));
      return apiFetch<any[]>(`/pos/sales/weekly?${q}`, {}, token);
    },
    stockMovements: (productId: string, token: string) =>
      apiFetch<any[]>(`/pos/stock/movements/${productId}`, {}, token),
    adjustStock: (data: { productId: string; quantity: number; reason?: string }, token: string) =>
      apiFetch<any>('/pos/stock/adjust', { method: 'POST', body: JSON.stringify(data) }, token),
    exportSales: (params: { companyId?: string; channel?: string; from?: string; to?: string }, token: string) => {
      const q = new URLSearchParams();
      if (params.companyId) q.set('companyId', params.companyId);
      if (params.channel) q.set('channel', params.channel);
      if (params.from) q.set('from', params.from);
      if (params.to) q.set('to', params.to);
      return apiDownload(`/pos/sales/export?${q}`, token, `ventas_${params.from || 'todas'}_${params.to || 'todas'}.csv`);
    },
  },
  clients: {
    list: (token: string, companyId?: string) => {
      const q = new URLSearchParams();
      if (companyId) q.set('companyId', companyId);
      return apiFetch<any[]>(`/clients?${q}`, {}, token);
    },
    debt: (id: string, token: string) => apiFetch<any>(`/clients/${id}/debt`, {}, token),
    history: (id: string, token: string) => apiFetch<any>(`/clients/${id}/history`, {}, token),
    create: (data: { name: string; rut?: string; giro?: string; email?: string; phone?: string; address?: string; commune?: string; city?: string; creditLimit?: number; companyId?: string }, token: string) =>
      apiFetch<any>('/clients', { method: 'POST', body: JSON.stringify(data) }, token),
    update: (id: string, data: { name?: string; rut?: string; giro?: string; email?: string; phone?: string; address?: string; commune?: string; city?: string; creditLimit?: number; active?: boolean }, token: string) =>
      apiFetch<any>(`/clients/${id}`, { method: 'PATCH', body: JSON.stringify(data) }, token),
    remove: (id: string, token: string) =>
      apiFetch<any>(`/clients/${id}`, { method: 'DELETE' }, token),
  },
  orderRequests: {
    create: (data: { clientId: string; scheduledDispatchDate?: string; notes?: string; companyId?: string; items: Array<{ productId: string; quantity: number }> }, token: string) =>
      apiFetch<any>('/order-requests', { method: 'POST', body: JSON.stringify(data) }, token),
    mine: (token: string, page?: number) => {
      const q = new URLSearchParams();
      if (page) q.set('page', String(page));
      return apiFetch<{ items: any[]; total: number; page: number; pages: number }>(`/order-requests/mine?${q}`, {}, token);
    },
    pending: (token: string, params?: { companyId?: string; page?: number }) => {
      const q = new URLSearchParams();
      if (params?.companyId) q.set('companyId', params.companyId);
      if (params?.page) q.set('page', String(params.page));
      return apiFetch<{ items: any[]; total: number; page: number; pages: number }>(`/order-requests/pending?${q}`, {}, token);
    },
    get: (id: string, token: string) => apiFetch<any>(`/order-requests/${id}`, {}, token),
    approve: (id: string, token: string) =>
      apiFetch<any>(`/order-requests/${id}/approve`, { method: 'PATCH' }, token),
    reject: (id: string, reason: string, token: string) =>
      apiFetch<any>(`/order-requests/${id}/reject`, { method: 'PATCH', body: JSON.stringify({ reason }) }, token),
    cancel: (id: string, token: string) =>
      apiFetch<any>(`/order-requests/${id}/cancel`, { method: 'PATCH' }, token),
  },
  profitability: {
    list: (token: string, companyId?: string) => {
      const q = new URLSearchParams();
      if (companyId) q.set('companyId', companyId);
      return apiFetch<any[]>(`/profitability?${q}`, {}, token);
    },
    create: (data: {
      name: string; cost: number; competitorName?: string; competitorPrice?: number; competitorUrl?: string;
      myDimensions?: string; competitorDimensions?: string; note?: string; companyId?: string;
    }, token: string) =>
      apiFetch<any>('/profitability', { method: 'POST', body: JSON.stringify(data) }, token),
    update: (id: string, data: {
      name?: string; cost?: number; competitorName?: string; competitorPrice?: number; competitorUrl?: string;
      myDimensions?: string; competitorDimensions?: string; note?: string; status?: string; myPrice?: number | null;
    }, token: string) =>
      apiFetch<any>(`/profitability/${id}`, { method: 'PATCH', body: JSON.stringify(data) }, token),
    remove: (id: string, token: string) =>
      apiFetch<any>(`/profitability/${id}`, { method: 'DELETE' }, token),
  },
  email: {
    getConfig: (token: string, companyId?: string) => {
      const q = companyId ? `?companyId=${companyId}` : '';
      return apiFetch<any>(`/email/config${q}`, {}, token);
    },
    saveConfig: (data: any, token: string, companyId?: string) => {
      const q = companyId ? `?companyId=${companyId}` : '';
      return apiFetch<any>(`/email/config${q}`, { method: 'PUT', body: JSON.stringify(data) }, token);
    },
    testEmail: (to: string, token: string, companyId?: string) => {
      const q = companyId ? `?companyId=${companyId}` : '';
      return apiFetch<any>(`/email/test${q}`, { method: 'POST', body: JSON.stringify({ to }) }, token);
    },
    getTemplates: (token: string, companyId?: string) => {
      const q = companyId ? `?companyId=${companyId}` : '';
      return apiFetch<any[]>(`/email/templates${q}`, {}, token);
    },
    saveTemplate: (type: string, data: { subject: string; bodyHtml: string; active: boolean }, token: string, companyId?: string) => {
      const q = companyId ? `?companyId=${companyId}` : '';
      return apiFetch<any>(`/email/templates/${type}${q}`, { method: 'PUT', body: JSON.stringify(data) }, token);
    },
    resetTemplate: (type: string, token: string, companyId?: string) => {
      const q = companyId ? `?companyId=${companyId}` : '';
      return apiFetch<any>(`/email/templates/${type}${q}`, { method: 'DELETE' }, token);
    },
  },
};
