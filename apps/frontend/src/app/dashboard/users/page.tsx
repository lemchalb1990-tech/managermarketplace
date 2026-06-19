'use client';

import { useEffect, useState, FormEvent } from 'react';
import { getToken, getUser } from '@/lib/auth';
import { api } from '@/lib/api';

const ROLES = [
  { value: 'COMPANY_ADMIN', label: 'Admin de empresa' },
  { value: 'CATALOG_MANAGER', label: 'Gestor de catálogo' },
];

const roleLabels: Record<string, string> = {
  SUPER_ADMIN: 'Super Admin',
  COMPANY_ADMIN: 'Admin empresa',
  CATALOG_MANAGER: 'Gestor catálogo',
};

const emptyForm = { name: '', email: '', password: '', role: 'CATALOG_MANAGER', companyId: '' };

export default function UsersPage() {
  const [users, setUsers] = useState<any[]>([]);
  const [companies, setCompanies] = useState<any[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [currentUser, setCurrentUser] = useState<any>(null);

  async function load() {
    const token = getToken();
    const u = getUser();
    if (!token || !u) return;
    setCurrentUser(u);
    const data = await api.users.list(token);
    setUsers(data);
    if (u.role === 'SUPER_ADMIN') {
      const comps = await api.companies.list(token);
      setCompanies(comps);
    }
  }

  useEffect(() => { load(); }, []);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const token = getToken()!;
      const payload: any = { name: form.name, email: form.email, password: form.password, role: form.role };
      if (form.companyId) payload.companyId = form.companyId;
      await api.users.create(payload, token);
      setForm(emptyForm);
      setShowForm(false);
      await load();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  const availableRoles = currentUser?.role === 'SUPER_ADMIN' ? ROLES : ROLES.filter(r => r.value === 'CATALOG_MANAGER');

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Usuarios</h1>
        <button onClick={() => setShowForm(!showForm)}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700">
          + Nuevo usuario
        </button>
      </div>

      {showForm && (
        <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
          <h2 className="font-semibold text-gray-800 mb-4">Nuevo usuario</h2>
          <form onSubmit={handleCreate} className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Nombre *</label>
              <input value={form.name} onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))}
                required className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Email *</label>
              <input type="email" value={form.email} onChange={(e) => setForm(f => ({ ...f, email: e.target.value }))}
                required className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Contraseña *</label>
              <input type="password" value={form.password} onChange={(e) => setForm(f => ({ ...f, password: e.target.value }))}
                required className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Rol *</label>
              <select value={form.role} onChange={(e) => setForm(f => ({ ...f, role: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
                {availableRoles.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
            </div>
            {currentUser?.role === 'SUPER_ADMIN' && (
              <div className="col-span-2">
                <label className="block text-xs font-medium text-gray-600 mb-1">Empresa</label>
                <select value={form.companyId} onChange={(e) => setForm(f => ({ ...f, companyId: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
                  <option value="">Sin empresa</option>
                  {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
            )}
            {error && <p className="col-span-2 text-red-600 text-sm">{error}</p>}
            <div className="col-span-2 flex gap-2">
              <button type="submit" disabled={loading}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
                {loading ? 'Creando...' : 'Crear usuario'}
              </button>
              <button type="button" onClick={() => { setShowForm(false); setForm(emptyForm); }}
                className="px-4 py-2 border border-gray-300 text-gray-600 rounded-lg text-sm hover:bg-gray-50">
                Cancelar
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="text-left px-4 py-3 text-gray-600 font-medium">Nombre</th>
              <th className="text-left px-4 py-3 text-gray-600 font-medium">Email</th>
              <th className="text-left px-4 py-3 text-gray-600 font-medium">Rol</th>
              <th className="text-left px-4 py-3 text-gray-600 font-medium">Empresa</th>
              <th className="text-left px-4 py-3 text-gray-600 font-medium">Estado</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {users.map((u) => (
              <tr key={u.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 font-medium text-gray-900">{u.name}</td>
                <td className="px-4 py-3 text-gray-500">{u.email}</td>
                <td className="px-4 py-3">
                  <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-700">
                    {roleLabels[u.role] || u.role}
                  </span>
                </td>
                <td className="px-4 py-3 text-gray-600">{u.company?.name || '—'}</td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${u.active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                    {u.active ? 'Activo' : 'Inactivo'}
                  </span>
                </td>
              </tr>
            ))}
            {users.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400">Sin usuarios registrados</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
