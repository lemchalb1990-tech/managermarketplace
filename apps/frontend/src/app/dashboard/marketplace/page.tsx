'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { getToken } from '@/lib/auth';
import { api } from '@/lib/api';

export default function MarketplacePage() {
  const [connections, setConnections] = useState<any[]>([]);
  const [showConnect, setShowConnect] = useState(false);
  const [connName, setConnName] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState('');
  const searchParams = useSearchParams();

  async function load() {
    const token = getToken();
    if (!token) return;
    const conns = await api.marketplace.connections(token).catch(() => []);
    setConnections(conns);
  }

  useEffect(() => {
    load();
    if (searchParams.get('error')) setError('No se pudo conectar la cuenta. Intenta nuevamente.');
  }, [searchParams]);

  async function handleConnect() {
    if (!connName.trim()) return;
    setConnecting(true);
    setError('');
    try {
      const token = getToken()!;
      const { authUrl } = await api.marketplace.authUrl(connName.trim(), token);
      window.location.href = authUrl;
    } catch (err: any) {
      setError(err.message);
      setConnecting(false);
    }
  }

  async function handleDelete(id: string, name: string) {
    if (!confirm(`¿Desconectar la cuenta "${name}"?`)) return;
    const token = getToken()!;
    await api.marketplace.deleteConnection(id, token);
    await load();
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Mercado Libre</h1>
        <button onClick={() => { setShowConnect(!showConnect); setError(''); }}
          className="px-4 py-2 bg-yellow-400 hover:bg-yellow-500 text-gray-900 rounded-lg text-sm font-semibold">
          + Conectar cuenta
        </button>
      </div>

      {error && (
        <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          {error}
        </div>
      )}

      {showConnect && (
        <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
          <h2 className="font-semibold text-gray-800 mb-1">Conectar cuenta de Mercado Libre</h2>
          <p className="text-sm text-gray-500 mb-4">
            Ingresa un nombre para identificar esta cuenta, luego autoriza el acceso en Mercado Libre.
          </p>
          <div className="flex gap-3">
            <input
              value={connName}
              onChange={(e) => setConnName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleConnect()}
              placeholder="Ej: Tienda principal, Cuenta dropshipping..."
              className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400"
            />
            <button onClick={handleConnect} disabled={connecting || !connName.trim()}
              className="px-4 py-2 bg-yellow-400 hover:bg-yellow-500 text-gray-900 rounded-lg text-sm font-semibold disabled:opacity-50">
              {connecting ? 'Redirigiendo...' : 'Autorizar en ML'}
            </button>
            <button onClick={() => setShowConnect(false)}
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
              <th className="text-left px-4 py-3 text-gray-600 font-medium">Cuenta</th>
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
                <td colSpan={5} className="px-4 py-10 text-center text-gray-400">
                  <p className="text-sm mb-1">Sin cuentas conectadas</p>
                  <p className="text-xs">Haz clic en "+ Conectar cuenta" para autorizar una cuenta de Mercado Libre.</p>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
