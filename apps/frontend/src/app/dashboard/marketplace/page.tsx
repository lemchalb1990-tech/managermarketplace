'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { getToken } from '@/lib/auth';
import { api } from '@/lib/api';

export default function MarketplacePage() {
  const [connections, setConnections] = useState<any[]>([]);
  const [settings, setSettings] = useState<{ mlClientId: string | null; hasSecret: boolean } | null>(null);
  const [creds, setCreds] = useState({ mlClientId: '', mlClientSecret: '' });
  const [savingCreds, setSavingCreds] = useState(false);
  const [credsError, setCredsError] = useState('');
  const [credsOk, setCredsOk] = useState(false);

  const [showConnect, setShowConnect] = useState(false);
  const [connName, setConnName] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState('');
  const searchParams = useSearchParams();

  async function load() {
    const token = getToken();
    if (!token) return;
    const [conns, cfg] = await Promise.all([
      api.marketplace.connections(token).catch(() => []),
      api.marketplace.getSettings(token).catch(() => null),
    ]);
    setConnections(conns);
    setSettings(cfg);
    if (cfg?.mlClientId) setCreds(c => ({ ...c, mlClientId: cfg.mlClientId! }));
  }

  useEffect(() => {
    load();
    if (searchParams.get('error')) setError('No se pudo conectar la cuenta. Verifica tus credenciales e intenta nuevamente.');
  }, [searchParams]);

  async function handleSaveCreds() {
    if (!creds.mlClientId || !creds.mlClientSecret) return;
    setSavingCreds(true);
    setCredsError('');
    setCredsOk(false);
    try {
      const token = getToken()!;
      await api.marketplace.saveCredentials({ mlClientId: creds.mlClientId, mlClientSecret: creds.mlClientSecret }, token);
      setCredsOk(true);
      await load();
    } catch (err: any) {
      setCredsError(err.message);
    } finally {
      setSavingCreds(false);
    }
  }

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

  const credentialsConfigured = settings?.mlClientId && settings?.hasSecret;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Mercado Libre</h1>

      {/* ── Credenciales de la app ── */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h2 className="font-semibold text-gray-900">Credenciales de la aplicación</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              Obtén el Client ID y Secret en{' '}
              <a href="https://developers.mercadolibre.cl/es_ar/registra-tu-aplicacion" target="_blank" rel="noopener noreferrer"
                className="text-blue-500 hover:underline">
                developers.mercadolibre.cl
              </a>
            </p>
          </div>
          {credentialsConfigured && (
            <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">Configurado</span>
          )}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Client ID *</label>
            <input value={creds.mlClientId} onChange={(e) => setCreds(c => ({ ...c, mlClientId: e.target.value }))}
              placeholder="Ej: 123456789"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              Client Secret * {settings?.hasSecret && <span className="text-gray-400 font-normal">(ya configurado — ingresa para reemplazar)</span>}
            </label>
            <input type="password" value={creds.mlClientSecret}
              onChange={(e) => setCreds(c => ({ ...c, mlClientSecret: e.target.value }))}
              placeholder={settings?.hasSecret ? '••••••••' : 'Pega tu Client Secret aquí'}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
          </div>
        </div>

        {credsError && <p className="text-red-600 text-sm mt-3">{credsError}</p>}
        {credsOk && <p className="text-green-600 text-sm mt-3">Credenciales guardadas correctamente.</p>}

        <div className="mt-4">
          <button onClick={handleSaveCreds} disabled={savingCreds || !creds.mlClientId || !creds.mlClientSecret}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium disabled:opacity-40">
            {savingCreds ? 'Guardando...' : 'Guardar credenciales'}
          </button>
        </div>
      </div>

      {/* ── Cuentas conectadas ── */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-gray-900">Cuentas conectadas</h2>
          <button
            onClick={() => { setShowConnect(!showConnect); setError(''); }}
            disabled={!credentialsConfigured}
            title={!credentialsConfigured ? 'Primero guarda las credenciales de la aplicación' : ''}
            className="px-4 py-2 bg-yellow-400 hover:bg-yellow-500 text-gray-900 rounded-lg text-sm font-semibold disabled:opacity-40 disabled:cursor-not-allowed">
            + Conectar cuenta
          </button>
        </div>

        {error && (
          <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
            {error}
          </div>
        )}

        {showConnect && (
          <div className="bg-white rounded-xl border border-gray-200 p-6 mb-4">
            <h3 className="font-semibold text-gray-800 mb-1">Conectar cuenta de Mercado Libre</h3>
            <p className="text-sm text-gray-500 mb-4">
              Ingresa un nombre para identificar esta cuenta. Serás redirigido a Mercado Libre para autorizar el acceso.
            </p>
            <div className="flex gap-3">
              <input value={connName} onChange={(e) => setConnName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleConnect()}
                placeholder="Ej: Tienda principal, Cuenta dropshipping..."
                className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm" />
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
                    <p className="text-xs">
                      {credentialsConfigured
                        ? 'Haz clic en "+ Conectar cuenta" para vincular una cuenta de Mercado Libre.'
                        : 'Primero guarda las credenciales de la aplicación arriba.'}
                    </p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
