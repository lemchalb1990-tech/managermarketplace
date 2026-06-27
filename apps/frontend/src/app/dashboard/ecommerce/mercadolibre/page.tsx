'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { getToken } from '@/lib/auth';
import { api } from '@/lib/api';

export default function MercadoLibrePage() {
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [companies, setCompanies] = useState<any[]>([]);
  const [selectedCompanyId, setSelectedCompanyId] = useState('');
  const [connections, setConnections] = useState<any[]>([]);

  const [showConnect, setShowConnect] = useState(false);
  const [connName, setConnName] = useState('');
  const [connClientId, setConnClientId] = useState('');
  const [connClientSecret, setConnClientSecret] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState('');
  const searchParams = useSearchParams();

  const isSuperAdmin = currentUser?.role === 'SUPER_ADMIN';
  const activeCompanyId = isSuperAdmin ? selectedCompanyId : currentUser?.companyId;

  async function loadConnections() {
    const token = getToken()!;
    const conns = await api.marketplace.connections(token).catch(() => []);
    setConnections(conns);
  }

  async function init() {
    const token = getToken();
    if (!token) return;
    const me = await api.me(token);
    setCurrentUser(me);
    if (me.role === 'SUPER_ADMIN') {
      const comps = await api.companies.list(token);
      setCompanies(comps);
    } else {
      await loadConnections();
    }
  }

  useEffect(() => {
    init();
    if (searchParams.get('error')) setError('No se pudo conectar la tienda. Verifica las credenciales e intenta nuevamente.');
  }, [searchParams]);

  useEffect(() => {
    if (isSuperAdmin && selectedCompanyId) {
      loadConnections();
      setShowConnect(false);
      setError('');
    }
  }, [selectedCompanyId]);

  async function handleConnect() {
    if (!connName.trim() || !connClientId.trim() || !connClientSecret.trim()) return;
    setConnecting(true);
    setError('');
    try {
      const token = getToken()!;
      const { authUrl } = await api.marketplace.authUrl({
        name: connName.trim(),
        mlClientId: connClientId.trim(),
        mlClientSecret: connClientSecret.trim(),
        ...(isSuperAdmin && activeCompanyId ? { companyId: activeCompanyId } : {}),
      }, token);
      window.location.href = authUrl;
    } catch (err: any) {
      setError(err.message);
      setConnecting(false);
    }
  }

  function resetConnForm() {
    setShowConnect(false);
    setConnName('');
    setConnClientId('');
    setConnClientSecret('');
    setError('');
  }

  async function handleDelete(id: string, name: string) {
    if (!confirm(`¿Desconectar la tienda "${name}"?`)) return;
    const token = getToken()!;
    await api.marketplace.deleteConnection(id, token);
    await loadConnections();
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 mb-1">
        <a href="/dashboard/ecommerce" className="text-sm text-gray-400 hover:text-gray-600">E-commerce</a>
        <span className="text-gray-300">/</span>
        <span className="text-sm text-gray-600 font-medium">Mercado Libre</span>
      </div>
      <h1 className="text-2xl font-bold text-gray-900">Mercado Libre</h1>

      {/* Selector de empresa (solo Super Admin) */}
      {isSuperAdmin && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
          <label className="block text-xs font-semibold text-blue-700 mb-1">Empresa a gestionar</label>
          <select
            value={selectedCompanyId}
            onChange={(e) => setSelectedCompanyId(e.target.value)}
            className="w-full px-3 py-2 border border-blue-300 rounded-lg text-sm bg-white"
          >
            <option value="">— Selecciona una empresa —</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
      )}

      {isSuperAdmin && !selectedCompanyId ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center text-gray-400">
          <p className="text-sm">Selecciona una empresa para gestionar sus tiendas de Mercado Libre.</p>
        </div>
      ) : (
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-gray-900">Tiendas conectadas</h2>
            <button
              onClick={() => { setShowConnect(!showConnect); setError(''); }}
              className="px-4 py-2 bg-yellow-400 hover:bg-yellow-500 text-gray-900 rounded-lg text-sm font-semibold"
            >
              + Conectar tienda
            </button>
          </div>

          {error && (
            <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
              {error}
            </div>
          )}

          {showConnect && (
            <div className="bg-white rounded-xl border border-gray-200 p-6 mb-4">
              <h3 className="font-semibold text-gray-800 mb-1">Conectar tienda de Mercado Libre</h3>
              <p className="text-sm text-gray-500 mb-4">
                Cada tienda tiene sus propias credenciales. Serás redirigido a Mercado Libre para autorizar.
              </p>
              <div className="grid grid-cols-2 gap-3 mb-4">
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-gray-600 mb-1">Nombre de la tienda *</label>
                  <input
                    value={connName}
                    onChange={(e) => setConnName(e.target.value)}
                    placeholder="Ej: Tienda principal, Cuenta dropshipping..."
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Client ID *</label>
                  <input
                    value={connClientId}
                    onChange={(e) => setConnClientId(e.target.value)}
                    placeholder="Ej: 123456789"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Client Secret *</label>
                  <input
                    type="password"
                    value={connClientSecret}
                    onChange={(e) => setConnClientSecret(e.target.value)}
                    placeholder="••••••••"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  />
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={handleConnect}
                  disabled={connecting || !connName.trim() || !connClientId.trim() || !connClientSecret.trim()}
                  className="px-4 py-2 bg-yellow-400 hover:bg-yellow-500 text-gray-900 rounded-lg text-sm font-semibold disabled:opacity-50"
                >
                  {connecting ? 'Redirigiendo...' : 'Autorizar en ML'}
                </button>
                <button onClick={resetConnForm}
                  className="px-4 py-2 border border-gray-300 text-gray-600 rounded-lg text-sm hover:bg-gray-50">
                  Cancelar
                </button>
              </div>
            </div>
          )}

          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-left px-4 py-3 text-gray-600 font-medium">Tienda</th>
                  <th className="text-left px-4 py-3 text-gray-600 font-medium">Client ID</th>
                  <th className="text-left px-4 py-3 text-gray-600 font-medium">Estado</th>
                  <th className="text-left px-4 py-3 text-gray-600 font-medium">Token expira</th>
                  <th className="text-left px-4 py-3 text-gray-600 font-medium">Conectada el</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {connections.map((c) => {
                  const expired = c.expiresAt && new Date(c.expiresAt) < new Date();
                  return (
                    <tr key={c.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 font-medium text-gray-900">{c.name}</td>
                      <td className="px-4 py-3 font-mono text-xs text-gray-400">{c.mlClientId || '—'}</td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${c.active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                          {c.active ? 'Activa' : 'Inactiva'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {c.expiresAt ? (
                          <span className={`text-xs ${expired ? 'text-red-500 font-medium' : 'text-gray-500'}`}>
                            {expired ? 'Expirado · ' : ''}{new Date(c.expiresAt).toLocaleDateString('es', { day: '2-digit', month: 'short', year: 'numeric' })}
                          </span>
                        ) : <span className="text-gray-400 text-xs">—</span>}
                      </td>
                      <td className="px-4 py-3 text-gray-500 text-xs">
                        {new Date(c.createdAt).toLocaleDateString('es', { day: '2-digit', month: 'short', year: 'numeric' })}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button onClick={() => handleDelete(c.id, c.name)}
                          className="text-xs text-red-500 hover:text-red-700 font-medium">
                          Desconectar
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {connections.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-10 text-center text-gray-400">
                      <p className="text-sm mb-1">Sin tiendas conectadas</p>
                      <p className="text-xs">Haz clic en "+ Conectar tienda" para vincular una cuenta de Mercado Libre.</p>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
