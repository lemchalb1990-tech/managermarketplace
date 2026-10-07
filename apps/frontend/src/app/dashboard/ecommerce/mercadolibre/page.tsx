'use client';

import MlAccountDataRecoveryCard from './MlAccountDataRecoveryCard';
import MlDuplicateListingsCard from './MlDuplicateListingsCard';
import MlAppSetupBox from './MlAppSetupBox';
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { getToken } from '@/lib/auth';
import { api } from '@/lib/api';
import { Logos } from '../components/logos';
import { ImportModal } from './components/ImportModal';
import { SalesImportModal } from './components/SalesImportModal';
import { useAdminCompany } from '../../AdminCompanyContext';
import { usePlatformLogos, resolvePlatformLogo } from '@/lib/platformLogos';
import { useDashboardTimezone } from '@/lib/dashboardTimezone';
import { confirmDialog } from '../../ConfirmDialog';
import { SkeletonList } from '@/components/Skeleton';

export default function MercadoLibrePage() {
  const { selectedCompanyId } = useAdminCompany();
  const tz = useDashboardTimezone();
  const logoMap = usePlatformLogos();
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [connections, setConnections] = useState<any[]>([]);
  const [connectionsLoaded, setConnectionsLoaded] = useState(false);

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

  // Mover a la tienda correcta lo sincronizado con la cuenta de ML equivocada.
  const [transferConns, setTransferConns] = useState<Awaited<ReturnType<typeof api.marketplace.connectionsForTransfer>>>([]);
  const [transferFrom, setTransferFrom] = useState('');
  const [transferTo, setTransferTo] = useState('');
  const [transferLoading, setTransferLoading] = useState(false);
  const [transferReport, setTransferReport] = useState<Awaited<ReturnType<typeof api.marketplace.transferConnectionData>> | null>(null);
  const [transferError, setTransferError] = useState('');

  async function loadTransferConns() {
    try {
      setTransferConns(await api.marketplace.connectionsForTransfer(getToken()!, activeCompanyId || undefined));
    } catch { /* la tarjeta queda vacía */ }
  }

  async function handleTransfer(apply: boolean) {
    if (!transferFrom || !transferTo) return;
    if (apply) {
      const r = transferReport;
      const ok = await confirmDialog(
        `¿Mover de "${r?.from}" a "${r?.to}" ${r?.sales.move ?? 0} venta(s), ${r?.listings.move ?? 0} publicación(es), ` +
        `${r?.questions.move ?? 0} pregunta(s) y ${r?.claims.move ?? 0} reclamo(s)? Solo se mueve lo verificado en Mercado Libre como de la cuenta destino. No se puede deshacer.`,
        { danger: true },
      );
      if (!ok) return;
    }
    setTransferLoading(true);
    setTransferError('');
    try {
      setTransferReport(await api.marketplace.transferConnectionData(transferFrom, transferTo, apply, getToken()!));
      if (apply) await loadTransferConns();
    } catch (err: any) {
      setTransferError(err.message || 'No se pudo revisar la reasignación.');
    } finally {
      setTransferLoading(false);
    }
  }

  // Montos de ventas de carrito: el envío compartido se restaba una vez por orden del pack.
  const [amountsLoading, setAmountsLoading] = useState(false);
  const [amountsReport, setAmountsReport] = useState<Awaited<ReturnType<typeof api.marketplace.recalculatePackAmounts>> | null>(null);
  const [amountsError, setAmountsError] = useState('');

  async function handleRecalculateAmounts(apply: boolean) {
    if (apply) {
      const n = amountsReport?.sales.filter((x) => x.after && !x.error).length || 0;
      if (!(await confirmDialog(`¿Corregir los montos de ${n} venta(s) de carrito con los valores de Mercado Libre (total, comisión, envío y neto) y guardar la comisión de cada producto? No se puede deshacer.`, { danger: true }))) return;
    }
    setAmountsLoading(true);
    setAmountsError('');
    try {
      setAmountsReport(await api.marketplace.recalculatePackAmounts({ companyId: activeCompanyId || undefined, apply }, getToken()!));
    } catch (err: any) {
      setAmountsError(err.message || 'No se pudo revisar los montos.');
    } finally {
      setAmountsLoading(false);
    }
  }

  // Ventas de pack (carrito) con productos sumados de más por el bug de fusión repetida.
  const [repairLoading, setRepairLoading] = useState(false);
  const [repairReport, setRepairReport] = useState<Awaited<ReturnType<typeof api.marketplace.repairPackDuplicates>> | null>(null);
  const [repairError, setRepairError] = useState('');

  async function handleRepairPacks(apply: boolean) {
    if (apply) {
      const n = repairReport?.sales.filter((x) => x.products.length && !x.error).length || 0;
      const ok = await confirmDialog(
        `¿Corregir ${n} venta(s)? Se borran las líneas duplicadas de la venta y de su orden de despacho, se devuelve a bodega el stock descontado de más y se corrige el total. No se puede deshacer.`,
        { danger: true },
      );
      if (!ok) return;
    }
    setRepairLoading(true);
    setRepairError('');
    try {
      const token = getToken()!;
      const saleIds = apply ? repairReport?.sales.filter((x) => x.products.length && !x.error).map((x) => x.saleId) : undefined;
      setRepairReport(await api.marketplace.repairPackDuplicates({ companyId: activeCompanyId || undefined, apply, saleIds }, token));
    } catch (err: any) {
      setRepairError(err.message || 'No se pudo revisar las ventas.');
    } finally {
      setRepairLoading(false);
    }
  }

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
    setConnectionsLoaded(true);
  }

  async function init() {
    const token = getToken();
    if (!token) return;
    const me = await api.me(token);
    setCurrentUser(me);
    if (me.role !== 'SUPER_ADMIN') {
      await loadConnections();
    } else if (!selectedCompanyId) {
      setConnectionsLoaded(true);
    }
  }

  const prevCompanyRef = useRef<string | null>(null);

  useEffect(() => {
    if (connections.length) loadTransferConns();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connections.length, activeCompanyId]);

  useEffect(() => {
    init();
    // Resultado de autorizar una tienda (lo deja la página de retorno de Mercado Libre en la URL).
    const mlError = searchParams.get('mlError');
    const mlConnected = searchParams.get('mlConnected');
    if (mlError) {
      setError(`No se pudo autorizar la tienda: ${mlError}`);
    } else if (mlConnected) {
      const account = searchParams.get('mlAccount');
      const clientId = searchParams.get('mlClientId');
      const verified = searchParams.get('mlVerified') === '1';
      setNotice(
        `Tienda "${mlConnected}" autorizada${account ? ` con la cuenta de Mercado Libre "${account}"` : ''}.` +
        (clientId ? ` Client ID ${clientId} ${verified ? 'verificado: coincide con la aplicación autorizada.' : '(no se pudo verificar contra el token).'}` : ''),
      );
    } else if (searchParams.get('error')) {
      setError('No se pudo conectar la tienda. Verifica las credenciales e intenta nuevamente.');
    }
    if (mlError || mlConnected) window.history.replaceState(null, '', window.location.pathname);
  }, [searchParams]);

  useEffect(() => {
    if (isSuperAdmin && selectedCompanyId) {
      loadConnections(selectedCompanyId);
      setShowConnect(false);
      // Solo al cambiar de empresa: la primera carga conserva el resultado de una autorización.
      if (prevCompanyRef.current && prevCompanyRef.current !== selectedCompanyId) setError('');
      prevCompanyRef.current = selectedCompanyId;
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

  // Al volver a esta pestaña tras autorizar en la ventana de Mercado Libre, refrescamos
  // el estado de las conexiones para reflejar la que quedó autorizada.
  useEffect(() => {
    function onFocus() {
      loadConnections(activeCompanyId || undefined);
    }
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCompanyId]);

  function resetConnForm() {
    setShowConnect(false);
    setConnName('');
    setConnClientId('');
    setConnClientSecret('');
    setError('');
  }

  const [deletingId, setDeletingId] = useState<string | null>(null);

  async function handleDelete(id: string, name: string, authorized: boolean) {
    const question = authorized ? `¿Desconectar la tienda "${name}"?` : `¿Eliminar las credenciales de "${name}"?`;
    if (!(await confirmDialog(question, { danger: true }))) return;
    setDeletingId(id);
    try {
      const token = getToken()!;
      await api.marketplace.deleteConnection(id, token);
      await loadConnections(activeCompanyId || undefined);
    } finally {
      setDeletingId(null);
    }
  }

  const [refreshingId, setRefreshingId] = useState<string | null>(null);
  const [notice, setNotice] = useState('');

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

  const [syncingQuestionsId, setSyncingQuestionsId] = useState<string | null>(null);
  const [syncingClaimsId, setSyncingClaimsId] = useState<string | null>(null);
  const [syncingOrdersId, setSyncingOrdersId] = useState<string | null>(null);

  async function handleSyncQuestions(id: string) {
    setSyncingQuestionsId(id);
    setError('');
    setNotice('');
    try {
      const token = getToken()!;
      const res = await api.marketplace.syncQuestions(id, token);
      setNotice(`${res.synced} pregunta(s) importada(s).`);
    } catch (err: any) {
      setError(err.message || 'No se pudieron importar las preguntas.');
    } finally {
      setSyncingQuestionsId(null);
    }
  }

  async function handleSyncClaims(id: string) {
    setSyncingClaimsId(id);
    setError('');
    setNotice('');
    try {
      const token = getToken()!;
      const res = await api.marketplace.syncClaims(id, token);
      setNotice(`${res.synced} reclamo(s)/devolución(es) importado(s).`);
    } catch (err: any) {
      setError(err.message || 'No se pudieron importar los reclamos y devoluciones.');
    } finally {
      setSyncingClaimsId(null);
    }
  }

  async function handleSyncOrders(id: string) {
    setSyncingOrdersId(id);
    setError('');
    setNotice('');
    try {
      const token = getToken()!;
      const res = await api.marketplace.syncOrderStatuses(id, token);
      setNotice(`${res.checked} orden(es) revisada(s), ${res.updated} actualizada(s).`);
    } catch (err: any) {
      setError(err.message || 'No se pudo sincronizar el estado de las órdenes.');
    } finally {
      setSyncingOrdersId(null);
    }
  }

  // Editar credenciales de una tienda ya creada: solo Super Admin (ver botón "Editar").
  const [editing, setEditing] = useState<{ id: string; name: string; mlClientId: string; mlClientSecret: string } | null>(null);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState('');

  function openEdit(c: { id: string; name: string; mlClientId: string | null }) {
    setEditing({ id: c.id, name: c.name, mlClientId: c.mlClientId || '', mlClientSecret: '' });
    setEditError('');
  }

  async function handleSaveEdit() {
    if (!editing) return;
    setEditSaving(true);
    setEditError('');
    try {
      const token = getToken()!;
      await api.marketplace.updateConnection(editing.id, {
        name: editing.name.trim() || undefined,
        mlClientId: editing.mlClientId.trim() || undefined,
        mlClientSecret: editing.mlClientSecret.trim() || undefined,
      }, token);
      setEditing(null);
      await loadConnections(activeCompanyId || undefined);
    } catch (err: any) {
      setEditError(err.message || 'No se pudo guardar los cambios.');
    } finally {
      setEditSaving(false);
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
        <div className="w-14 h-9 rounded-xl overflow-hidden shrink-0">{resolvePlatformLogo(logoMap, 'mercadolibre', Logos.mercadolibre, 'Mercado Libre')}</div>
        <h1 className="text-[1.375rem] font-bold text-gray-900">Mercado Libre</h1>
      </div>

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

          {notice && (
            <div className="mb-4 px-4 py-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-700">
              {notice}
            </div>
          )}

          {showConnect && (
            <div className="bg-white rounded-xl border border-gray-200 p-6 mb-4">
              <h3 className="font-semibold text-gray-800 mb-1">Guardar credenciales de Mercado Libre</h3>
              <p className="text-sm text-gray-500 mb-4">
                Cada tienda tiene sus propias credenciales. Se guardan primero y luego autorizas desde la lista
                — así, si algo falla, no tienes que volver a escribirlas.
              </p>
              <MlAppSetupBox />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
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

          {!connectionsLoaded ? (
            <SkeletonList count={2} />
          ) : connections.length === 0 ? (
            <div className="bg-white rounded-xl border border-gray-200 px-4 py-10 text-center text-gray-400">
              <p className="text-sm mb-1">Sin tiendas registradas</p>
              <p className="text-xs">Haz clic en "+ Agregar tienda" para guardar las credenciales de una cuenta de Mercado Libre.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {connections.map((c) => {
                const expired = c.expiresAt && new Date(c.expiresAt) < new Date();
                const statusLabel = c.authorized && c.active ? 'Autorizada' : c.authorized ? 'Inactiva' : 'Pendiente de autorizar';
                const statusClass = c.authorized && c.active
                  ? 'bg-green-100 text-green-700'
                  : c.authorized
                    ? 'bg-gray-100 text-gray-500'
                    : 'bg-amber-100 text-amber-700';
                return (
                  <div key={c.id} className="bg-white rounded-xl border border-gray-200 p-4 flex flex-col gap-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-medium text-gray-900 truncate">{c.name}</p>
                        <p className="font-mono text-xs text-gray-400 truncate">{c.mlClientId || '—'}</p>
                        {c.authorized && (
                          <p className="text-xs text-gray-600 truncate" title="Cuenta de Mercado Libre autorizada en esta tienda">
                            Cuenta ML: <strong>{c.mlNickname || c.mlUserId || 'sin identificar'}</strong>
                          </p>
                        )}
                      </div>
                      <span className={`shrink-0 px-2 py-0.5 rounded-full text-xs font-medium ${statusClass}`}>
                        {statusLabel}
                      </span>
                    </div>

                    {c.sharedAccountWith?.length > 0 && (
                      <div className="px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700 space-y-1.5">
                        <p>
                          <strong>Misma cuenta de Mercado Libre que {c.sharedAccountWith.map((n: string) => `"${n}"`).join(', ')}.</strong>{' '}
                          Una de estas tiendas está conectada con la cuenta equivocada y no recibe sus propias ventas, órdenes ni preguntas.
                        </p>
                        <p className="text-red-600">
                          Para corregirla: cierra sesión en Mercado Libre (o usa una ventana de incógnito), inicia sesión con la cuenta
                          correcta de la tienda y presiona &quot;Reconectar cuenta&quot; en la tienda equivocada.
                        </p>
                      </div>
                    )}

                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
                      <span>
                        Token: {c.expiresAt ? (
                          <span className={expired ? 'text-red-500 font-medium' : ''}>
                            {expired ? 'Expirado · ' : ''}{new Date(c.expiresAt).toLocaleDateString('es', { day: '2-digit', month: 'short', year: 'numeric', timeZone: tz })}
                          </span>
                        ) : '—'}
                      </span>
                      <span>Conectada: {new Date(c.createdAt).toLocaleDateString('es', { day: '2-digit', month: 'short', year: 'numeric', timeZone: tz })}</span>
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5 pt-1 border-t border-gray-100">
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
                            className="px-2.5 py-1 rounded-lg text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100">
                            Publicaciones
                          </button>
                          <button onClick={() => setSalesImportConn({ id: c.id, name: c.name })}
                            className="px-2.5 py-1 rounded-lg text-xs font-medium bg-purple-50 text-purple-700 border border-purple-200 hover:bg-purple-100">
                            Ventas
                          </button>
                          <button onClick={() => handleSyncQuestions(c.id)}
                            disabled={syncingQuestionsId === c.id}
                            className="px-2.5 py-1 rounded-lg text-xs font-medium bg-teal-50 text-teal-700 border border-teal-200 hover:bg-teal-100 disabled:opacity-50">
                            {syncingQuestionsId === c.id ? 'Importando...' : 'Preguntas'}
                          </button>
                          <button onClick={() => handleSyncClaims(c.id)}
                            disabled={syncingClaimsId === c.id}
                            className="px-2.5 py-1 rounded-lg text-xs font-medium bg-orange-50 text-orange-700 border border-orange-200 hover:bg-orange-100 disabled:opacity-50">
                            {syncingClaimsId === c.id ? 'Importando...' : 'Devoluciones'}
                          </button>
                          <button onClick={() => handleSyncClaims(c.id)}
                            disabled={syncingClaimsId === c.id}
                            className="px-2.5 py-1 rounded-lg text-xs font-medium bg-rose-50 text-rose-700 border border-rose-200 hover:bg-rose-100 disabled:opacity-50">
                            {syncingClaimsId === c.id ? 'Importando...' : 'Reclamos'}
                          </button>
                          <button onClick={() => handleSyncOrders(c.id)}
                            disabled={syncingOrdersId === c.id}
                            title="Revisa el estado real en ML de las órdenes activas y lo refleja acá (cancelada/en camino/entregada)"
                            className="px-2.5 py-1 rounded-lg text-xs font-medium bg-indigo-50 text-indigo-700 border border-indigo-200 hover:bg-indigo-100 disabled:opacity-50">
                            {syncingOrdersId === c.id ? 'Sincronizando...' : 'Órdenes'}
                          </button>
                          <button onClick={() => handleRefreshToken(c.id)}
                            disabled={refreshingId === c.id}
                            className="text-xs text-amber-600 hover:text-amber-800 font-medium disabled:opacity-50">
                            {refreshingId === c.id ? 'Renovando...' : 'Renovar token'}
                          </button>
                          <button onClick={() => handleAuthorize(c.id)}
                            disabled={authorizingId === c.id}
                            title="Vuelve a autorizar la tienda con la cuenta de Mercado Libre que tengas abierta en el navegador"
                            className={`text-xs font-medium disabled:opacity-50 ${c.sharedAccountWith?.length ? 'text-red-600 hover:text-red-800' : 'text-gray-500 hover:text-gray-700'}`}>
                            {authorizingId === c.id ? 'Abriendo...' : 'Reconectar cuenta'}
                          </button>
                        </>
                      )}
                      {isSuperAdmin && (
                        <button onClick={() => openEdit(c)}
                          className="text-xs text-indigo-500 hover:text-indigo-700 font-medium ml-auto">
                          Editar
                        </button>
                      )}
                      <button onClick={() => handleDelete(c.id, c.name, c.authorized)} disabled={deletingId === c.id}
                        className={`text-xs text-red-500 hover:text-red-700 font-medium disabled:opacity-50 ${isSuperAdmin ? '' : 'ml-auto'}`}>
                        {deletingId === c.id ? 'Eliminando...' : (c.authorized ? 'Desconectar' : 'Eliminar')}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
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

      {editing && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
              <h2 className="font-bold text-gray-900 text-base">Editar tienda</h2>
              <button onClick={() => setEditing(null)} className="text-gray-400 hover:text-gray-600 text-xl leading-none w-8 h-8 flex items-center justify-center">×</button>
            </div>
            <div className="p-6 space-y-3">
              <p className="text-xs text-gray-500">
                Deja el Client Secret en blanco para mantener el actual sin cambiarlo.
              </p>
              <MlAppSetupBox />
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Nombre de la tienda</label>
                <input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Client ID</label>
                <input value={editing.mlClientId} onChange={(e) => setEditing({ ...editing, mlClientId: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Client Secret</label>
                <input type="password" value={editing.mlClientSecret}
                  onChange={(e) => setEditing({ ...editing, mlClientSecret: e.target.value })}
                  placeholder="•••••••• (sin cambios)"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
              </div>
              {editError && (
                <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{editError}</p>
              )}
            </div>
            <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-2">
              <button onClick={() => setEditing(null)} className="px-4 py-2 border border-gray-300 text-gray-600 rounded-lg text-sm hover:bg-gray-50">
                Cancelar
              </button>
              <button onClick={handleSaveEdit} disabled={editSaving}
                className="px-4 py-2 bg-yellow-400 hover:bg-yellow-500 text-gray-900 rounded-lg text-sm font-semibold disabled:opacity-50">
                {editSaving ? 'Guardando...' : 'Guardar cambios'}
              </button>
            </div>
          </div>
        </div>
      )}

      {isSuperAdmin && connections.length > 0 && (
        <>
        <div className="mt-8 bg-white border border-violet-200 rounded-xl p-4 space-y-3">
          <div>
            <p className="text-sm font-medium text-gray-800">Mover datos a la tienda correcta</p>
            <p className="text-xs text-gray-500">
              Si una tienda estuvo conectada con la cuenta de Mercado Libre de otra, lo que sincronizó (ventas con su orden,
              publicaciones, preguntas y reclamos) es de esa otra tienda. Cada registro se verifica en Mercado Libre con la
              cuenta destino; lo que no sea de esa cuenta no se mueve. &quot;Revisar&quot; no cambia nada.
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_1fr_auto] gap-2 items-end">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Desde (tienda con datos equivocados)</label>
              <select value={transferFrom} onChange={(e) => { setTransferFrom(e.target.value); setTransferReport(null); }}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white">
                <option value="">— Selecciona —</option>
                {transferConns.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}{c.active ? '' : ' (desconectada)'}{c.mlNickname ? ` · ${c.mlNickname}` : ''} — {c.counts.sales} ventas, {c.counts.listings} publ.
                  </option>
                ))}
              </select>
            </div>
            <span className="hidden sm:block pb-2 text-gray-400">→</span>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Hacia (tienda dueña de la cuenta)</label>
              <select value={transferTo} onChange={(e) => { setTransferTo(e.target.value); setTransferReport(null); }}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white">
                <option value="">— Selecciona —</option>
                {transferConns.filter((c) => c.active && c.authorized && c.id !== transferFrom).map((c) => (
                  <option key={c.id} value={c.id}>{c.name}{c.mlNickname ? ` · ${c.mlNickname}` : ''}</option>
                ))}
              </select>
            </div>
            <div className="flex gap-2">
              <button onClick={() => handleTransfer(false)} disabled={transferLoading || !transferFrom || !transferTo}
                className="px-3 py-2 border border-gray-300 rounded-lg text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">
                {transferLoading ? 'Revisando...' : 'Revisar'}
              </button>
              {transferReport && !transferReport.applied && (transferReport.sales.move + transferReport.listings.move + transferReport.listings.alreadyInDestination + transferReport.questions.move + transferReport.claims.move) > 0 && (
                <button onClick={() => handleTransfer(true)} disabled={transferLoading}
                  className="px-3 py-2 bg-violet-600 hover:bg-violet-700 text-white rounded-lg text-xs font-semibold disabled:opacity-50">
                  Mover
                </button>
              )}
            </div>
          </div>
          {transferError && <p className="text-xs text-red-600">{transferError}</p>}
          {transferReport && (
            <div className="text-xs text-gray-700 bg-gray-50 border border-gray-200 rounded-lg p-3 space-y-1">
              <p className="font-medium">
                {transferReport.applied ? '✓ Movido' : 'Se movería'} de &quot;{transferReport.from}&quot; a &quot;{transferReport.to}&quot;
                {transferReport.toAccount && ` (cuenta ${transferReport.toAccount})`}:
              </p>
              <p>Ventas (con su orden): {transferReport.sales.move} de {transferReport.sales.total}
                {transferReport.sales.notVerified.length > 0 && ` · no son de esa cuenta: ${transferReport.sales.notVerified.join(', ')}`}</p>
              <p>Publicaciones: {transferReport.listings.move} de {transferReport.listings.total}
                {transferReport.listings.alreadyInDestination > 0 && ` · ${transferReport.listings.alreadyInDestination} ya estaban vinculadas en la tienda destino (se quita el duplicado)`}
                {transferReport.listings.notFromThisAccount > 0 && ` · ${transferReport.listings.notFromThisAccount} no son de esa cuenta`}</p>
              {transferReport.listings.conflicts.length > 0 && (
                <p className="text-amber-700">Sin mover por conflicto (el producto o la publicación ya está vinculada distinto en la tienda destino): {transferReport.listings.conflicts.join('; ')}</p>
              )}
              <p>Preguntas: {transferReport.questions.move} de {transferReport.questions.total} · Reclamos: {transferReport.claims.move} de {transferReport.claims.total}</p>
            </div>
          )}
        </div>

        <div className="mt-4 bg-white border border-sky-200 rounded-xl p-4 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-medium text-gray-800 mr-auto">Montos de ventas de carrito, Flex y con cupón</p>
            <button onClick={() => handleRecalculateAmounts(false)} disabled={amountsLoading}
              className="px-3 py-1.5 border border-gray-300 rounded-lg text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">
              {amountsLoading ? 'Revisando...' : 'Revisar'}
            </button>
            {amountsReport && !amountsReport.applied && amountsReport.sales.some((x) => x.after && !x.error) && (
              <button onClick={() => handleRecalculateAmounts(true)} disabled={amountsLoading}
                className="px-3 py-1.5 bg-sky-600 hover:bg-sky-700 text-white rounded-lg text-xs font-semibold disabled:opacity-50">
                Corregir
              </button>
            )}
          </div>
          <p className="text-xs text-gray-500">
            Compara cada venta de carrito o con envío Flex con los valores de Mercado Libre (comisión por producto, costo del
            envío —uno solo por carrito—, bonificación de envío Flex y cupones que paga ML) y corrige total, comisión, envío y neto. &quot;Revisar&quot; no cambia nada.
          </p>
          {amountsError && <p className="text-xs text-red-600">{amountsError}</p>}
          {amountsReport && (
            <div className="text-xs space-y-1.5">
              <p className="text-gray-600">
                {amountsReport.applied ? 'Corregidas' : 'Revisadas'}: {amountsReport.checked} venta(s) de carrito · {amountsReport.affected} con diferencias.
              </p>
              {amountsReport.sales.map((x) => (
                <div key={x.saleId} className="border border-gray-200 rounded-lg p-2">
                  <div className="flex flex-wrap gap-x-3">
                    {x.orderId ? (
                      <a href={`/dashboard/orders/${x.orderId}`} className="font-medium text-blue-600 hover:underline">Orden #{x.mlOrderId}</a>
                    ) : <span className="font-medium">Orden #{x.mlOrderId}</span>}
                    {x.packId && <span className="text-gray-400">pack {x.packId}</span>}
                    {x.fixed && <span className="text-green-700 font-medium">✓ Corregida</span>}
                    {x.error && <span className="text-red-600">{x.error}</span>}
                  </div>
                  {x.after && (
                    <p className="text-gray-600 mt-0.5">
                      Comisión ${Math.round(x.before.fee ?? 0).toLocaleString('es-CL')} → ${Math.round(x.after.fee).toLocaleString('es-CL')}
                      {' · '}Envío ${Math.round(x.before.shipping ?? 0).toLocaleString('es-CL')} → ${Math.round(x.after.shipping).toLocaleString('es-CL')}
                      {' · '}Neto ${Math.round(x.before.net ?? 0).toLocaleString('es-CL')} → <b>${Math.round(x.after.net).toLocaleString('es-CL')}</b>
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <MlDuplicateListingsCard companyId={activeCompanyId || undefined} />
        <MlAccountDataRecoveryCard companyId={activeCompanyId || undefined} />

        <div className="mt-4 bg-white border border-amber-200 rounded-xl p-4 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-medium text-gray-800 mr-auto">Ventas de carrito (pack) con productos duplicados</p>
              <button onClick={() => handleRepairPacks(false)} disabled={repairLoading}
                className="px-3 py-1.5 border border-gray-300 rounded-lg text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">
                {repairLoading ? 'Revisando...' : 'Revisar'}
              </button>
              {repairReport && !repairReport.applied && repairReport.sales.some((x) => x.products.length && !x.error) && (
                <button onClick={() => handleRepairPacks(true)} disabled={repairLoading}
                  className="px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded-lg text-xs font-semibold disabled:opacity-50">
                  Corregir
                </button>
              )}
            </div>
            <p className="text-xs text-gray-500">
              Compara cada venta de carrito con lo que informa Mercado Libre. "Revisar" no cambia nada.
            </p>
            {repairError && <p className="text-xs text-red-600">{repairError}</p>}
            {repairReport && (
              <div className="text-xs space-y-2">
                <p className="text-gray-600">
                  {repairReport.applied ? 'Corregidas' : 'Revisadas'}: {repairReport.checked} venta(s) con productos repetidos · {repairReport.affected} con diferencias.
                </p>
                {repairReport.sales.map((x) => (
                  <div key={x.saleId} className="border border-gray-200 rounded-lg p-2">
                    <div className="flex flex-wrap gap-x-3 gap-y-1">
                      {x.orderId ? (
                        <a href={`/dashboard/orders/${x.orderId}`} className="font-medium text-blue-600 hover:underline">Orden #{x.mlOrderId}</a>
                      ) : <span className="font-medium">Orden #{x.mlOrderId}</span>}
                      {x.totalAfter != null && (
                        <span className="text-gray-600">
                          Total ${Math.round(x.totalBefore).toLocaleString('es-CL')} → ${Math.round(x.totalAfter).toLocaleString('es-CL')}
                        </span>
                      )}
                      {x.fixed && <span className="text-green-700 font-medium">✓ Corregida</span>}
                      {x.error && <span className="text-red-600">{x.error}</span>}
                    </div>
                    {x.products.map((pr) => (
                      <p key={pr.productId} className="text-gray-600 mt-0.5">
                        {pr.name} ({pr.sku}): registradas {pr.registered}, reales {pr.real} — se devuelven {pr.stockToReturn} un. a bodega
                      </p>
                    ))}
                  </div>
                ))}
              </div>
            )}
        </div>
        <div className="mt-6 border-t border-gray-200 pt-4">
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
        </>
      )}
    </div>
  );
}
