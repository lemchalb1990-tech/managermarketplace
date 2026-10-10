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

export async function apiUpload<T>(
  path: string,
  file: File,
  token: string,
  onProgress?: (percent: number) => void,
): Promise<T> {
  const formData = new FormData();
  formData.append('file', file);
  if (onProgress) {
    // fetch no expone el avance de subida; con XHR sí.
    return new Promise<T>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${API_URL}/api${path}`);
      xhr.setRequestHeader('Authorization', `Bearer ${token}`);
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgress((e.loaded / e.total) * 100);
      };
      xhr.onerror = () => reject(new Error('Error de red al subir el archivo'));
      xhr.onload = () => {
        let body: any = null;
        try { body = JSON.parse(xhr.responseText); } catch { /* sin cuerpo JSON */ }
        if (xhr.status >= 200 && xhr.status < 300) resolve(body as T);
        else reject(new Error(body?.message || `Error ${xhr.status}`));
      };
      xhr.send(formData);
    });
  }
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

// Igual que apiDownload pero abre el archivo en una pestaña nueva (para imprimir o
// previsualizar) en vez de forzar la descarga — pensado para PDFs como la etiqueta de envío.
export async function apiOpenPdf(path: string, token: string): Promise<void> {
  const res = await fetch(`${API_URL}/api${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: 'Error desconocido' }));
    throw new Error(err.message || `Error ${res.status}`);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank', 'noopener,noreferrer');
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

// Abre un PDF que ya viene en base64 (respuesta de impresión masiva de etiquetas) en una
// pestaña nueva, igual que apiOpenPdf pero sin tener que volver a pedirlo al backend.
export function openBase64Pdf(base64: string): void {
  const bytes = atob(base64);
  const arr = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
  const blob = new Blob([arr], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank', 'noopener,noreferrer');
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export type ActivityFilters = { companyId?: string; userId?: string; from?: string; to?: string; module?: string; action?: string; automatic?: boolean };
export type ActivityItem = {
  id: string; createdAt: string; userId: string | null; actorName: string | null; automatic: boolean; origin: string;
  module: string; action: string; entity: string | null; entityLabel: string | null; summary: string;
  changes: { field: string; before: any; after: any }[] | null; ip: string | null; href: string | null;
};
function activityQuery(f: ActivityFilters & { page?: number }) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) if (v !== undefined && v !== '' && v !== null) q.set(k, String(v));
  return q.toString();
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

// Query string sin claves vacías (para filtros opcionales).
function toQuery(params: Record<string, string | number | boolean | undefined | null>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '' || v === false) continue;
    q.set(k, String(v));
  }
  return q.toString();
}

export type InventoryAvailabilityParams = {
  companyId?: string; warehouseId?: string; search?: string; category?: string;
  onlyStock?: boolean; belowCritical?: boolean; at?: string; page?: number; pageSize?: number;
};
export type InventoryWarehouseSummary = { id: string; name: string; active: boolean; units: number; skus: number; value: number; inTransitIn: number };
export type InventoryRow = {
  id: string; sku: string; name: string; category: string | null; cost: number | null; criticalStock: number;
  total: number; stock: Record<string, { quantity: number; reserved: number; available: number }>;
  inTransitIn: Record<string, number>; inTransit: number; value: number | null; belowCritical: boolean; mismatch: boolean;
};
export type InventoryAvailability = {
  warehouses: InventoryWarehouseSummary[]; categories: string[]; rows: InventoryRow[];
  total: number; page: number; pages: number; at: string | null;
};
export type InventoryMovementsParams = {
  companyId?: string; productId?: string; warehouseId?: string; search?: string; type?: string;
  document?: string; from?: string; to?: string; page?: number;
};
export type InventoryMovement = {
  id: string; createdAt: string; type: string; typeLabel: string; quantity: number; in: number; out: number;
  balanceAfter: number | null; reason: string | null; unitCost: number | null;
  referenceType: string | null; referenceId: string | null; documentNumber: string | null;
  product: { id: string; sku: string; name: string }; warehouse: { id: string; name: string } | null; user: { id: string; name: string } | null;
};
export type InventoryMovements = {
  items: InventoryMovement[]; total: number; page: number; pages: number;
  summary: { entries: number; exits: number; byType: Record<string, number> };
};
export type TransferStatus = 'DRAFT' | 'IN_TRANSIT' | 'RECEIVED' | 'RECEIVED_WITH_DIFF' | 'CANCELLED';
type UserRef = { id: string; name: string } | null;
export type TransferDocument = {
  id: string; number: number; documentNumber: string; status: TransferStatus; notes: string | null; cancelReason: string | null;
  createdAt: string; dispatchedAt: string | null; receivedAt: string | null; cancelledAt: string | null;
  fromWarehouse: { id: string; name: string }; toWarehouse: { id: string; name: string };
  createdBy: UserRef; dispatchedBy: UserRef; receivedBy: UserRef; cancelledBy: UserRef;
  lines: Array<{ id: string; quantity: number; receivedQuantity: number | null; unitCost: string | null; productId: string; product: { id: string; sku: string; name: string } }>;
};

export const api = {
  login: (email: string, password: string) =>
    apiFetch<{ access_token: string; user: any }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),
  me: (token: string) => apiFetch<any>('/auth/me', {}, token),
  public: {
    // Sin token: se usa también en el login y la landing, antes de iniciar sesión.
    platformLogos: () =>
      apiFetch<{ platform: string; displayName: string | null; description: string | null; logoUrl: string | null; logoScale?: number; logoScales?: Record<string, number> | null }[]>(
        '/public/platform-logos', {}),
    timezone: () => apiFetch<{ timezone: string }>('/public/timezone', {}),
    notificationSounds: () =>
      apiFetch<{ sale: string | null; question: string | null; claim: string | null }>('/public/notification-sounds', {}),
  },
  subscription: {
    usage: (token: string, companyId?: string) =>
      apiFetch<SubscriptionUsage>(`/subscription/usage${companyId ? `?companyId=${companyId}` : ''}`, {}, token),
    plans: {
      list: (token: string) => apiFetch<SubscriptionPlan[]>('/subscription/plans', {}, token),
      create: (data: Partial<SubscriptionPlan>, token: string) =>
        apiFetch<SubscriptionPlan>('/subscription/plans', { method: 'POST', body: JSON.stringify(data) }, token),
      update: (id: string, data: Partial<SubscriptionPlan>, token: string) =>
        apiFetch<SubscriptionPlan>(`/subscription/plans/${id}`, { method: 'PATCH', body: JSON.stringify(data) }, token),
      remove: (id: string, token: string) => apiFetch<any>(`/subscription/plans/${id}`, { method: 'DELETE' }, token),
    },
    assign: (companyId: string, planId: string | null, billing: 'MONTHLY' | 'ANNUAL' | null, token: string) =>
      apiFetch<SubscriptionUsage>(`/subscription/companies/${companyId}`, { method: 'PATCH', body: JSON.stringify({ planId, billing }) }, token),
  },
  ai: {
    providers: {
      list: (token: string) => apiFetch<AiProvidersOverview>('/ai/providers', {}, token),
      update: (id: string, data: { apiKey?: string; removeKey?: boolean; models?: Record<string, string>; tasks?: AiTask[]; extra?: Record<string, string> }, token: string) =>
        apiFetch<AiProvidersOverview>(`/ai/providers/${id}`, { method: 'PATCH', body: JSON.stringify(data) }, token),
      test: (id: string, token: string, apiKey?: string, extra?: Record<string, string>) =>
        apiFetch<{ ok: boolean; message: string }>(`/ai/providers/${id}/test`, { method: 'POST', body: JSON.stringify({ ...(apiKey ? { apiKey } : {}), ...(extra ? { extra } : {}) }) }, token),
    },
    updateCosts: (costs: Partial<Record<AiTask, number>>, token: string) =>
      apiFetch<Record<AiTask, number>>('/ai/costs', { method: 'PATCH', body: JSON.stringify(costs) }, token),
    usage: (token: string, companyId?: string) =>
      apiFetch<AiUsageReport>(`/ai/usage${companyId ? `?companyId=${companyId}` : ''}`, {}, token),
    credits: (token: string, companyId?: string) =>
      apiFetch<AiCreditsStatus>(`/ai/credits${companyId ? `?companyId=${companyId}` : ''}`, {}, token),
    plans: {
      list: (token: string) => apiFetch<AiPlan[]>('/ai/plans', {}, token),
      create: (data: Partial<AiPlan>, token: string) =>
        apiFetch<AiPlan>('/ai/plans', { method: 'POST', body: JSON.stringify(data) }, token),
      update: (id: string, data: Partial<AiPlan>, token: string) =>
        apiFetch<AiPlan>(`/ai/plans/${id}`, { method: 'PATCH', body: JSON.stringify(data) }, token),
      remove: (id: string, token: string) => apiFetch<any>(`/ai/plans/${id}`, { method: 'DELETE' }, token),
      reorder: (ids: string[], token: string) =>
        apiFetch<AiPlan[]>('/ai/plans/reorder', { method: 'POST', body: JSON.stringify({ ids }) }, token),
    },
    companies: (token: string) =>
      apiFetch<{ id: string; name: string; aiPlanId: string | null; usedToday: number; usedMonth: number; mlDiagnosedMonth: number }[]>('/ai/companies', {}, token),
    assignPlan: (companyId: string, aiPlanId: string | null, token: string) =>
      apiFetch<AiCreditsStatus>(`/ai/companies/${companyId}/plan`, { method: 'PATCH', body: JSON.stringify({ aiPlanId }) }, token),
  },
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
    cancelClosure: (id: string, token: string) =>
      apiFetch<{ restored: boolean; connectionsReactivated: number }>(`/companies/${id}/closure/cancel`, { method: 'POST' }, token),
    // Elimina la empresa y toda su información (definitivo).
    purge: (id: string, confirmName: string, token: string) =>
      apiFetch<{ jobId: string }>(`/companies/${id}/purge`, { method: 'POST', body: JSON.stringify({ confirmName }) }, token),
    purgeStatus: (jobId: string, token: string) =>
      apiFetch<{ percent: number; step: string; done: boolean; error: string | null; result: { rows: number; files: number } | null }>(`/companies/purge-jobs/${jobId}`, {}, token),
    // Respaldo ZIP de los datos de la empresa (Excel + documentos).
    backup: (id: string, name: string, token: string) =>
      apiDownload(`/company-account/export?companyId=${id}`, token, `respaldo-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.zip`),
  },
  companyAccount: {
    closureStatus: (token: string) => apiFetch<any>('/company-account/closure', {}, token),
    requestClosure: (data: { companyName: string; password: string; reason?: string }, token: string) =>
      apiFetch<{ scheduledFor: string }>('/company-account/closure', { method: 'POST', body: JSON.stringify(data) }, token),
  },
  users: {
    list: (token: string) => apiFetch<any[]>('/users', {}, token),
    create: (data: any, token: string) =>
      apiFetch<any>('/users', { method: 'POST', body: JSON.stringify(data) }, token),
    update: (id: string, data: any, token: string) =>
      apiFetch<any>(`/users/${id}`, { method: 'PATCH', body: JSON.stringify(data) }, token),
  },
  drivers: {
    fleet: (token: string) => apiFetch<any[]>('/drivers/fleet', {}, token),
    upsertProfile: (driverId: string, data: any, token: string) =>
      apiFetch<any>(`/drivers/fleet/${driverId}/profile`, { method: 'PATCH', body: JSON.stringify(data) }, token),
    setOutcome: (stopId: string, data: { outcome: string; notes?: string }, token: string) =>
      apiFetch<any>(`/drivers/stops/${stopId}/outcome`, { method: 'PATCH', body: JSON.stringify(data) }, token),
    metrics: (token: string, params?: { from?: string; to?: string; driverId?: string }) => {
      const p = new URLSearchParams(params as any);
      return apiFetch<any>(`/drivers/metrics?${p}`, {}, token);
    },
    paymentsSummary: (token: string, params?: { from?: string; to?: string }) => {
      const p = new URLSearchParams(params as any);
      return apiFetch<any[]>(`/drivers/payments/summary?${p}`, {}, token);
    },
    createPaymentBatch: (data: { driverId: string; stopIds: string[]; notes?: string }, token: string) =>
      apiFetch<any>('/drivers/payments/batch', { method: 'POST', body: JSON.stringify(data) }, token),
    listPaymentBatches: (token: string, params?: { driverId?: string }) => {
      const p = new URLSearchParams(params as any);
      return apiFetch<any[]>(`/drivers/payments/batches?${p}`, {}, token);
    },
    markPaid: (id: string, token: string) =>
      apiFetch<any>(`/drivers/payments/batches/${id}/paid`, { method: 'PATCH' }, token),
    zones: (token: string, params?: { from?: string; to?: string }) => {
      const p = new URLSearchParams(params as any);
      return apiFetch<any>(`/drivers/zones?${p}`, {}, token);
    },
  },
  returns: {
    list: (token: string, params?: { status?: string; q?: string; companyId?: string }) => {
      const p = new URLSearchParams();
      if (params?.status) p.set('status', params.status);
      if (params?.q) p.set('q', params.q);
      if (params?.companyId) p.set('companyId', params.companyId);
      return apiFetch<{ returns: any[]; counts: { pending: number; received: number } }>(`/returns?${p}`, {}, token);
    },
    get: (id: string, token: string) => apiFetch<any>(`/returns/${id}`, {}, token),
    create: (data: any, token: string) =>
      apiFetch<any>('/returns', { method: 'POST', body: JSON.stringify(data) }, token),
    scan: (code: string, token: string) =>
      apiFetch<any>('/returns/scan', { method: 'POST', body: JSON.stringify({ code }) }, token),
    receive: (id: string, data: { condition: string; notes?: string; restockItemIds?: string[] }, token: string) =>
      apiFetch<any>(`/returns/${id}/receive`, { method: 'POST', body: JSON.stringify(data) }, token),
    undo: (id: string, token: string) =>
      apiFetch<any>(`/returns/${id}/undo`, { method: 'POST' }, token),
  },
  warehouse: {
    board: (token: string, warehouseId?: string, companyId?: string) => {
      const q = new URLSearchParams();
      if (warehouseId) q.set('warehouseId', warehouseId);
      if (companyId) q.set('companyId', companyId);
      return apiFetch<any>(`/warehouse/board?${q}`, {}, token);
    },
    assign: (data: { userIds: string[]; orderIds?: string[]; warehouseId?: string; companyId?: string }, token: string) =>
      apiFetch<{ assigned: number }>('/warehouse/assign', { method: 'POST', body: JSON.stringify(data) }, token),
    resetAssign: (data: { warehouseId?: string; companyId?: string }, token: string) =>
      apiFetch<{ reverted: number }>('/warehouse/assign/reset', { method: 'POST', body: JSON.stringify(data) }, token),
    pickingList: (token: string, params?: { warehouseId?: string; mine?: boolean; companyId?: string }) => {
      const q = new URLSearchParams();
      if (params?.warehouseId) q.set('warehouseId', params.warehouseId);
      if (params?.mine) q.set('mine', 'true');
      if (params?.companyId) q.set('companyId', params.companyId);
      return apiFetch<any[]>(`/warehouse/picking?${q}`, {}, token);
    },
    pickingScan: (data: { code: string; warehouseId?: string }, token: string) =>
      apiFetch<any>('/warehouse/picking/scan', { method: 'POST', body: JSON.stringify(data) }, token),
    pickItem: (orderId: string, itemId: string, data: { pickedQty: number; notes?: string }, token: string) =>
      apiFetch<any>(`/warehouse/picking/${orderId}/item/${itemId}`, { method: 'PATCH', body: JSON.stringify(data) }, token),
    outOfStock: (orderId: string, itemId: string, data: { outOfStock: boolean; notes?: string }, token: string) =>
      apiFetch<any>(`/warehouse/picking/${orderId}/item/${itemId}/out-of-stock`, { method: 'PATCH', body: JSON.stringify(data) }, token),
    completePicking: (orderId: string, token: string) =>
      apiFetch<any>(`/warehouse/picking/${orderId}/complete`, { method: 'POST' }, token),
    packingList: (token: string, params?: { warehouseId?: string; companyId?: string }) => {
      const q = new URLSearchParams();
      if (params?.warehouseId) q.set('warehouseId', params.warehouseId);
      if (params?.companyId) q.set('companyId', params.companyId);
      return apiFetch<any[]>(`/warehouse/packing?${q}`, {}, token);
    },
    packingScan: (data: { code: string; warehouseId?: string }, token: string) =>
      apiFetch<any>('/warehouse/packing/scan', { method: 'POST', body: JSON.stringify(data) }, token),
    confirmPacked: (orderId: string, token: string) =>
      apiFetch<any>(`/warehouse/packing/${orderId}/confirm`, { method: 'POST' }, token),
  },
  accessProfiles: {
    catalog: (token: string) =>
      apiFetch<{ key: string; label: string; items: { key: string; label: string }[] }[]>(
        '/access-profiles/catalog', {}, token),
    list: (token: string, companyId?: string) =>
      apiFetch<any[]>(`/access-profiles${companyId ? `?companyId=${companyId}` : ''}`, {}, token),
    get: (id: string, token: string) => apiFetch<any>(`/access-profiles/${id}`, {}, token),
    create: (data: { name: string; permissions: string[]; companyId?: string }, token: string) =>
      apiFetch<any>('/access-profiles', { method: 'POST', body: JSON.stringify(data) }, token),
    update: (id: string, data: { name?: string; permissions?: string[] }, token: string) =>
      apiFetch<any>(`/access-profiles/${id}`, { method: 'PATCH', body: JSON.stringify(data) }, token),
    remove: (id: string, token: string) =>
      apiFetch<{ deleted: boolean }>(`/access-profiles/${id}`, { method: 'DELETE' }, token),
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
    search: (params: { page?: number; search?: string; warehouseId?: string; category?: string; type?: string; active?: string; listingStatus?: string; channel?: string; companyId?: string; inStock?: boolean; stockFilter?: string; pageSize?: number; sortBy?: string; sortDir?: 'asc' | 'desc' }, token: string) => {
      const q = new URLSearchParams();
      if (params.page) q.set('page', String(params.page));
      if (params.search) q.set('search', params.search);
      if (params.warehouseId) q.set('warehouseId', params.warehouseId);
      if (params.category) q.set('category', params.category);
      if (params.type) q.set('type', params.type);
      if (params.active) q.set('active', params.active);
      if (params.listingStatus) q.set('listingStatus', params.listingStatus);
      if (params.channel) q.set('channel', params.channel);
      if (params.companyId) q.set('companyId', params.companyId);
      if (params.inStock) q.set('inStock', 'true');
      if (params.stockFilter) q.set('stockFilter', params.stockFilter);
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
    // listingId: una publicación puntual (adicional de la misma cuenta); si no, la principal.
    deleteListing: (productId: string, connectionId: string, token: string, listingId?: string) =>
      apiFetch<{ deleted: boolean }>(
        `/catalog/products/${productId}/listings/${connectionId}${listingId ? `?listingId=${listingId}` : ''}`, { method: 'DELETE' }, token),
    downloadBulkTemplate: (token: string, companyId?: string) =>
      apiDownload(
        `/catalog/products/bulk/import-template${companyId ? `?companyId=${companyId}` : ''}`,
        token, 'plantilla-stock-precios.xlsx',
      ),
    // "Precio de Venta {canal}" — mismo endpoint que ya existe para Producto Maestro
    // (product-masters), opera directo sobre productId sin exigir que tenga maestro.
    setChannelPrice: (productId: string, connectionId: string, price: number, token: string) =>
      apiFetch<any>(`/product-masters/products/${productId}/channel-price`, { method: 'POST', body: JSON.stringify({ connectionId, price }) }, token),
    removeChannelPrice: (productId: string, connectionId: string, token: string) =>
      apiFetch<any>(`/product-masters/products/${productId}/channel-price/${connectionId}`, { method: 'DELETE' }, token),
    bulkImport: (file: File, token: string, companyId?: string, onProgress?: (percent: number) => void) =>
      apiUpload<{ updated: number; skipped: number; errors: { row: number; sku: string; reason: string }[] }>(
        `/catalog/products/bulk/import${companyId ? `?companyId=${companyId}` : ''}`, file, token, onProgress),
    criticalStock: (token: string, companyId?: string, limit = 6) =>
      apiFetch<{ total: number; items: { id: string; name: string; sku: string; stock: number; criticalStock: number; images: { url: string; isPrimary: boolean }[] }[] }>(
        `/catalog/products/critical-stock?limit=${limit}${companyId ? `&companyId=${companyId}` : ''}`, {}, token),
    resolveCodes: (codes: string[], token: string, companyId?: string) =>
      apiFetch<{ results: { code: string; products: { id: string; sku: string; name: string; stock: number; listings: { externalId: string | null; connection: { name: string } }[] }[] }[]; notFound: string[] }>(
        '/catalog/products/bulk/resolve-codes', { method: 'POST', body: JSON.stringify({ codes, ...(companyId ? { companyId } : {}) }) }, token),
    mergePreview: (ids: string[], token: string) =>
      apiFetch<{ products: any[]; connectionConflicts: { connectionId: string; connectionName: string; products: { id: string; name: string }[] }[] }>(
        '/catalog/products/bulk/merge-preview', { method: 'POST', body: JSON.stringify({ ids }) }, token),
    merge: (dto: {
      productIds: string[];
      survivorId: string;
      fieldSources: Record<string, string>;
      imagesFromProductId?: string | null;
      dropshipFromProductId?: string | null;
      stockOverride?: number;
    }, token: string) =>
      apiFetch<any>('/catalog/products/bulk/merge', { method: 'POST', body: JSON.stringify(dto) }, token),
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
    searchCategories: (q: string, token: string, type?: string) =>
      apiFetch<{ id: string; name: string }[]>(
        `/ecommerce/ml/categories/search?q=${encodeURIComponent(q)}${type ? `&type=${type}` : ''}`, {}, token),
    browseCategories: (id: string | undefined, token: string) =>
      apiFetch<{ id: string | null; name: string | null; path: { id: string; name: string }[]; children: { id: string; name: string }[]; isLeaf: boolean }>(
        `/ecommerce/ml/categories/browse${id ? `?id=${encodeURIComponent(id)}` : ''}`, {}, token),
    getCategoryAttributes: (categoryId: string, token: string) =>
      apiFetch<{ attributes: any[]; supportsHtml: boolean }>(
        `/ecommerce/ml/categories/${categoryId}/attributes`, {}, token),
    connections: (token: string, companyId?: string) =>
      apiFetch<any[]>(`/ecommerce/ml/connections${companyId ? `?companyId=${companyId}` : ''}`, {}, token),
    deleteConnection: (id: string, token: string) =>
      apiFetch<any>(`/ecommerce/ml/connections/${id}`, { method: 'DELETE' }, token),
    updateConnection: (id: string, data: { name?: string; mlClientId?: string; mlClientSecret?: string }, token: string) =>
      apiFetch<any>(`/ecommerce/ml/connections/${id}`, { method: 'PATCH', body: JSON.stringify(data) }, token),
    refreshConnection: (id: string, token: string) =>
      apiFetch<{ id: string; name: string; active: boolean; expiresAt: string | null }>(
        `/ecommerce/ml/connections/${id}/refresh`, { method: 'POST' }, token),
    debugOrder: (connectionId: string, orderId: string, token: string) =>
      apiFetch<any>(`/ecommerce/ml/connections/${connectionId}/debug-order/${orderId}`, {}, token),
    // withDetail: "etiqueta con detalle" (la etiqueta + una página con los productos del pedido).
    printLabel: (orderId: string, token: string, withDetail = false) =>
      apiOpenPdf(`/ecommerce/ml/orders/${orderId}/label${withDetail ? '?detail=1' : ''}`, token),
    // Vuelve a leer la venta en ML y SOBRESCRIBE sus datos y los de su orden (o la recrea).
    reimportSale: (saleId: string, token: string) =>
      apiFetch<{
        saleId: string; orderId: string | null; orderRecreated: boolean; storeChangedTo: string | null; toAgree: boolean;
        before: { customerName: string | null; total: number; netAmount: number | null };
        after: { customerName: string | null; total: number; netAmount: number };
        itemsMatch: boolean; itemsWarning: string | null;
      }>(`/ecommerce/ml/sales/${saleId}/reimport`, { method: 'POST' }, token),
    refreshOrder: (orderId: string, token: string) =>
      apiFetch<any>(`/ecommerce/ml/orders/${orderId}/refresh`, { method: 'POST' }, token),
    printLabelsBulk: (orderIds: string[], token: string, withDetail = false) =>
      apiFetch<{
        pdfs: { connectionName: string; base64: string }[];
        printed: string[];
        errors: { orderId: string; message: string }[];
      }>('/ecommerce/ml/orders/print-labels-bulk', { method: 'POST', body: JSON.stringify({ orderIds, withDetail }) }, token),
    publish: (productId: string, connectionId: string, token: string, saleTerms?: { id: string; value_id?: string; value_name?: string }[], title?: string, imageIds?: string[] | null) =>
      apiFetch<any>(`/ecommerce/ml/products/${productId}/publish/${connectionId}`, {
        method: 'POST',
        body: JSON.stringify({
          ...(saleTerms?.length ? { saleTerms } : {}),
          ...(title?.trim() ? { title: title.trim() } : {}),
          ...(Array.isArray(imageIds) ? { imageIds } : {}),
        }),
      }, token),
    // Revisión de fotos antes de publicar: diagnóstico de ML + IA (créditos del plan).
    photoCheck: (productId: string, connectionId: string, token: string, opts: { title?: string; useAi?: boolean; imageIds?: string[] } = {}) =>
      apiFetch<PhotoCheckResult>(`/ecommerce/ml/products/${productId}/photo-check/${connectionId}`, {
        method: 'POST', body: JSON.stringify(opts),
      }, token),
    photoFix: (productId: string, imageId: string, token: string, title?: string) =>
      apiFetch<{ url: string; credits: AiCreditsStatus }>(`/ecommerce/ml/products/${productId}/images/${imageId}/ai-fix`, {
        method: 'POST', body: JSON.stringify(title ? { title } : {}),
      }, token),
    photoGenerate: (productId: string, token: string, opts: { connectionId?: string; title?: string } = {}) =>
      apiFetch<{ url: string; credits: AiCreditsStatus }>(`/ecommerce/ml/products/${productId}/ai-generate`, {
        method: 'POST', body: JSON.stringify(opts),
      }, token),
    photoGenerateAdd: (productId: string, url: string, token: string) =>
      apiFetch<any>(`/ecommerce/ml/products/${productId}/ai-generate/add`, {
        method: 'POST', body: JSON.stringify({ url }),
      }, token),
    photoFixApply: (productId: string, imageId: string, url: string, token: string) =>
      apiFetch<any>(`/ecommerce/ml/products/${productId}/images/${imageId}/ai-fix/apply`, {
        method: 'POST', body: JSON.stringify({ url }),
      }, token),
    getSaleTerms: (connectionId: string, categoryId: string, token: string) =>
      apiFetch<{ id: string; name: string; valueType: string; required: boolean; values: { id: string; name: string }[] }[]>(
        `/ecommerce/ml/connections/${connectionId}/categories/${categoryId}/sale-terms`, {}, token),
    sync: (productId: string, connectionId: string, token: string, listingId?: string) =>
      apiFetch<any>(`/ecommerce/ml/products/${productId}/sync/${connectionId}${listingId ? `?listingId=${listingId}` : ''}`, { method: 'POST' }, token),
    pullFromMl: (productId: string, connectionId: string, token: string) =>
      apiFetch<any>(`/ecommerce/ml/products/${productId}/pull/${connectionId}`, { method: 'POST' }, token),
    syncAll: (productId: string, token: string) =>
      apiFetch<{
        syncedCount: number; failedCount: number;
        results: Array<{ connectionId: string; connectionName: string; success: boolean; warnings: string[]; error: string | null }>;
      }>(`/ecommerce/ml/products/${productId}/sync-all`, { method: 'POST' }, token),
    toggleListing: (productId: string, connectionId: string, token: string, listingId?: string) =>
      apiFetch<any>(`/ecommerce/ml/products/${productId}/toggle/${connectionId}${listingId ? `?listingId=${listingId}` : ''}`, { method: 'PATCH' }, token),
    previewImport: (connectionId: string, scrollId: string | null, token: string) =>
      apiFetch<{
        connectionName: string;
        // Ya importadas en OTRA tienda de ML de la empresa (no se vuelven a importar).
        alreadyImportedElsewhere?: { store: string; count: number }[];
        total: number;
        hasMore: boolean;
        nextScrollId: string | null;
        alreadyImportedCount: number;
        items: Array<{
          externalId: string; title: string; price: number; stock: number;
          thumbnail: string | null; permalink: string; status: string; sku: string | null;
          skuSuspicious?: boolean;
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
          importable: boolean; alreadyRegistered: boolean;
          items: Array<{ title: string; quantity: number; unitPrice: number; resolved: boolean; productName: string | null }>;
          charges: { shippingCost: number; marketplaceFee: number; taxes: number; coupon: number; totalPaid: number };
        }>;
      }>(`/ecommerce/ml/connections/${connectionId}/sales-import/preview?${q}`, {}, token);
    },
    confirmSalesImport: (connectionId: string, externalIds: string[], token: string, createDispatchOrder?: boolean) =>
      apiFetch<{ imported: number; skipped: number; errors: string[] }>(
        `/ecommerce/ml/connections/${connectionId}/sales-import/confirm`,
        { method: 'POST', body: JSON.stringify({ externalIds, createDispatchOrder }) },
        token,
      ),
    questions: (token: string, status?: string, companyId?: string) => {
      const q = new URLSearchParams();
      if (status) q.set('status', status);
      if (companyId) q.set('companyId', companyId);
      return apiFetch<{ questions: any[]; unanswered: number }>(`/ecommerce/ml/questions?${q}`, {}, token);
    },
    answerQuestion: (externalId: string, text: string, token: string) =>
      apiFetch<any>(`/ecommerce/ml/questions/${externalId}/answer`, { method: 'POST', body: JSON.stringify({ text }) }, token),
    syncQuestions: (connectionId: string, token: string) =>
      apiFetch<{ synced: number }>(`/ecommerce/ml/connections/${connectionId}/questions/sync`, { method: 'POST' }, token),
    claims: (token: string, status?: string, companyId?: string) => {
      const q = new URLSearchParams();
      if (status) q.set('status', status);
      if (companyId) q.set('companyId', companyId);
      return apiFetch<{ claims: any[]; opened: number }>(`/ecommerce/ml/claims?${q}`, {}, token);
    },
    claimDetail: (externalId: string, token: string) =>
      apiFetch<{
        claim: any; detail: any; messages: any; availableActions: { action: string; due_date?: string | null; mandatory?: boolean }[];
        hasMediator: boolean; reputation: any; expectedResolutions: any; returns: any;
      }>(`/ecommerce/ml/claims/${externalId}`, {}, token),
    sendClaimMessage: (externalId: string, text: string, token: string, receiverRole: 'complainant' | 'mediator' = 'complainant', attachments: string[] = []) =>
      apiFetch<any>(`/ecommerce/ml/claims/${externalId}/messages`, { method: 'POST', body: JSON.stringify({ text, receiverRole, attachments }) }, token),
    uploadClaimAttachment: (externalId: string, file: File, token: string) =>
      apiUpload<{ fileName: string; originalName: string }>(`/ecommerce/ml/claims/${externalId}/attachments`, file, token),
    openClaimAttachment: (externalId: string, fileName: string, token: string) =>
      apiOpenPdf(`/ecommerce/ml/claims/${externalId}/attachments/${encodeURIComponent(fileName)}`, token),
    takeClaimAction: (externalId: string, action: string, token: string, extra?: Record<string, any>) =>
      apiFetch<any>(`/ecommerce/ml/claims/${externalId}/actions`, { method: 'POST', body: JSON.stringify({ action, extra }) }, token),
    syncClaims: (connectionId: string, token: string) =>
      apiFetch<{ synced: number }>(`/ecommerce/ml/connections/${connectionId}/claims/sync`, { method: 'POST' }, token),
    connectionsForTransfer: (token: string, companyId?: string) =>
      apiFetch<{ id: string; name: string; active: boolean; authorized: boolean; mlNickname: string | null;
        counts: { sales: number; listings: number; mlQuestions: number; mlClaims: number } }[]>(
        `/ecommerce/ml/connections-for-transfer${companyId ? `?companyId=${companyId}` : ''}`, {}, token),
    transferConnectionData: (fromId: string, toId: string, apply: boolean, token: string) =>
      apiFetch<{
        from: string; to: string; toAccount: string | null; applied: boolean;
        sales: { total: number; move: number; notVerified: string[] };
        listings: { total: number; move: number; alreadyInDestination: number; conflicts: string[]; notFromThisAccount: number };
        questions: { total: number; move: number };
        claims: { total: number; move: number };
      }>(`/ecommerce/ml/connections/${fromId}/transfer-to/${toId}`, { method: 'POST', body: JSON.stringify({ apply }) }, token),
    recalculatePackAmounts: (body: { companyId?: string; apply?: boolean }, token: string) =>
      apiFetch<{
        checked: number; affected: number; applied: boolean;
        sales: {
          saleId: string; orderId: string | null; mlOrderId: string | null; packId: string | null; fixed: boolean; error?: string;
          before: { total: number; fee: number | null; shipping: number | null; net: number | null };
          after?: { total: number; fee: number; shipping: number; net: number };
        }[];
      }>('/ecommerce/ml/sales/recalculate-pack-amounts', { method: 'POST', body: JSON.stringify(body) }, token),
    appSetup: (token: string) =>
      apiFetch<{ redirectUri: string | null; notificationsUrl: string | null; topics: { id: string; label: string }[] }>('/ecommerce/ml/app-setup', {}, token),
    reviewDuplicateListings: (body: { companyId?: string; apply?: boolean; limit?: number }, token: string) =>
      apiFetch<{
        applied: boolean; groups: number; linksToRemove: number; manual: number; orphanProducts: number;
        sample: { externalId: string; keep: { store: string; sku: string } | null; remove: { store: string; sku: string }[]; reason?: string }[];
        processed: number; linksRemoved: number; productsMerged: number; mergeErrors: string[]; remaining: number;
      }>('/ecommerce/ml/duplicate-listings', { method: 'POST', body: JSON.stringify(body) }, token),
    accountInfo: (productId: string, token: string) =>
      apiFetch<{ listingId: string; slot: number; connectionId: string; mlTitle: string; mlPrice: number; sold: number }[]>(`/ecommerce/ml/products/${productId}/account-info`, {}, token),
    recoverAccountData: (body: { companyId?: string; apply?: boolean }, token: string) =>
      apiFetch<{
        applied: boolean; checked: number; affected: number; errors: string[];
        changes: { productId: string; sku: string; name: string; connection: string; connectionId: string; externalId: string; sold: number;
          mlTitle: string; mlPrice: number; priceBefore: number; priceAfter: number; priceOwn: boolean; titleBefore: string; titleOwn: boolean; changed: boolean }[];
      }>('/ecommerce/ml/account-data/recover', { method: 'POST', body: JSON.stringify(body) }, token),
    // Precio base de ML y precio de cada cuenta (null = usa el base); se envía a las publicaciones.
    setAccountPrices: (productId: string, body: { basePrice?: number | null; accounts: { connectionId: string; price: number | null; title?: string | null }[]; publications?: { listingId: string; price: number | null; title?: string | null }[] }, token: string) =>
      apiFetch<{ basePrice: number | null; pushed: { connection: string; price: number; ok: boolean; error?: string }[]; titles?: { connection: string; ok: boolean; error?: string }[] }>(
        `/ecommerce/ml/products/${productId}/account-prices`, { method: 'PUT', body: JSON.stringify(body) }, token),
    repairPackDuplicates: (body: { companyId?: string; apply?: boolean; saleIds?: string[] }, token: string) =>
      apiFetch<{
        checked: number; affected: number; applied: boolean;
        sales: {
          saleId: string; orderId: string | null; mlOrderId: string | null; packId: string | null;
          totalBefore: number; totalAfter?: number; fixed: boolean; error?: string;
          products: { productId: string; name: string; sku: string; registered: number; real: number; extraLines: number; stockToReturn: number }[];
        }[];
      }>('/ecommerce/ml/sales/repair-pack-duplicates', { method: 'POST', body: JSON.stringify(body) }, token),
    syncOrderStatuses: (connectionId: string, token: string) =>
      apiFetch<{ checked: number; updated: number }>(`/ecommerce/ml/connections/${connectionId}/orders/sync`, { method: 'POST' }, token),
    reputation: (connectionId: string, token: string) =>
      apiFetch<any>(`/ecommerce/ml/connections/${connectionId}/reputation`, {}, token),
    feedback: (token: string, companyId?: string) =>
      apiFetch<any[]>(`/ecommerce/ml/feedback${companyId ? `?companyId=${companyId}` : ''}`, {}, token),
    notifications: (token: string, since: string, companyId?: string) => {
      const q = new URLSearchParams({ since });
      if (companyId) q.set('companyId', companyId);
      return apiFetch<{
        events: Array<{
          type: 'sale' | 'question' | 'claim' | 'alert'; id: string; title: string;
          channel: string; connectionName: string | null; productName: string | null; orderRef: string | null;
          createdAt: string; href: string;
        }>;
        serverTime: string;
      }>(`/ecommerce/ml/notifications?${q}`, {}, token);
    },
  },
  // Historial de actividad de la empresa (solo lectura).
  activity: {
    list: (token: string, f: ActivityFilters & { page?: number }) =>
      apiFetch<{ items: ActivityItem[]; total: number; page: number; pages: number }>(`/activity?${activityQuery(f)}`, {}, token),
    filters: (token: string, companyId?: string) =>
      apiFetch<{ users: { id: string; name: string; email: string }[]; modules: string[]; actions: { id: string; label: string }[] }>(
        `/activity/filters${companyId ? `?companyId=${companyId}` : ''}`, {}, token),
    export: (token: string, f: ActivityFilters) => apiDownload(`/activity/export?${activityQuery(f)}`, token, 'historial-actividad.xlsx'),
  },
  connections: {
    // Etiqueta de despacho de una orden de JumpSeller (PDF), igual que la de Mercado Libre.
    printLabel: (orderId: string, token: string, withDetail = false) =>
      apiOpenPdf(`/ecommerce/connections/orders/${orderId}/label${withDetail ? '?detail=1' : ''}`, token),
    // Largo máximo del nombre por marketplace (Mercado Libre según la categoría).
    titleLimits: (token: string, mlCategoryId?: string) =>
      apiFetch<Record<string, { max: number | null; source: string }>>(
        `/ecommerce/connections/title-limits${mlCategoryId ? `?mlCategoryId=${encodeURIComponent(mlCategoryId)}` : ''}`, {}, token),
    // Check "Sincronizar" de la tienda (también conexiones de Mercado Libre).
    setSync: (id: string, enabled: boolean, token: string) =>
      apiFetch<{ id: string; syncEnabled: boolean }>(`/ecommerce/connections/${id}/sync`, { method: 'PATCH', body: JSON.stringify({ enabled }) }, token),
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
    get: (id: string, token: string) =>
      apiFetch<any>(`/ecommerce/connections/${id}`, {}, token),
    update: (id: string, data: { name?: string; credentials?: Record<string, string> }, token: string) =>
      apiFetch<any>(`/ecommerce/connections/${id}`, { method: 'PATCH', body: JSON.stringify(data) }, token),
    test: (id: string, token: string) =>
      apiFetch<{ success: boolean; message?: string }>(`/ecommerce/connections/${id}/test`, { method: 'POST' }, token),
    setInvoicePush: (id: string, enabled: boolean, token: string) =>
      apiFetch<{ id: string; sendInvoiceToPlatform: boolean }>(
        `/ecommerce/connections/${id}/invoice-push`, { method: 'PATCH', body: JSON.stringify({ enabled }) }, token),
    publish: (connectionId: string, productId: string, token: string) =>
      apiFetch<any>(`/ecommerce/connections/${connectionId}/products/${productId}/publish`, { method: 'POST' }, token),
    // listingId: una publicación puntual (adicional de la misma cuenta); si no, la principal.
    sync: (connectionId: string, productId: string, token: string, listingId?: string) =>
      apiFetch<any>(`/ecommerce/connections/${connectionId}/products/${productId}/sync${listingId ? `?listingId=${listingId}` : ''}`, { method: 'POST' }, token),
    toggle: (connectionId: string, productId: string, token: string, listingId?: string) =>
      apiFetch<any>(`/ecommerce/connections/${connectionId}/products/${productId}/toggle${listingId ? `?listingId=${listingId}` : ''}`, { method: 'PATCH' }, token),
    // Borra la publicación EN LA TIENDA y su vínculo (canales que lo permiten, p. ej. JumpSeller).
    deleteRemote: (connectionId: string, productId: string, token: string, listingId?: string) =>
      apiFetch<{ deleted: boolean }>(`/ecommerce/connections/${connectionId}/products/${productId}/remote${listingId ? `?listingId=${listingId}` : ''}`, { method: 'DELETE' }, token),
    setListingPrice: (listingId: string, price: number | null, token: string) =>
      apiFetch<any>(`/ecommerce/connections/listings/${listingId}/price`, { method: 'PATCH', body: JSON.stringify({ price }) }, token),
    link: (connectionId: string, productId: string, data: { externalId: string; externalUrl?: string }, token: string) =>
      apiFetch<any>(`/ecommerce/connections/${connectionId}/products/${productId}/link`, { method: 'POST', body: JSON.stringify(data) }, token),
    productListings: (productId: string, token: string) =>
      apiFetch<any[]>(`/ecommerce/connections/products/${productId}/listings`, {}, token),
    paris: {
      families: (connectionId: string, q: string | undefined, token: string) =>
        apiFetch<{ id: string; name: string; allowVariant: boolean }[]>(
          `/ecommerce/connections/${connectionId}/paris/families${q ? `?q=${encodeURIComponent(q)}` : ''}`, {}, token),
      categories: (connectionId: string, familyId: string, token: string) =>
        apiFetch<{ id: string; name: string; path: string }[]>(
          `/ecommerce/connections/${connectionId}/paris/categories/${familyId}`, {}, token),
      attributes: (connectionId: string, familyId: string, token: string) =>
        apiFetch<{ id: string; name: string; scope: 'PRODUCT' | 'VARIANT'; dataType: string; required: boolean; options: { id: string; name: string }[] }[]>(
          `/ecommerce/connections/${connectionId}/paris/attributes/${familyId}`, {}, token),
      attributeOptions: (connectionId: string, attributeId: string, q: string | undefined, token: string) =>
        apiFetch<{ id: string; name: string }[]>(
          `/ecommerce/connections/${connectionId}/paris/attribute-options/${attributeId}${q ? `?q=${encodeURIComponent(q)}` : ''}`, {}, token),
      storePrices: (connectionId: string, token: string) =>
        apiFetch<{ id: string; name: string; channelName: string }[]>(
          `/ecommerce/connections/${connectionId}/paris/store-prices`, {}, token),
    },
    ripley: {
      hierarchies: (connectionId: string, token: string) =>
        apiFetch<{ code: string; label: string; parentCode: string; level: number }[]>(
          `/ecommerce/connections/${connectionId}/ripley/hierarchies`, {}, token),
    },
    falabella: {
      categories: (connectionId: string, token: string) =>
        apiFetch<{ id: string; name: string; isLeaf: boolean }[]>(
          `/ecommerce/connections/${connectionId}/falabella/categories`, {}, token),
    },
    upsertListing: (connectionId: string, productId: string, data: {
      title?: string; description?: string;
      channelAttributes?: Record<string, any>;
    }, token: string) =>
      apiFetch<any>(`/ecommerce/connections/${connectionId}/products/${productId}/listing`, { method: 'PATCH', body: JSON.stringify(data) }, token),
    uploadListingImage: (connectionId: string, productId: string, file: File, token: string) =>
      apiUpload<any>(`/ecommerce/connections/${connectionId}/products/${productId}/listing-images`, file, token),
    deleteListingImage: (connectionId: string, productId: string, imageId: string, token: string) =>
      apiFetch<any>(`/ecommerce/connections/${connectionId}/products/${productId}/listing-images/${imageId}`, { method: 'DELETE' }, token),
    previewImport: (connectionId: string, offset: number | undefined, token: string) =>
      apiFetch<{
        connectionName: string; total: number; hasMore: boolean; nextOffset: number | null;
        alreadyImportedCount: number;
        items: {
          externalId: string; title: string; thumbnail: string | null; sku: string | null; skuSuspicious: boolean;
          matchedProductId: string | null; matchedProductName: string | null; matchType?: 'sku' | 'name' | null;
          price?: number; stock?: number; permalink?: string | null; status?: string;
          group?: string | null; attributes?: { name: string; value: string }[];
        }[];
      }>(`/ecommerce/connections/${connectionId}/import/preview${offset ? `?offset=${offset}` : ''}`, {}, token),
    confirmImport: (connectionId: string, externalIds: string[], unlinkIds: string[], token: string) =>
      apiFetch<{ imported: number; linked: number; skipped: number; errors: string[] }>(
        `/ecommerce/connections/${connectionId}/import/confirm`, { method: 'POST', body: JSON.stringify({ externalIds, unlinkIds }) }, token),
    previewSalesImport: (connectionId: string, from: string, to: string, token: string) =>
      apiFetch<{
        connectionName: string; total: number; truncated: boolean; alreadyImportedCount: number;
        orders: {
          externalId: string; date: string; total: number; buyerName: string | null;
          importable: boolean; alreadyRegistered: boolean;
          items: {
            title: string; quantity: number; unitPrice: number; resolved: boolean; productName: string | null;
            revenue?: number; discount?: number; commission?: number | null;
            shipping?: number; net?: number; cost?: number | null; profit?: number | null; cancelled?: boolean;
          }[];
          charges?: { shippingCost: number; marketplaceFee: number | null; taxes: number | null; discount: number; netAmount: number };
          breakdown?: { label: string; amount: number }[];
          chargeDetail?: { type: string; name: string; amount: number; tax: number }[];
          cost?: number | null; profit?: number | null;
        }[];
      }>(`/ecommerce/connections/${connectionId}/sales-import/preview?from=${from}&to=${to}`, {}, token),
    walmartImagesDiagnostic: (connectionId: string, sku: string, token: string) =>
      apiFetch<{ images: string[]; attempts: { source: string; ok: boolean; info: string; images: number }[] }>(
        `/ecommerce/connections/${connectionId}/walmart/images-diagnostic?sku=${encodeURIComponent(sku)}`, {}, token),
    // Publicar en Walmart (feed asíncrono) y consultar su resultado.
    walmartPublish: (connectionId: string, productId: string, token: string) =>
      apiFetch<{ feedId: string; status: string; submittedAt: string; errors: string[] }>(
        `/ecommerce/connections/${connectionId}/products/${productId}/walmart/publish`, { method: 'POST' }, token),
    walmartPublishStatus: (connectionId: string, productId: string, token: string) =>
      apiFetch<{ feedId: string; status: string; errors: string[]; checkedAt?: string }>(
        `/ecommerce/connections/${connectionId}/products/${productId}/walmart/publish-status`, { method: 'POST' }, token),
    walmartThumbnail: (connectionId: string, sku: string, token: string) =>
      apiFetch<{ url: string | null; count: number }>(
        `/ecommerce/connections/${connectionId}/walmart/thumbnail?sku=${encodeURIComponent(sku)}`, {}, token),
    importThumbnail: (connectionId: string, sku: string, token: string) =>
      apiFetch<{ url: string | null; count: number; pending?: boolean }>(
        `/ecommerce/connections/${connectionId}/import/thumbnail?sku=${encodeURIComponent(sku)}`, {}, token),
    fetchMissingImages: (connectionId: string, token: string) =>
      apiFetch<{ checked: number; updated: number; withoutImages: number; pending: boolean }>(
        `/ecommerce/connections/${connectionId}/import/fetch-images`, { method: 'POST' }, token),
    walmartFetchImages: (connectionId: string, token: string) =>
      apiFetch<{ checked: number; updated: number; withoutImages: number; pending: boolean }>(
        `/ecommerce/connections/${connectionId}/walmart/fetch-images`, { method: 'POST' }, token),
    syncOrderStatuses: (connectionId: string, token: string) =>
      apiFetch<{ checked: number; updated: number }>(
        `/ecommerce/connections/${connectionId}/orders/sync`, { method: 'POST' }, token),
    createOrderForSale: (saleId: string, token: string) =>
      apiFetch<{ id: string; status: string; stockDeducted: boolean; marketplaceStatus: string }>(
        `/ecommerce/connections/sales/${saleId}/order`, { method: 'POST' }, token),
    confirmSalesImport: (connectionId: string, externalIds: string[], token: string, createOrders?: boolean) =>
      apiFetch<{ imported: number; skipped: number; errors: string[] }>(
        `/ecommerce/connections/${connectionId}/sales-import/confirm`, { method: 'POST', body: JSON.stringify({ externalIds, createOrders: !!createOrders }) }, token),
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
      get: (id: string, token: string) =>
        apiFetch<any>(`/billing/connections/${id}`, {}, token),
      update: (id: string, data: { name?: string; credentials?: Record<string, string> }, token: string) =>
        apiFetch<any>(`/billing/connections/${id}`, { method: 'PATCH', body: JSON.stringify(data) }, token),
      test: (id: string, token: string) =>
        apiFetch<{ success: boolean; message?: string }>(`/billing/connections/${id}/test`, { method: 'POST' }, token),
      // Bsale: carga las boletas/facturas ya emitidas para ventas de marketplaces (no Mercado Libre).
      importMarketplaceDocs: (id: string, token: string, days = 120) =>
        apiFetch<{ scanned: number; marketplace: number; linked: number; alreadyLoaded: number; withoutSale: number; byChannel: Record<string, number> }>(
          `/billing/connections/${id}/import-marketplace-docs`, { method: 'POST', body: JSON.stringify({ days }) }, token),
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
      sendEmail: (id: string, email: string | undefined, token: string) =>
        apiFetch<{ sent: boolean; to: string }>(
          `/billing/invoices/${id}/send-email`,
          { method: 'POST', body: JSON.stringify(email ? { email } : {}) },
          token,
        ),
      sendMarketplace: (id: string, token: string) =>
        apiFetch<any>(`/billing/invoices/${id}/send-marketplace`, { method: 'POST' }, token),
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
      removeLogo: (token: string, companyId?: string) =>
        apiFetch<any>(`/billing/profile/logo${companyId ? `?companyId=${companyId}` : ''}`, { method: 'DELETE' }, token),
    },
  },
  orders: {
    list: (token: string, params?: { status?: string; channel?: string; warehouseId?: string; from?: string; to?: string; page?: number; companyId?: string; search?: string; sortBy?: string; sortDir?: 'asc' | 'desc' }) => {
      const q = new URLSearchParams();
      if (params?.status) q.set('status', params.status);
      if (params?.sortBy) { q.set('sortBy', params.sortBy); q.set('sortDir', params.sortDir || 'asc'); }
      if (params?.channel) q.set('channel', params.channel);
      if (params?.warehouseId) q.set('warehouseId', params.warehouseId);
      if (params?.from) q.set('from', params.from);
      if (params?.to) q.set('to', params.to);
      if (params?.page) q.set('page', String(params.page));
      if (params?.companyId) q.set('companyId', params.companyId);
      if (params?.search) q.set('search', params.search);
      return apiFetch<any>(`/orders?${q}`, {}, token);
    },
    get: (id: string, token: string) => apiFetch<any>(`/orders/${id}`, {}, token),
    create: (data: any, token: string) =>
      apiFetch<any>('/orders', { method: 'POST', body: JSON.stringify(data) }, token),
    update: (id: string, data: any, token: string) =>
      apiFetch<any>(`/orders/${id}`, { method: 'PATCH', body: JSON.stringify(data) }, token),
    remove: (id: string, token: string, companyId?: string) =>
      apiFetch<{ deleted: boolean }>(`/orders/${id}${companyId ? `?companyId=${companyId}` : ''}`, { method: 'DELETE' }, token),
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
    create: (data: { name: string; description?: string; companyId?: string }, token: string) =>
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
  inventory: {
    availability: (params: InventoryAvailabilityParams, token: string) =>
      apiFetch<InventoryAvailability>(`/inventory/availability?${toQuery(params)}`, {}, token),
    exportAvailability: (params: InventoryAvailabilityParams, token: string) =>
      apiDownload(`/inventory/availability/export?${toQuery(params)}`, token, 'disponibilidad-por-bodega.csv'),
    movements: (params: InventoryMovementsParams, token: string) =>
      apiFetch<InventoryMovements>(`/inventory/movements?${toQuery(params)}`, {}, token),
    exportMovements: (params: InventoryMovementsParams, token: string) =>
      apiDownload(`/inventory/movements/export?${toQuery(params)}`, token, 'historial-inventario.csv'),
    adjust: (data: { companyId?: string; productId: string; warehouseId: string; mode: 'SET' | 'DELTA'; quantity: number; reason: string }, token: string) =>
      apiFetch<{ warehouseId: string; balanceAfter: number; productStock: number; delta: number }>('/inventory/adjust', { method: 'POST', body: JSON.stringify(data) }, token),
    reconciliation: (token: string, companyId?: string) =>
      apiFetch<Array<{ id: string; sku: string; name: string; total: number; warehousesSum: number; difference: number }>>(`/inventory/reconciliation${companyId ? `?companyId=${companyId}` : ''}`, {}, token),
    reconcile: (data: { companyId?: string; productIds?: string[] }, token: string) =>
      apiFetch<{ fixed: number }>('/inventory/reconcile', { method: 'POST', body: JSON.stringify(data) }, token),
    transfers: {
      list: (params: { companyId?: string; status?: string; warehouseId?: string; search?: string; page?: number }, token: string) =>
        apiFetch<{ documents: TransferDocument[]; total: number; page: number; pages: number; byStatus: Record<string, number> }>(`/inventory/transfers?${toQuery(params)}`, {}, token),
      get: (id: string, token: string) => apiFetch<TransferDocument>(`/inventory/transfers/${id}`, {}, token),
      create: (data: { companyId?: string; fromWarehouseId: string; toWarehouseId: string; notes?: string; lines: Array<{ productId: string; quantity: number }>; dispatch?: boolean }, token: string) =>
        apiFetch<TransferDocument>('/inventory/transfers', { method: 'POST', body: JSON.stringify(data) }, token),
      update: (id: string, data: { fromWarehouseId?: string; toWarehouseId?: string; notes?: string; lines?: Array<{ productId: string; quantity: number }> }, token: string) =>
        apiFetch<TransferDocument>(`/inventory/transfers/${id}`, { method: 'PATCH', body: JSON.stringify(data) }, token),
      dispatch: (id: string, token: string) =>
        apiFetch<TransferDocument>(`/inventory/transfers/${id}/dispatch`, { method: 'POST' }, token),
      receive: (id: string, data: { lines: Array<{ lineId: string; receivedQuantity: number }>; notes?: string }, token: string) =>
        apiFetch<TransferDocument>(`/inventory/transfers/${id}/receive`, { method: 'POST', body: JSON.stringify(data) }, token),
      cancel: (id: string, reason: string, token: string) =>
        apiFetch<TransferDocument>(`/inventory/transfers/${id}/cancel`, { method: 'POST', body: JSON.stringify({ reason }) }, token),
    },
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
      update: (platform: string, data: { displayName?: string; description?: string; logoUrl?: string; logoScale?: number; logoScales?: Record<string, number> }, token: string) =>
        apiFetch<any>(`/settings/platforms/${platform}`, { method: 'PATCH', body: JSON.stringify(data) }, token),
      uploadLogo: (platform: string, file: File, token: string) =>
        apiUpload<{ url: string }>(`/settings/platforms/${platform}/logo`, file, token),
    },
  },
  notificationSounds: {
    list: (token: string) => apiFetch<{ id: string; name: string; url: string }[]>('/notification-sounds', {}, token),
    upload: (file: File, token: string) => apiUpload<{ id: string; name: string; url: string }>('/notification-sounds', file, token),
    remove: (id: string, token: string) => apiFetch<any>(`/notification-sounds/${id}`, { method: 'DELETE' }, token),
  },
  pos: {
    settings: {
      get: (token: string, companyId?: string) =>
        apiFetch<{
          workOrderPrintFormat: 'CARTA' | 'TICKET' | 'TICKET_58';
          printFormat: 'CARTA' | 'TICKET' | 'TICKET_58';
        }>(`/pos/settings${companyId ? `?companyId=${companyId}` : ''}`, {}, token),
      update: (data: { workOrderPrintFormat: 'CARTA' | 'TICKET' | 'TICKET_58' }, token: string, companyId?: string) =>
        apiFetch<{ workOrderPrintFormat: 'CARTA' | 'TICKET' | 'TICKET_58' }>(
          `/pos/settings${companyId ? `?companyId=${companyId}` : ''}`,
          { method: 'PATCH', body: JSON.stringify(data) },
          token,
        ),
    },
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
    orphanedSales: (token: string, page?: number, companyId?: string) => {
      const q = new URLSearchParams();
      if (page) q.set('page', String(page));
      if (companyId) q.set('companyId', companyId);
      return apiFetch<{ sales: any[]; total: number; page: number; pages: number }>(`/pos/sales/orphaned?${q}`, {}, token);
    },
    summary: (params: { companyId?: string; date?: string }, token: string) => {
      const q = new URLSearchParams();
      if (params.companyId) q.set('companyId', params.companyId);
      if (params.date) q.set('date', params.date);
      return apiFetch<any>(`/pos/sales/summary?${q}`, {}, token);
    },
    weeklySales: (token: string, params?: { companyId?: string; days?: number; channel?: string }) => {
      const q = new URLSearchParams();
      if (params?.companyId) q.set('companyId', params.companyId);
      if (params?.days) q.set('days', String(params.days));
      if (params?.channel) q.set('channel', params.channel);
      return apiFetch<{ days: any[]; byStore: any[] }>(`/pos/sales/weekly?${q}`, {}, token);
    },
    monthlySales: (token: string, params?: { companyId?: string; months?: number; channel?: string }) => {
      const q = new URLSearchParams();
      if (params?.companyId) q.set('companyId', params.companyId);
      if (params?.months) q.set('months', String(params.months));
      if (params?.channel) q.set('channel', params.channel);
      return apiFetch<{ months: any[]; total: number; count: number }>(`/pos/sales/monthly?${q}`, {}, token);
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
    workOrders: {
      list: (params: { companyId?: string; status?: string; page?: number; search?: string }, token: string) => {
        const q = new URLSearchParams();
        if (params.companyId) q.set('companyId', params.companyId);
        if (params.status) q.set('status', params.status);
        if (params.page) q.set('page', String(params.page));
        if (params.search) q.set('search', params.search);
        return apiFetch<{ workOrders: any[]; total: number; page: number; pages: number }>(`/pos/work-orders?${q}`, {}, token);
      },
      get: (id: string, token: string) => apiFetch<any>(`/pos/work-orders/${id}`, {}, token),
      create: (data: {
        clientId?: string; customerName?: string; customerPhone?: string; customerEmail?: string; notes?: string; companyId?: string;
        items: { productId?: string; productName: string; productSku?: string; quantity: number; unitPrice: number }[];
      }, token: string) =>
        apiFetch<any>('/pos/work-orders', { method: 'POST', body: JSON.stringify(data) }, token),
      update: (id: string, data: {
        clientId?: string; customerName?: string; customerPhone?: string; customerEmail?: string; notes?: string;
        items?: { productId?: string; productName: string; productSku?: string; quantity: number; unitPrice: number }[];
      }, token: string) =>
        apiFetch<any>(`/pos/work-orders/${id}`, { method: 'PATCH', body: JSON.stringify(data) }, token),
      reject: (id: string, token: string) =>
        apiFetch<any>(`/pos/work-orders/${id}/reject`, { method: 'POST' }, token),
      cancel: (id: string, token: string) =>
        apiFetch<any>(`/pos/work-orders/${id}`, { method: 'DELETE' }, token),
      convert: (id: string, data: { paymentMethod?: string }, token: string) =>
        apiFetch<any>(`/pos/work-orders/${id}/convert`, { method: 'POST', body: JSON.stringify(data) }, token),
      sendEmail: (id: string, email: string | undefined, token: string) =>
        apiFetch<{ sent: boolean; to: string }>(
          `/pos/work-orders/${id}/send-email`,
          { method: 'POST', body: JSON.stringify(email ? { email } : {}) },
          token,
        ),
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
  finance: {
    accounts: (token: string, companyId?: string) =>
      apiFetch<any[]>(`/finance/accounts${companyId ? `?companyId=${companyId}` : ''}`, {}, token),
    createAccount: (data: { name: string; code?: string; parentId?: string; type?: string; companyId?: string }, token: string) =>
      apiFetch<any>('/finance/accounts', { method: 'POST', body: JSON.stringify(data) }, token),
    updateAccount: (id: string, data: { name?: string; code?: string; parentId?: string | null; archived?: boolean }, token: string) =>
      apiFetch<any>(`/finance/accounts/${id}`, { method: 'PATCH', body: JSON.stringify(data) }, token),
    deleteAccount: (id: string, token: string) =>
      apiFetch<{ deleted: boolean }>(`/finance/accounts/${id}`, { method: 'DELETE' }, token),
    movements: (params: { companyId?: string; from?: string; to?: string; accountId?: string; search?: string; page?: number }, token: string) => {
      const q = new URLSearchParams();
      Object.entries(params).forEach(([k, v]) => { if (v !== undefined && v !== '') q.set(k, String(v)); });
      return apiFetch<{ items: any[]; total: number; page: number; pages: number; sum: number }>(`/finance/movements?${q}`, {}, token);
    },
    createMovement: (data: any, token: string) =>
      apiFetch<{ movement: any; budgetStatus: any }>('/finance/movements', { method: 'POST', body: JSON.stringify(data) }, token),
    updateMovement: (id: string, data: any, token: string) =>
      apiFetch<{ movement: any; budgetStatus: any }>(`/finance/movements/${id}`, { method: 'PUT', body: JSON.stringify(data) }, token),
    deleteMovement: (id: string, token: string) =>
      apiFetch<{ deleted: boolean }>(`/finance/movements/${id}`, { method: 'DELETE' }, token),
    automatic: (params: { companyId?: string; from: string; to: string }, token: string) => {
      const q = new URLSearchParams({ from: params.from, to: params.to });
      if (params.companyId) q.set('companyId', params.companyId);
      return apiFetch<any[]>(`/finance/automatic?${q}`, {}, token);
    },
    report: (year: number, token: string, companyId?: string) =>
      apiFetch<any>(`/finance/report?year=${year}${companyId ? `&companyId=${companyId}` : ''}`, {}, token),
    saveBudgets: (data: { year: number; entries: { accountId: string; month: number; amount: number | null }[]; companyId?: string }, token: string) =>
      apiFetch<{ saved: number }>('/finance/budgets', { method: 'PUT', body: JSON.stringify(data) }, token),
    copyBudget: (data: { fromYear: number; toYear: number; source: 'budget' | 'actual'; percent?: number; type?: string; companyId?: string }, token: string) =>
      apiFetch<{ saved: number }>('/finance/budgets/copy', { method: 'POST', body: JSON.stringify(data) }, token),
    uploadAttachment: (movementId: string, file: File, token: string) =>
      apiUpload<any>(`/finance/movements/${movementId}/attachment`, file, token),
    removeAttachment: (movementId: string, token: string) =>
      apiFetch<any>(`/finance/movements/${movementId}/attachment`, { method: 'DELETE' }, token),
    // cached: caché de 60 s en el servidor (solo para el panel de inicio).
    summary: (token: string, companyId?: string, cached = false) => {
      const q = new URLSearchParams();
      if (companyId) q.set('companyId', companyId);
      if (cached) q.set('cached', '1');
      return apiFetch<any>(`/finance/summary${q.toString() ? `?${q}` : ''}`, {}, token);
    },
    cashflow: (months: number, token: string, companyId?: string) =>
      apiFetch<any>(`/finance/cashflow?months=${months}${companyId ? `&companyId=${companyId}` : ''}`, {}, token),
    bankAccounts: (token: string, companyId?: string) =>
      apiFetch<any[]>(`/finance/bank-accounts${companyId ? `?companyId=${companyId}` : ''}`, {}, token),
    createBankAccount: (data: any, token: string) =>
      apiFetch<any>('/finance/bank-accounts', { method: 'POST', body: JSON.stringify(data) }, token),
    updateBankAccount: (id: string, data: any, token: string) =>
      apiFetch<any>(`/finance/bank-accounts/${id}`, { method: 'PATCH', body: JSON.stringify(data) }, token),
    deleteBankAccount: (id: string, token: string) =>
      apiFetch<{ deleted: boolean }>(`/finance/bank-accounts/${id}`, { method: 'DELETE' }, token),
    parseStatement: (id: string, file: File, token: string) =>
      apiUpload<{ rows: string[][]; totalRows: number }>(`/finance/bank-accounts/${id}/statement/parse`, file, token),
    importStatement: (id: string, lines: { date: string; description: string; amount: number; reference?: string; balance?: number }[], token: string) =>
      apiFetch<{ imported: number; duplicates: number; autoMatched: number }>(`/finance/bank-accounts/${id}/statement/import`, { method: 'POST', body: JSON.stringify({ lines }) }, token),
    transactions: (id: string, params: { status?: string; from?: string; to?: string; page?: number }, token: string) => {
      const q = new URLSearchParams();
      Object.entries(params).forEach(([k, v]) => { if (v !== undefined && v !== '') q.set(k, String(v)); });
      return apiFetch<{ items: any[]; total: number; page: number; pages: number }>(`/finance/bank-accounts/${id}/transactions?${q}`, {}, token);
    },
    autoMatch: (id: string, token: string) =>
      apiFetch<{ matched: number }>(`/finance/bank-accounts/${id}/auto-match`, { method: 'POST' }, token),
    candidates: (lineId: string, token: string) =>
      apiFetch<{ movements: any[]; transfers: any[] }>(`/finance/bank-transactions/${lineId}/candidates`, {}, token),
    reconcile: (lineId: string, data: { action: 'match' | 'ignore' | 'create' | 'unmatch'; movementId?: string; transferId?: string; note?: string; accountId?: string; withIva?: boolean; description?: string }, token: string) =>
      apiFetch<any>(`/finance/bank-transactions/${lineId}/reconcile`, { method: 'POST', body: JSON.stringify(data) }, token),
    transfers: (token: string, companyId?: string) =>
      apiFetch<any[]>(`/finance/transfers${companyId ? `?companyId=${companyId}` : ''}`, {}, token),
    createTransfer: (data: any, token: string) =>
      apiFetch<any>('/finance/transfers', { method: 'POST', body: JSON.stringify(data) }, token),
    deleteTransfer: (id: string, token: string) =>
      apiFetch<{ deleted: boolean }>(`/finance/transfers/${id}`, { method: 'DELETE' }, token),
    recurrings: (token: string, companyId?: string) =>
      apiFetch<any[]>(`/finance/recurrings${companyId ? `?companyId=${companyId}` : ''}`, {}, token),
    createRecurring: (data: any, token: string) =>
      apiFetch<any>('/finance/recurrings', { method: 'POST', body: JSON.stringify(data) }, token),
    updateRecurring: (id: string, data: any, token: string) =>
      apiFetch<any>(`/finance/recurrings/${id}`, { method: 'PUT', body: JSON.stringify(data) }, token),
    deleteRecurring: (id: string, token: string) =>
      apiFetch<{ deleted: boolean }>(`/finance/recurrings/${id}`, { method: 'DELETE' }, token),
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
  dropshipping: {
    suppliers: {
      list: (token: string, companyId?: string) => {
        const q = new URLSearchParams();
        if (companyId) q.set('companyId', companyId);
        return apiFetch<any[]>(`/dropshipping/suppliers?${q}`, {}, token);
      },
      create: (data: {
        supplierId?: string; name?: string; taxId?: string; email?: string; phone?: string; address?: string;
        autoCreateOrders?: boolean; leadTimeDays?: number; notes?: string; companyId?: string;
        connectorType?: 'FEED' | 'NORIEGA_API'; credentials?: Record<string, string>;
      }, token: string) =>
        apiFetch<any>('/dropshipping/suppliers', { method: 'POST', body: JSON.stringify(data) }, token),
      update: (id: string, data: {
        active?: boolean; autoCreateOrders?: boolean; leadTimeDays?: number | null; notes?: string;
        catalogUrl?: string | null; fieldMapping?: Record<string, string | null> | null;
        connectorType?: 'FEED' | 'NORIEGA_API'; credentials?: Record<string, string> | null;
      }, token: string) =>
        apiFetch<any>(`/dropshipping/suppliers/${id}`, { method: 'PATCH', body: JSON.stringify(data) }, token),
      remove: (id: string, token: string) =>
        apiFetch<any>(`/dropshipping/suppliers/${id}`, { method: 'DELETE' }, token),
      syncCatalog: (id: string, data: { catalogUrl?: string }, token: string) =>
        apiFetch<{ created: number; updated: number; skipped: string[] }>(`/dropshipping/suppliers/${id}/sync-catalog`, { method: 'POST', body: JSON.stringify(data) }, token),
      previewFeed: (catalogUrl: string, token: string) =>
        apiFetch<{ columns: string[]; sample: Record<string, any>[]; suggestedMapping: Record<string, string | null> }>(
          '/dropshipping/suppliers/preview-feed', { method: 'POST', body: JSON.stringify({ catalogUrl }) }, token,
        ),
      testConnection: (data: { connectorType: 'FEED' | 'NORIEGA_API'; credentials: Record<string, string> }, token: string) =>
        apiFetch<{ success: boolean; message?: string }>('/dropshipping/suppliers/test-connection', { method: 'POST', body: JSON.stringify(data) }, token),
      browseCatalog: (id: string, params: { q?: string; page?: number; pageSize?: number; refresh?: boolean; loadMore?: boolean }, token: string) => {
        const q = new URLSearchParams();
        if (params.q) q.set('q', params.q);
        if (params.page) q.set('page', String(params.page));
        if (params.pageSize) q.set('pageSize', String(params.pageSize));
        if (params.refresh) q.set('refresh', '1');
        if (params.loadMore) q.set('loadMore', '1');
        return apiFetch<{ rows: any[]; total: number; page: number; pages: number; fetchedAt: string; providerHasMore: boolean; catalogComplete: boolean; providerRecordsFetched: number; providerTotalRecords: number | null }>(
          `/dropshipping/suppliers/${id}/catalog?${q}`, {}, token,
        );
      },
      progress: (id: string, token: string) =>
        apiFetch<{ active: false; error: string | null } | { active: true; message: string; percent: number | null; recordsDone: number; totalRecords: number | null }>(
          `/dropshipping/suppliers/${id}/progress`, {}, token,
        ),
      loadFullCatalog: (id: string, force: boolean, token: string) =>
        apiFetch<{ ready: boolean }>(
          `/dropshipping/suppliers/${id}/catalog/load-full`, { method: 'POST', body: JSON.stringify({ force }) }, token,
        ),
      importCatalog: (id: string, skus: string[], token: string) =>
        apiFetch<{ created: number; updated: number; skipped: string[] }>(
          `/dropshipping/suppliers/${id}/catalog/import`, { method: 'POST', body: JSON.stringify({ skus }) }, token,
        ),
    },
    products: {
      list: (token: string, companyId?: string) => {
        const q = new URLSearchParams();
        if (companyId) q.set('companyId', companyId);
        return apiFetch<{ linked: any[]; availableProducts: any[] }>(`/dropshipping/products?${q}`, {}, token);
      },
      create: (data: {
        productId: string; dropshipSupplierId: string; supplierCost: number; supplierSku?: string; leadTimeDays?: number; companyId?: string;
      }, token: string) =>
        apiFetch<any>('/dropshipping/products', { method: 'POST', body: JSON.stringify(data) }, token),
      update: (id: string, data: { supplierCost?: number; supplierSku?: string; leadTimeDays?: number | null; active?: boolean }, token: string) =>
        apiFetch<any>(`/dropshipping/products/${id}`, { method: 'PATCH', body: JSON.stringify(data) }, token),
      remove: (id: string, token: string) =>
        apiFetch<any>(`/dropshipping/products/${id}`, { method: 'DELETE' }, token),
    },
    orders: {
      list: (token: string, params?: { companyId?: string; status?: string; dropshipSupplierId?: string; page?: number }) => {
        const q = new URLSearchParams();
        if (params?.companyId) q.set('companyId', params.companyId);
        if (params?.status) q.set('status', params.status);
        if (params?.dropshipSupplierId) q.set('dropshipSupplierId', params.dropshipSupplierId);
        if (params?.page) q.set('page', String(params.page));
        return apiFetch<{ orders: any[]; total: number; page: number; pages: number }>(`/dropshipping/orders?${q}`, {}, token);
      },
      get: (id: string, token: string) => apiFetch<any>(`/dropshipping/orders/${id}`, {}, token),
      generate: (data: { companyId?: string; sinceDays?: number }, token: string) =>
        apiFetch<{ created: number; sent: number; skipped: number }>('/dropshipping/orders/generate', { method: 'POST', body: JSON.stringify(data) }, token),
      update: (id: string, data: { status?: string; trackingCode?: string; courier?: string; supplierRef?: string; notes?: string }, token: string) =>
        apiFetch<any>(`/dropshipping/orders/${id}`, { method: 'PATCH', body: JSON.stringify(data) }, token),
      send: (id: string, token: string) =>
        apiFetch<any>(`/dropshipping/orders/${id}/send`, { method: 'POST' }, token),
    },
    report: (token: string, params?: { companyId?: string; from?: string; to?: string }) => {
      const q = new URLSearchParams();
      if (params?.companyId) q.set('companyId', params.companyId);
      if (params?.from) q.set('from', params.from);
      if (params?.to) q.set('to', params.to);
      return apiFetch<{ rows: any[]; totals: any }>(`/dropshipping/report?${q}`, {}, token);
    },
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

// ── IA: planes, créditos y revisión de fotos ──
export interface AiPlan {
  id: string;
  name: string;
  dailyCredits: number | null;
  monthlyCredits: number | null;
  features: PlanFeature[];
  _count?: { companies: number };
}

export type PlanFeature = 'ML_DIAGNOSTIC' | 'AI_CHECK' | 'AI_FIX' | 'AI_GENERATE';

export const PLAN_FEATURE_INFO: Record<PlanFeature, { label: string; description: string; usesCredits: boolean }> = {
  ML_DIAGNOSTIC: { label: 'Diagnóstico ML', description: 'Diagnóstico oficial de Mercado Libre: fondo, tamaño, textos y marcas de agua.', usesCredits: false },
  AI_CHECK: { label: 'Revisión con IA', description: 'La IA confirma que cada foto coincide con el título.', usesCredits: true },
  AI_FIX: { label: 'Corrección', description: 'La IA deja la foto real con fondo blanco, centrada y sin textos.', usesCredits: true },
  AI_GENERATE: { label: 'Imágenes de referencia', description: 'La IA crea una imagen del producto desde el título.', usesCredits: true },
};

export interface AiCreditsStatus {
  plan: { id: string; name: string; dailyCredits: number | null; monthlyCredits: number | null; features: PlanFeature[] } | null;
  usedToday: number;
  usedMonth: number;
  remainingToday: number | null;
  remainingMonth: number | null;
  costs: Record<AiTask, number>;
  ready: Record<AiTask, boolean>;
}

export type AiTask = 'PHOTO_CHECK' | 'PHOTO_FIX' | 'PHOTO_GENERATE';

export interface AiUsageReport extends AiCreditsStatus {
  stats: Record<string, { today: number; month: number; total: number }>;
  recent: {
    id: string;
    kind: string;
    credits: number;
    createdAt: string;
    userName: string | null;
    product: { id: string; name: string; sku: string } | null;
  }[];
}

export interface AiProviderInfo {
  id: string;
  name: string;
  company: string;
  description: string;
  keyUrl: string;
  tasks: AiTask[];
  taskNotes: Partial<Record<AiTask, string>>;
  configured: boolean;
  assignedTasks: AiTask[];
  models: Partial<Record<AiTask, { value: string; default: string; label: string; hint: string }>>;
  extraFields?: { key: string; label: string; hint: string; sensitive: boolean; value: string; set: boolean }[];
}

export interface AiProvidersOverview {
  providers: AiProviderInfo[];
  tasks: Record<AiTask, { label: string; description: string; providerId: string | null }>;
  costs?: Record<AiTask, number>;
  // Usos por tarea (ML_DIAGNOSTIC = fotos diagnosticadas por Mercado Libre).
  stats?: Record<AiTask | 'ML_DIAGNOSTIC', { today: number; month: number; total: number }>;
}

export interface PhotoVerdict {
  matches: boolean;
  confidence: 'alta' | 'media' | 'baja';
  shows: string;
  problems: string[];
  suggestion: string;
  suggestedTitle: string;
}

export interface PhotoCheckImage {
  imageId: string;
  url: string;
  isPrimary: boolean;
  ml?: { available: boolean; ok: boolean | null; issues: string[]; error?: string; raw?: unknown };
  ai?: PhotoVerdict;
  aiError?: string | null;
}

export interface PhotoCheckResult {
  title: string;
  categoryId: string | null;
  images: PhotoCheckImage[];
  aiBlocked: string | null;
  /** Motivo por el que no se hizo el diagnóstico de ML (p. ej. falta la categoría). */
  mlSkipped?: string | null;
  features: Record<PlanFeature, boolean>;
  credits: AiCreditsStatus | null;
}

// ── Planes comerciales ──
export type SubscriptionFeature = 'POS' | 'PURCHASES' | 'PICKING' | 'MULTICOMPANY';

export const SUBSCRIPTION_FEATURE_LABEL: Record<SubscriptionFeature, string> = {
  POS: 'Punto de venta',
  PURCHASES: 'Compras y costo promedio',
  PICKING: 'Picking y packing con escaneo',
  MULTICOMPANY: 'Multiempresa',
};

export interface SubscriptionPlan {
  id: string;
  name: string;
  description: string | null;
  monthlyPrice: number | null;
  annualPrice: number | null;
  priceFrom: boolean;
  implementationPrice: number | null;
  implementationFreeAnnual: boolean;
  maxChannels: number | null;
  maxProducts: number | null;
  maxUsers: number | null;
  maxWarehouses: number | null;
  features: SubscriptionFeature[];
  addons: string | null;
  isTrial: boolean;
  trialDays: number | null;
  sortOrder: number;
  active: boolean;
  _count?: { companies: number };
}

export type SubscriptionResource = 'channels' | 'products' | 'users' | 'warehouses';

export interface SubscriptionUsage {
  plan: SubscriptionPlan | null;
  billing: 'MONTHLY' | 'ANNUAL' | null;
  trialEndsAt: string | null;
  trialExpired: boolean;
  usage: Record<SubscriptionResource, { used: number; limit: number | null }>;
}
