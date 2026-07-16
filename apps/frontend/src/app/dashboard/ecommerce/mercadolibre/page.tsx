'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { getToken } from '@/lib/auth';
import { api } from '@/lib/api';
import { Logos } from '../components/logos';
import { ImportModal } from './components/ImportModal';
import { SalesImportModal } from './components/SalesImportModal';

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
  const [importConn, setImportConn] = useState<{ id: string; name: string } | null>(null);
  const [salesImportConn, setSalesImportConn] = useState<{ id: string; name: string } | null>(null);
  const searchParams = useSearchParams();

  const [showDebug, setShowDebug] = useState(false);
  const [debugConnId, setDebugConnId] = useState('');
  const [debugOrderId, setDebugOrderId] = useState('');
  const [debugLoading, setDebugLoading] = useState(false);
  const [debugResult, setDebugResult] = useState('');

  async function handleDebugOrder() {
    if (!debugConnId || !debugOrderId.trim()) return;
    setDebugLoading(true);
    setDebugResult('');
    try {
      const token = getToken()!;
      const data = await api.marketplace.debugOrder(debugConnId, debugOrderId.trim(), token);
      setDebugResult(JSON.stringify(data, null, 2));
    } catch (err: any) {
      setDebugResult(`Error: ${err.message}`);
    } finally {
      setDebugLoading(false);
    }
  }

  const isSuperAdmin = currentUser?.role === 'SUPER_ADMIN';
  const activeCompanyId = isSuperAdmin ? selectedCompanyId : currentUser?.companyId;

  async function loadConnections(companyId?: string) {
    const token = getToken()!;
    const conns = await api.marketplace.connections(token, companyId).catch(() => []);
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
      loadConnections(selectedCompanyId);
      setShowConnect(false);
      setError('');
    }
  }, [selectedCompanyId, isSuperAdmin]);

  async function handleSaveCredentials() {
    if (!connName.trim() || !connClientId.trim() || !connClientSecret.trim()) return;
    setConnecting(true);
    setError('');
    try {
      const token = getToken()!;
      await api.marketplace.createConnection({
        name: connName.trim(),
        mlClientId: connClientId.trim(),
        mlClientSecret: connClientSecret.trim(),
        ...(isSuperAdmin && activeCompanyId ? { companyId: activeCompanyId } : {}),
      }, token);
      resetConnForm();
      await loadConnections(activeCompanyId || undefined);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setConnecting(false);
    }
  }

  const [authorizingId, setAuthorizingId] = useState<string | null>(null);

  async function handleAuthorize(id: string) {
    setAuthorizingId(id);
    setError('');
    try {
      const token = getToken()!;
      const { authUrl } = await api.marketplace.authorize(id, token);
      window.open(authUrl, '_blank', 'noopener,noreferrer');
    } catch (err: any) {
      setError(err.message || 'No se pudo iniciar la autorización.');
    } finally {
      setAuthorizingId(null);
    }
  }

  function resetConnForm() {
    setShowConnect(false);
    setConnName('');
    setConnClientId('');
    setConnClientSecret('');
    setError('');
  }

  async function handleDelete(id: string, name: string, authorized: boolean) {
    const question = authorized ? `¿Desconectar la tienda "${name}"?` : `¿Eliminar las credenciales de "${name}"?`;
    if (!confirm(question)) return;
    const token = getToken()!;
    await api.marketplace.deleteConnection(id, token);
    await loadConnections(activeCompanyId || undefined);
  }

  const [refreshingId, setRefreshingId] = useState<string | null>(null);

  async function handleRefreshToken(id: string) {
    setRefreshingId(id);
    setError('');
    try {
      const token = getToken()!;
      await api.marketplace.refreshConnection(id, token);
      await loadConnections(activeCompanyId || undefined);
    } catch (err: any) {
      setError(err.message || 'No se pudo renovar el token.');
    } finally {
      setRefreshingId(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 mb-1">
        <a href="/dashboard/ecommerce" className="text-sm text-gray-400 hover:text-gray-600">E-commerce</a>
        <span className="text-gray-300">/</span>
        <span className="text-sm text-gray-600 font-medium">Mercado Libre</span>
      </div>
      <div className="flex items-center gap-3">
        <div className="w-14 h-9 rounded-xl overflow-hidden shrink-0">{Logos.mercadolibre}</div>
        <h1 className="text-2xl font-bold text-gray-900">Mercado Libre</h1>
      </div>

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
            <h2 className="font-semibold text-gray-900">Tiendas</h2>
            <button
              onClick={() => { setShowConnect(!showConnect); setError(''); }}
              className="px-4 py-2 bg-yellow-400 hover:bg-yellow-500 text-gray-900 rounded-lg text-sm font-semibold"
            >
              + Agregar tienda
            </button>
          </div>

          {error && (
            <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
              {error}
            </div>
          )}

          {showConnect && (
            <div className="bg-white rounded-xl border border-gray-200 p-6 mb-4">
              <h3 className="font-semibold text-gray-800 mb-1">Guardar credenciales de Mercado Libre</h3>
              <p className="text-sm text-gray-500 mb-4">
                Cada tienda tiene sus propias credenciales. Se guardan primero y luego autorizas desde la lista
                — así, si algo falla, no tienes que volver a escribirlas.
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
                  onClick={handleSaveCredentials}
                  disabled={connecting || !connName.trim() || !connClientId.trim() || !connClientSecret.trim()}
                  className="px-4 py-2 bg-yellow-400 hover:bg-yellow-500 text-gray-900 rounded-lg text-sm font-semibold disabled:opacity-50"
                >
                  {connecting ? 'Guardando...' : 'Guardar credenciales'}
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
                  const statusLabel = c.authorized && c.active ? 'Autorizada' : c.authorized ? 'Inactiva' : 'Pendiente de autorizar';
                  const statusClass = c.authorized && c.active
                    ? 'bg-green-100 text-green-700'
                    : c.authorized
                      ? 'bg-gray-100 text-gray-500'
                      : 'bg-amber-100 text-amber-700';
                  return (
                    <tr key={c.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 font-medium text-gray-900">{c.name}</td>
                      <td className="px-4 py-3 font-mono text-xs text-gray-400">{c.mlClientId || '—'}</td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusClass}`}>
                          {statusLabel}
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
                      <td className="px-4 py-3 text-right space-x-3">
                        {!c.authorized && (
                          <button onClick={() => handleAuthorize(c.id)}
                            disabled={authorizingId === c.id}
                            className="text-xs text-green-600 hover:text-green-800 font-medium disabled:opacity-50">
                            {authorizingId === c.id ? 'Abriendo...' : 'Autorizar'}
                          </button>
                        )}
                        {c.active && (
                          <>
                            <button onClick={() => setImportConn({ id: c.id, name: c.name })}
                              className="text-xs text-blue-600 hover:text-blue-800 font-medium">
                              Importar publicaciones
                            </button>
                            <button onClick={() => setSalesImportConn({ id: c.id, name: c.name })}
                              className="text-xs text-purple-600 hover:text-purple-800 font-medium">
                              Importar ventas
                            </button>
                            <button onClick={() => handleRefreshToken(c.id)}
                              disabled={refreshingId === c.id}
                              className="text-xs text-amber-600 hover:text-amber-800 font-medium disabled:opacity-50">
                              {refreshingId === c.id ? 'Renovando...' : 'Renovar token'}
                            </button>
                          </>
                        )}
                        <button onClick={() => handleDelete(c.id, c.name, c.authorized)}
                          className="text-xs text-red-500 hover:text-red-700 font-medium">
                          {c.authorized ? 'Desconectar' : 'Eliminar'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {connections.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-10 text-center text-gray-400">
                      <p className="text-sm mb-1">Sin tiendas registradas</p>
                      <p className="text-xs">Haz clic en "+ Agregar tienda" para guardar las credenciales de una cuenta de Mercado Libre.</p>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {importConn && (
        <ImportModal
          connectionId={importConn.id}
          connectionName={importConn.name}
          onClose={() => setImportConn(null)}
          onImported={() => {}}
        />
      )}

      {salesImportConn && (
        <SalesImportModal
          connectionId={salesImportConn.id}
          connectionName={salesImportConn.name}
          onClose={() => setSalesImportConn(null)}
        />
      )}

      {isSuperAdmin && connections.length > 0 && (
        <div className="mt-8 border-t border-gray-200 pt-4">
          <button onClick={() => setShowDebug(!showDebug)}
            className="text-xs text-gray-400 hover:text-gray-600">
            {showDebug ? '▲ Ocultar' : '▼ Consultar'} diagnóstico de una orden puntual
          </button>
          {showDebug && (
            <div className="mt-3 bg-white border border-gray-200 rounded-xl p-4 space-y-3">
              <div className="flex flex-wrap gap-2 items-end">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Tienda</label>
                  <select value={debugConnId} onChange={(e) => setDebugConnId(e.target.value)}
                    className="px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white">
                    <option value="">— Selecciona —</option>
                    {connections.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
                <div className="flex-1 min-w-[220px]">
                  <label className="block text-xs font-medium text-gray-600 mb-1">Número de orden ML (ej. 2000017...)</label>
                  <input value={debugOrderId} onChange={(e) => setDebugOrderId(e.target.value)}
                    placeholder="2000017..."
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                </div>
                <button onClick={handleDebugOrder} disabled={debugLoading || !debugConnId || !debugOrderId.trim()}
                  className="px-4 py-2 bg-gray-800 hover:bg-gray-900 text-white rounded-lg text-sm font-medium disabled:opacity-50">
                  {debugLoading ? 'Consultando...' : 'Consultar'}
                </button>
              </div>
              {debugResult && (
                <pre className="bg-gray-50 border border-gray-200 rounded-lg p-3 text-xs overflow-auto max-h-96 whitespace-pre-wrap">
                  {debugResult}
                </pre>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
