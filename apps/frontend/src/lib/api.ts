const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

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
    const err = await res.json().catch(() => ({ message: 'Error desconocido' }));
    throw new Error(err.message || `Error ${res.status}`);
  }
  return res.json();
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
  },
  users: {
    list: (token: string) => apiFetch<any[]>('/users', {}, token),
    create: (data: any, token: string) =>
      apiFetch<any>('/users', { method: 'POST', body: JSON.stringify(data) }, token),
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
  },
  marketplace: {
    publish: (productId: string, connectionId: string, token: string) =>
      apiFetch<any>(`/marketplace/ml/products/${productId}/publish/${connectionId}`, { method: 'POST' }, token),
    sync: (productId: string, connectionId: string, token: string) =>
      apiFetch<any>(`/marketplace/ml/products/${productId}/sync/${connectionId}`, { method: 'POST' }, token),
  },
};
