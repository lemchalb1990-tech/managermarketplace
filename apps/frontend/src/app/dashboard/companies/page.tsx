'use client';

import { useEffect, useState, FormEvent } from 'react';
import { getToken } from '@/lib/auth';
import { api } from '@/lib/api';

const emptyForm = { name: '', slug: '', adminName: '', adminEmail: '', adminPassword: '' };

export default function CompaniesPage() {
  const [companies, setCompanies] = useState<any[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);

  async function load() {
    const token = getToken();
    if (!token) return;
    const data = await api.companies.list(token);
    setCompanies(data);
  }

  useEffect(() => { load(); }, []);

  function handleNameChange(name: string) {
    const slug = name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    setForm(f => ({ ...f, name, slug }));
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const token = getToken()!;
      const payload: any = { name: form.name, slug: form.slug };
      if (form.adminEmail) {
        payload.admin = { name: form.adminName, email: form.adminEmail, password: form.adminPassword };
      }
      await api.companies.create(payload, token);
      setForm(emptyForm);
      setShowForm(false);
      await load();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Empresas</h1>
        <button onClick={() => setShowForm(!showForm)}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700">
          + Nueva empresa
        </button>
      </div>

      {showForm && (
        <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
          <h2 className="font-semibold text-gray-800 mb-4">Nueva empresa</h2>
          <form onSubmit={handleCreate} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Nombre de la empresa *</label>
                <input value={form.name} onChange={(e) => handleNameChange(e.target.value)}
                  required className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Slug *</label>
                <input value={form.slug} onChange={(e) => setForm(f => ({ ...f, slug: e.target.value }))}
                  required className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono" />
              </div>
            </div>

            <div className="border-t border-gray-100 pt-4">
              <p className="text-xs font-semibold text-gray-500 uppercase mb-3">Administrador de empresa (opcional)</p>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Nombre</label>
                  <input value={form.adminName} onChange={(e) => setForm(f => ({ ...f, adminName: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder="Juan García" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Email</label>
                  <input type="email" value={form.adminEmail} onChange={(e) => setForm(f => ({ ...f, adminEmail: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder="admin@empresa.com" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Contraseña</label>
                  <input type="password" value={form.adminPassword} onChange={(e) => setForm(f => ({ ...f, adminPassword: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder="mínimo 6 caracteres" />
                </div>
              </div>
            </div>

            {error && <p className="text-red-600 text-sm">{error}</p>}
            <div className="flex gap-2">
              <button type="submit" disabled={loading}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
                {loading ? 'Creando...' : 'Crear empresa'}
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
              <th className="text-left px-4 py-3 text-gray-600 font-medium">Empresa</th>
              <th className="text-left px-4 py-3 text-gray-600 font-medium">Slug</th>
              <th className="text-left px-4 py-3 text-gray-600 font-medium">Usuarios</th>
              <th className="text-left px-4 py-3 text-gray-600 font-medium">Productos</th>
              <th className="text-left px-4 py-3 text-gray-600 font-medium">Estado</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {companies.map((c) => (
              <tr key={c.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 font-medium text-gray-900">{c.name}</td>
                <td className="px-4 py-3 text-gray-500 font-mono">{c.slug}</td>
                <td className="px-4 py-3 text-gray-600">{c._count?.users ?? 0}</td>
                <td className="px-4 py-3 text-gray-600">{c._count?.products ?? 0}</td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${c.active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                    {c.active ? 'Activa' : 'Inactiva'}
                  </span>
                </td>
              </tr>
            ))}
            {companies.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400">Sin empresas registradas</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
