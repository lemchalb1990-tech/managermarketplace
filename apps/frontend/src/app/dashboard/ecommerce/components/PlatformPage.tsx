'use client';

import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { getToken } from '@/lib/auth';
import { api } from '@/lib/api';
import { useAdminCompany } from '../../AdminCompanyContext';
import { usePlatformLogos, resolvePlatformLogo, resolvePlatformName, resolvePlatformDescription } from '@/lib/platformLogos';
import { useDashboardTimezone } from '@/lib/dashboardTimezone';
import { confirmDialog, alertDialog } from '../../ConfirmDialog';
import { ChannelImportModal } from './ChannelImportModal';
import { ChannelSalesImportModal } from './ChannelSalesImportModal';
import { SkeletonRows } from '@/components/Skeleton';

export interface PlatformField {
  key: string;
  label: string;
  type?: 'text' | 'password' | 'url';
  placeholder?: string;
  hint?: string;
  required?: boolean;
}

export interface PlatformConfig {
  marketplace: string;
  name: string;
  description: string;
  moduleKey: string;
  color: string;
  logo?: React.ReactNode;
  logoText?: string;
  logoBg?: string;
  logoTextColor?: string;
  fields: PlatformField[];
  supportsPublish?: boolean;
  // Habilita el botón "Importar catálogo" por conexión (traer productos ya publicados en
  // la plataforma y unificarlos con el catálogo interno). Hoy solo implementado para Paris.
  supportsImport?: boolean;
  // Habilita el botón "Importar ventas" por conexión (traer historial de ventas ya
  // realizadas en la plataforma). Hoy solo implementado para Paris.
  supportsSalesImport?: boolean;
  // Habilita el check "Enviar boleta/factura" por conexión: cuando está activo, cada DTE
  // emitido en Facturación para una venta de este canal se reenvía automáticamente a la
  // plataforma (algunas, como Falabella y Ripley, exigen adjuntar el documento tributario
  // del cliente final a la orden original). Ver BillingService.pushInvoiceToMarketplace.
  supportsInvoicePush?: boolean;
  // Habilita el botón "Órdenes": revisa ahora (sin esperar al auto-sync) el estado de despacho
  // en la plataforma de las órdenes abiertas y lo refleja en la Orden interna.
  supportsOrderSync?: boolean;
  // Muestra las acciones por conexión como botones con los mismos nombres que Mercado Libre
  // (Publicaciones / Ventas / Órdenes) en vez de los links de texto.
  mlStyleActions?: boolean;
  // Botón "Traer fotos": completa las fotos de los productos importados que no tienen
  // (hoy Walmart, cuyo listado de publicaciones no trae imágenes).
  supportsImageFetch?: boolean;
  helpText?: string;
}

interface Props {
  config: PlatformConfig;
}

export default function PlatformPage({ config }: Props) {
  const { selectedCompanyId } = useAdminCompany();
  const tz = useDashboardTimezone();
  const logoMap = usePlatformLogos();
  const logoKey = config.marketplace.toLowerCase();
  const displayName = resolvePlatformName(logoMap, logoKey, config.name);
  const displayDescription = resolvePlatformDescription(logoMap, logoKey, config.description);
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [connections, setConnections] = useState<any[]>([]);
  const [connectionsLoaded, setConnectionsLoaded] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [formName, setFormName] = useState('');
  const [formFields, setFormFields] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const searchParams = useSearchParams();

  const [editing, setEditing] = useState<{ id: string; name: string; fields: Record<string, string> } | null>(null);
  const [editLoading, setEditLoading] = useState(false);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState('');
  const [testingId, setTestingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [importingConn, setImportingConn] = useState<{ id: string; name: string } | null>(null);
  const [salesImportConn, setSalesImportConn] = useState<{ id: string; name: string } | null>(null);
  const [invoicePushSavingId, setInvoicePushSavingId] = useState<string | null>(null);
  const [syncingOrdersId, setSyncingOrdersId] = useState<string | null>(null);
  const [notice, setNotice] = useState('');

  const isSuperAdmin = currentUser?.role === 'SUPER_ADMIN';
  const activeCompanyId = isSuperAdmin ? selectedCompanyId : currentUser?.companyId;

  async function loadConnections(companyId?: string) {
    const token = getToken()!;
    const data = await api.connections.list(token, {
      marketplace: config.marketplace,
      companyId: companyId || undefined,
    }).catch(() => []);
    setConnections(data);
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

  useEffect(() => { init(); }, [searchParams]);

  useEffect(() => {
    if (isSuperAdmin && selectedCompanyId) {
      loadConnections(selectedCompanyId);
      setShowForm(false);
      setError('');
    }
  }, [selectedCompanyId, isSuperAdmin]);

  function resetForm() {
    setShowForm(false);
    setFormName('');
    setFormFields({});
    setError('');
  }

  async function handleConnect() {
    const missing = config.fields.filter(f => f.required !== false && !formFields[f.key]?.trim());
    if (!formName.trim() || missing.length > 0) {
      setError('Completa todos los campos requeridos');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const token = getToken()!;
      await api.connections.create({
        marketplace: config.marketplace,
        name: formName.trim(),
        credentials: formFields,
        ...(isSuperAdmin && activeCompanyId ? { companyId: activeCompanyId } : {}),
      }, token);
      resetForm();
      await loadConnections(activeCompanyId || undefined);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete(id: string, name: string) {
    if (!(await confirmDialog(`¿Desconectar "${name}"?`, { danger: true }))) return;
    setDeletingId(id);
    try {
      const token = getToken()!;
      await api.connections.remove(id, token);
      await loadConnections(activeCompanyId || undefined);
    } finally {
      setDeletingId(null);
    }
  }

  // Editar credenciales de una conexión ya creada: solo Super Admin (ver botón "Editar").
  async function openEdit(c: { id: string; name: string }) {
    setEditLoading(true);
    setEditError('');
    try {
      const token = getToken()!;
      const conn = await api.connections.get(c.id, token);
      const fields: Record<string, string> = {};
      for (const f of config.fields) {
        fields[f.key] = f.type === 'password' ? '' : (conn.credentials?.[f.key] || '');
      }
      setEditing({ id: c.id, name: c.name, fields });
    } catch (err: any) {
      await alertDialog(err.message || 'No se pudo cargar la conexión.');
    } finally {
      setEditLoading(false);
    }
  }

  async function handleSaveEdit() {
    if (!editing) return;
    setEditSaving(true);
    setEditError('');
    try {
      const token = getToken()!;
      const credentials: Record<string, string> = {};
      for (const f of config.fields) {
        const v = editing.fields[f.key];
        if (v?.trim()) credentials[f.key] = v.trim();
      }
      await api.connections.update(editing.id, {
        name: editing.name.trim() || undefined,
        credentials: Object.keys(credentials).length ? credentials : undefined,
      }, token);
      setEditing(null);
      await loadConnections(activeCompanyId || undefined);
    } catch (err: any) {
      setEditError(err.message || 'No se pudo guardar. Revisa las credenciales.');
    } finally {
      setEditSaving(false);
    }
  }

  async function handleTest(id: string) {
    setTestingId(id);
    try {
      const token = getToken()!;
      const result = await api.connections.test(id, token).catch((e) => ({ success: false, message: e.message }));
      await alertDialog(result.success ? `✓ ${result.message || 'Conexión exitosa'}` : `✗ ${result.message || 'Error de conexión'}`);
    } finally {
      setTestingId(null);
    }
  }

  async function handleToggleInvoicePush(id: string, current: boolean) {
    setInvoicePushSavingId(id);
    try {
      const token = getToken()!;
      await api.connections.setInvoicePush(id, !current, token);
      await loadConnections(activeCompanyId || undefined);
    } catch (err: any) {
      await alertDialog(err.message || 'No se pudo actualizar el envío de boleta/factura.');
    } finally {
      setInvoicePushSavingId(null);
    }
  }

  const [fetchingImagesId, setFetchingImagesId] = useState<string | null>(null);

  async function handleFetchImages(id: string) {
    setFetchingImagesId(id);
    setError('');
    setNotice('');
    try {
      const res = await api.connections.fetchMissingImages(id, getToken()!);
      setNotice(
        `${res.checked} producto(s) sin fotos revisados: ${res.updated} con fotos nuevas` +
        (res.withoutImages ? `, ${res.withoutImages} sin fotos disponibles en ${config.name}` : '') +
        (res.pending ? '. Quedan más: presiona de nuevo para continuar.' : '.'),
      );
    } catch (err: any) {
      setError(err.message || 'No se pudieron traer las fotos.');
    } finally {
      setFetchingImagesId(null);
    }
  }

  async function handleSyncOrders(id: string) {
    setSyncingOrdersId(id);
    setError('');
    setNotice('');
    try {
      const token = getToken()!;
      const res = await api.connections.syncOrderStatuses(id, token);
      setNotice(`${res.checked} orden(es) revisada(s), ${res.updated} actualizada(s).`);
    } catch (err: any) {
      setError(err.message || 'No se pudo sincronizar el estado de las órdenes.');
    } finally {
      setSyncingOrdersId(null);
    }
  }

  const showContent = !isSuperAdmin || selectedCompanyId;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 mb-1">
        <a href="/dashboard/ecommerce" className="text-sm text-gray-400 hover:text-gray-600">E-commerce</a>
        <span className="text-gray-300">/</span>
        <span className="text-sm text-gray-600 font-medium">{displayName}</span>
      </div>

      <div className="flex items-center gap-3">
        <div className="w-14 h-9 rounded-xl overflow-hidden shrink-0">
          {resolvePlatformLogo(logoMap, logoKey, config.logo ?? (
            <div className="w-full h-full rounded-xl flex items-center justify-center text-xs font-bold"
              style={{ background: config.logoBg, color: config.logoTextColor }}>
              {config.logoText}
            </div>
          ), displayName)}
        </div>
        <div>
          <h1 className="ui-page-title">{displayName}</h1>
          <p className="ui-page-subtitle">{displayDescription}</p>
        </div>
      </div>

      {isSuperAdmin && !selectedCompanyId ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center text-gray-400">
          <p className="text-sm">Selecciona una empresa para gestionar sus conexiones de {config.name}.</p>
        </div>
      ) : (
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="ui-section-title">Conexiones activas</h2>
            <button onClick={() => { setShowForm(!showForm); setError(''); }}
              className="px-4 py-2 rounded-lg text-sm font-semibold text-white"
              style={{ background: config.color }}>
              + Conectar tienda
            </button>
          </div>

          {error && (
            <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{error}</div>
          )}

          {notice && (
            <div className="mb-4 px-4 py-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-700">{notice}</div>
          )}

          {showForm && (
            <div className="bg-white rounded-xl border border-gray-200 p-6 mb-4">
              <h3 className="ui-section-title mb-1">Conectar tienda de {config.name}</h3>
              {config.helpText && <p className="text-xs text-gray-500 mb-4">{config.helpText}</p>}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-gray-600 mb-1">Nombre de la conexión *</label>
                  <input value={formName} onChange={(e) => setFormName(e.target.value)}
                    placeholder="Ej: Tienda principal"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                </div>
                {config.fields.map((field) => (
                  <div key={field.key} className={config.fields.length === 1 ? 'col-span-2' : ''}>
                    <label className="block text-xs font-medium text-gray-600 mb-1">
                      {field.label} {field.required !== false ? '*' : ''}
                    </label>
                    <input
                      type={field.type || 'text'}
                      value={formFields[field.key] || ''}
                      onChange={(e) => setFormFields(f => ({ ...f, [field.key]: e.target.value }))}
                      placeholder={field.placeholder}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                    />
                    {field.hint && <p className="text-xs text-gray-400 mt-0.5">{field.hint}</p>}
                  </div>
                ))}
              </div>
              <div className="flex gap-2">
                <button onClick={handleConnect} disabled={loading}
                  className="px-4 py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-50"
                  style={{ background: config.color }}>
                  {loading ? 'Conectando...' : 'Guardar y conectar'}
                </button>
                <button onClick={resetForm}
                  className="px-4 py-2 border border-gray-300 text-gray-600 rounded-lg text-sm hover:bg-gray-50">
                  Cancelar
                </button>
              </div>
            </div>
          )}

          <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-left px-4 py-3 text-gray-600 font-medium">Nombre</th>
                  <th className="text-left px-4 py-3 text-gray-600 font-medium">Plataforma</th>
                  <th className="text-left px-4 py-3 text-gray-600 font-medium">Estado</th>
                  <th className="text-left px-4 py-3 text-gray-600 font-medium">Conectada</th>
                  {config.supportsInvoicePush && (
                    <th className="text-left px-4 py-3 text-gray-600 font-medium">Boleta/Factura</th>
                  )}
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {connections.map((c) => (
                  <tr key={c.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-900">{c.name}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs">{c.marketplace}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${c.active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                        {c.active ? 'Activa' : 'Inactiva'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-500 text-xs">
                      {new Date(c.createdAt).toLocaleDateString('es', { day: '2-digit', month: 'short', year: 'numeric', timeZone: tz })}
                    </td>
                    {config.supportsInvoicePush && (
                      <td className="px-4 py-3">
                        <button
                          onClick={() => handleToggleInvoicePush(c.id, !!c.sendInvoiceToPlatform)}
                          disabled={invoicePushSavingId === c.id || !c.active}
                          title={c.active ? 'Envía automáticamente el DTE emitido a la orden en la plataforma' : 'Activa la conexión para poder usar esta opción'}
                          className={`px-2 py-0.5 rounded-full text-xs font-medium disabled:opacity-50 ${
                            c.sendInvoiceToPlatform ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                          }`}
                        >
                          {invoicePushSavingId === c.id ? '...' : c.sendInvoiceToPlatform ? 'Activado' : 'Desactivado'}
                        </button>
                      </td>
                    )}
                    <td className="px-4 py-3 text-right flex flex-wrap items-center gap-3 justify-end">
                      {isSuperAdmin && (
                        <button onClick={() => openEdit(c)} disabled={editLoading}
                          className="text-xs text-indigo-500 hover:text-indigo-700 font-medium disabled:opacity-50">
                          Editar
                        </button>
                      )}
                      {config.supportsImport && c.active && (
                        <button onClick={() => setImportingConn({ id: c.id, name: c.name })}
                          className={config.mlStyleActions
                            ? 'px-2.5 py-1 rounded-lg text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100'
                            : 'text-xs text-blue-500 hover:text-blue-700 font-medium'}>
                          {config.mlStyleActions ? 'Publicaciones' : 'Importar catálogo'}
                        </button>
                      )}
                      {config.supportsSalesImport && c.active && (
                        <button onClick={() => setSalesImportConn({ id: c.id, name: c.name })}
                          className={config.mlStyleActions
                            ? 'px-2.5 py-1 rounded-lg text-xs font-medium bg-purple-50 text-purple-700 border border-purple-200 hover:bg-purple-100'
                            : 'text-xs text-blue-500 hover:text-blue-700 font-medium'}>
                          {config.mlStyleActions ? 'Ventas' : 'Importar ventas'}
                        </button>
                      )}
                      {config.supportsImageFetch && c.active && (
                        <button onClick={() => handleFetchImages(c.id)} disabled={fetchingImagesId === c.id}
                          title={config.marketplace === 'RIPLEY' ? 'Completa las fotos de los productos de Ripley que no tienen, buscándolas en el catálogo, en los reportes de Ripley, Falabella y Paris' : `Busca en ${config.name} las fotos de los productos importados que no tienen`}
                          className="text-xs text-blue-500 hover:text-blue-700 font-medium disabled:opacity-50">
                          {fetchingImagesId === c.id ? 'Buscando fotos...' : 'Traer fotos'}
                        </button>
                      )}
                      {config.supportsOrderSync && c.active && (
                        <button onClick={() => handleSyncOrders(c.id)} disabled={syncingOrdersId === c.id}
                          title={`Revisa el estado real en ${config.name} de las órdenes activas y lo refleja acá (cancelada/en camino/entregada)`}
                          className={config.mlStyleActions
                            ? 'px-2.5 py-1 rounded-lg text-xs font-medium bg-indigo-50 text-indigo-700 border border-indigo-200 hover:bg-indigo-100 disabled:opacity-50'
                            : 'text-xs text-blue-500 hover:text-blue-700 font-medium disabled:opacity-50'}>
                          {syncingOrdersId === c.id ? 'Sincronizando...' : 'Órdenes'}
                        </button>
                      )}
                      <button onClick={() => handleTest(c.id)} disabled={testingId === c.id}
                        className="text-xs text-blue-500 hover:text-blue-700 font-medium disabled:opacity-50">
                        {testingId === c.id ? 'Probando...' : 'Probar'}
                      </button>
                      <button onClick={() => handleDelete(c.id, c.name)} disabled={deletingId === c.id}
                        className="text-xs text-red-500 hover:text-red-700 font-medium disabled:opacity-50">
                        {deletingId === c.id ? 'Desconectando...' : 'Desconectar'}
                      </button>
                    </td>
                  </tr>
                ))}
                {!connectionsLoaded && <SkeletonRows cols={config.supportsInvoicePush ? 6 : 5} rows={3} />}
                {connectionsLoaded && connections.length === 0 && (
                  <tr>
                    <td colSpan={config.supportsInvoicePush ? 6 : 5} className="px-4 py-10 text-center text-gray-400">
                      <p className="text-sm mb-1">Sin conexiones</p>
                      <p className="text-xs">Haz clic en "+ Conectar tienda" para vincular tu cuenta de {config.name}.</p>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {config.supportsInvoicePush && (
            <div className="mt-4 px-4 py-3 bg-blue-50 border border-blue-200 rounded-lg text-xs text-blue-700">
              <strong>Boleta/Factura:</strong> con "Activado", cada boleta o factura que emitas en Facturación para una
              venta de este canal se reenvía automáticamente a {config.name}, asociándola a la orden original —
              varias plataformas lo exigen para que el cliente reciba su documento tributario.
            </div>
          )}

          {config.supportsPublish === false && (
            <div className="mt-4 px-4 py-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-700">
              <strong>Nota:</strong> La sincronización automática de stock y precios con {config.name} estará disponible próximamente.
              Por ahora, puedes registrar las credenciales y el sistema actualizará cuando se active la integración.
            </div>
          )}
        </div>
      )}

      {editing && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
              <h2 className="ui-section-title">Editar conexión de {config.name}</h2>
              <button onClick={() => setEditing(null)} className="text-gray-400 hover:text-gray-600 text-xl leading-none w-8 h-8 flex items-center justify-center">×</button>
            </div>
            <div className="p-6 space-y-3">
              <p className="text-xs text-gray-500">
                Deja en blanco un campo sensible (contraseña/token) para mantener el valor actual sin cambiarlo.
              </p>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Nombre de la conexión</label>
                <input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
              </div>
              {config.fields.map((field) => (
                <div key={field.key}>
                  <label className="block text-xs font-medium text-gray-600 mb-1">{field.label}</label>
                  <input
                    type={field.type || 'text'}
                    value={editing.fields[field.key] || ''}
                    onChange={(e) => setEditing({ ...editing, fields: { ...editing.fields, [field.key]: e.target.value } })}
                    placeholder={field.type === 'password' ? '•••••••• (sin cambios)' : field.placeholder}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  />
                  {field.hint && <p className="text-xs text-gray-400 mt-0.5">{field.hint}</p>}
                </div>
              ))}
              {editError && (
                <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{editError}</p>
              )}
            </div>
            <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-2">
              <button onClick={() => setEditing(null)} className="px-4 py-2 border border-gray-300 text-gray-600 rounded-lg text-sm hover:bg-gray-50">
                Cancelar
              </button>
              <button onClick={handleSaveEdit} disabled={editSaving}
                className="px-4 py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-50"
                style={{ background: config.color }}>
                {editSaving ? 'Guardando...' : 'Guardar cambios'}
              </button>
            </div>
          </div>
        </div>
      )}
      {importingConn && config.supportsImport && (
        <ChannelImportModal
          connectionId={importingConn.id}
          connectionName={importingConn.name}
          platformLabel={config.name}
          loadThumbnail={config.supportsImageFetch
            ? async (sku) => (await api.connections.importThumbnail(importingConn.id, sku, getToken()!)).url
            : undefined}
          onClose={() => setImportingConn(null)}
          onImported={() => {}}
        />
      )}
      {salesImportConn && config.supportsSalesImport && (
        <ChannelSalesImportModal
          connectionId={salesImportConn.id}
          connectionName={salesImportConn.name}
          platformLabel={config.name}
          onClose={() => setSalesImportConn(null)}
        />
      )}
    </div>
  );
}
