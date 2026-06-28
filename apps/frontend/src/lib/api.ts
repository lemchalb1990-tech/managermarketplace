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

export const imgUrl = (path: string) => `${API_URL}${path}`;

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
  },
  users: {
    list: (token: string) => apiFetch<any[]>('/users', {}, token),
    create: (data: any, token: string) =>
      apiFetch<any>('/users', { method: 'POST', body: JSON.stringify(data) }, token),
    update: (id: string, data: any, token: string) =>
      apiFetch<any>(`/users/${id}`, { method: 'PATCH', body: JSON.stringify(data) }, token),
  },
  catalog: {
    list: (token: string) => apiFetch<any[]>('/catalog/products', {}, token),
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
  },
  marketplace: {
    getSettings: (token: string, companyId?: string) =>
      apiFetch<{ mlClientId: string | null; hasSecret: boolean }>(
        `/ecommerce/ml/settings${companyId ? `?companyId=${companyId}` : ''}`, {}, token),
    saveCredentials: (data: { mlClientId: string; mlClientSecret: string; companyId?: string }, token: string) =>
      apiFetch<any>('/ecommerce/ml/credentials', { method: 'PATCH', body: JSON.stringify(data) }, token),
    authUrl: (data: { name: string; mlClientId: string; mlClientSecret: string; companyId?: string }, token: string) =>
      apiFetch<{ authUrl: string }>(
        '/ecommerce/ml/auth-url',
        { method: 'POST', body: JSON.stringify(data) },
        token,
      ),
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
    publish: (productId: string, connectionId: string, token: string) =>
      apiFetch<any>(`/ecommerce/ml/products/${productId}/publish/${connectionId}`, { method: 'POST' }, token),
    sync: (productId: string, connectionId: string, token: string) =>
      apiFetch<any>(`/ecommerce/ml/products/${productId}/sync/${connectionId}`, { method: 'POST' }, token),
    toggleListing: (productId: string, connectionId: string, token: string) =>
      apiFetch<any>(`/ecommerce/ml/products/${productId}/toggle/${connectionId}`, { method: 'PATCH' }, token),
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
      list: (token: string, params?: { page?: number; dteType?: string; status?: string; from?: string; to?: string; connectionId?: string }) => {
        const q = new URLSearchParams();
        if (params?.page) q.set('page', String(params.page));
        if (params?.dteType) q.set('dteType', params.dteType);
        if (params?.status) q.set('status', params.status);
        if (params?.from) q.set('from', params.from);
        if (params?.to) q.set('to', params.to);
        if (params?.connectionId) q.set('connectionId', params.connectionId);
        return apiFetch<any>(`/billing/invoices?${q}`, {}, token);
      },
      issue: (data: any, token: string) =>
        apiFetch<any>('/billing/invoices', { method: 'POST', body: JSON.stringify(data) }, token),
      get: (id: string, token: string) =>
        apiFetch<any>(`/billing/invoices/${id}`, {}, token),
      cancel: (id: string, token: string) =>
        apiFetch<any>(`/billing/invoices/${id}/cancel`, { method: 'POST' }, token),
    },
  },
  warehouses: {
    list: (token: string) => apiFetch<any[]>('/warehouses', {}, token),
    create: (data: { name: string; description?: string }, token: string) =>
      apiFetch<any>('/warehouses', { method: 'POST', body: JSON.stringify(data) }, token),
    update: (id: string, data: { name?: string; description?: string; active?: boolean }, token: string) =>
      apiFetch<any>(`/warehouses/${id}`, { method: 'PATCH', body: JSON.stringify(data) }, token),
    remove: (id: string, token: string) =>
      apiFetch<any>(`/warehouses/${id}`, { method: 'DELETE' }, token),
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
    listSales: (params: { companyId?: string; channel?: string; from?: string; to?: string; page?: number }, token: string) => {
      const q = new URLSearchParams();
      if (params.companyId) q.set('companyId', params.companyId);
      if (params.channel) q.set('channel', params.channel);
      if (params.from) q.set('from', params.from);
      if (params.to) q.set('to', params.to);
      if (params.page) q.set('page', String(params.page));
      return apiFetch<{ sales: any[]; total: number; page: number; pages: number }>(`/pos/sales?${q}`, {}, token);
    },
    summary: (params: { companyId?: string; date?: string }, token: string) => {
      const q = new URLSearchParams();
      if (params.companyId) q.set('companyId', params.companyId);
      if (params.date) q.set('date', params.date);
      return apiFetch<any>(`/pos/sales/summary?${q}`, {}, token);
    },
    stockMovements: (productId: string, token: string) =>
      apiFetch<any[]>(`/pos/stock/movements/${productId}`, {}, token),
    adjustStock: (data: { productId: string; quantity: number; reason?: string }, token: string) =>
      apiFetch<any>('/pos/stock/adjust', { method: 'POST', body: JSON.stringify(data) }, token),
  },
};
