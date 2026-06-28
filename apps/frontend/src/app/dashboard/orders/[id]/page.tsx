'use client';

import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { getToken, getUser } from '@/lib/auth';
import { api, imgUrl } from '@/lib/api';

const STATUS_CONFIG: Record<string, { label: string; color: string; border: string }> = {
  PENDING:    { label: 'Pendiente',  color: 'bg-amber-100 text-amber-700',   border: 'border-amber-300' },
  PREPARING:  { label: 'Preparando', color: 'bg-blue-100 text-blue-700',     border: 'border-blue-300' },
  READY:      { label: 'Listo',      color: 'bg-indigo-100 text-indigo-700', border: 'border-indigo-300' },
  IN_TRANSIT: { label: 'En camino',  color: 'bg-yellow-100 text-yellow-700', border: 'border-yellow-300' },
  DELIVERED:  { label: 'Entregado',  color: 'bg-green-100 text-green-700',   border: 'border-green-300' },
  CANCELLED:  { label: 'Cancelado',  color: 'bg-gray-100 text-gray-500',     border: 'border-gray-200' },
};

const CHANNEL_LABEL: Record<string, string> = {
  POS: 'POS', MERCADO_LIBRE: 'Mercado Libre', SHOPIFY: 'Shopify',
  WOOCOMMERCE: 'WooCommerce', JUMPSELLER: 'JumpSeller', FALABELLA: 'Falabella',
  PARIS: 'Paris', HITES: 'Hites', RIPLEY: 'Ripley', WALMART: 'Walmart', MANUAL: 'Manual',
};

export default function OrderDetailPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const [order, setOrder] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [warehouses, setWarehouses] = useState<any[]>([]);

  const [statusLoading, setStatusLoading] = useState(false);
  const [statusError, setStatusError] = useState('');

  const [checkLoading, setCheckLoading] = useState<Record<string, boolean>>({});
  const [checkQty, setCheckQty] = useState<Record<string, number>>({});
  const [checkNote, setCheckNote] = useState<Record<string, string>>({});

  const [photoUploading, setPhotoUploading] = useState(false);
  const [photoError, setPhotoError] = useState('');
  const photoRef = useRef<HTMLInputElement>(null);

  const [editShipment, setEditShipment] = useState(false);
  const [shipForm, setShipForm] = useState<any>({});
  const [shipLoading, setShipLoading] = useState(false);
  const [shipError, setShipError] = useState('');

  const isAdmin = ['SUPER_ADMIN', 'COMPANY_ADMIN', 'CATALOG_MANAGER'].includes(currentUser?.role);

  async function load() {
    const token = getToken();
    if (!token) return;
    setLoading(true);
    try {
      const data = await api.orders.get(params.id, token);
      setOrder(data);
      setShipForm({
        customerName: data.customerName || '',
        customerEmail: data.customerEmail || '',
        customerPhone: data.customerPhone || '',
        address: data.address || '',
        commune: data.commune || '',
        city: data.city || '',
        region: data.region || '',
        courier: data.courier || '',
        trackingCode: data.trackingCode || '',
        warehouseId: data.warehouseId || '',
        notes: data.notes || '',
      });
      const initQty: Record<string, number> = {};
      data.itemChecks?.forEach((i: any) => {
        initQty[i.id] = i.checkedQty ?? i.expectedQty;
      });
      setCheckQty(initQty);
    } catch (err: any) {
      setError(err.message || 'Orden no encontrada');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const u = getUser();
    setCurrentUser(u);
    const token = getToken();
    if (token) {
      load();
      api.warehouses.list(token).then(setWarehouses).catch(() => {});
    }
  }, [params.id]);

  async function handleStatus(status: string) {
    setStatusError('');
    setStatusLoading(true);
    try {
      const token = getToken()!;
      const updated = await api.orders.updateStatus(params.id, status, token);
      setOrder(updated);
    } catch (err: any) {
      setStatusError(err.message || 'Error al cambiar estado');
    } finally {
      setStatusLoading(false);
    }
  }

  async function handleCheck(item: any) {
    const qty = checkQty[item.id] ?? item.expectedQty;
    setCheckLoading((l) => ({ ...l, [item.id]: true }));
    try {
      const token = getToken()!;
      await api.orders.checkItem(params.id, item.id, {
        checkedQty: qty,
        notes: checkNote[item.id] || undefined,
      }, token);
      await load();
    } catch (err: any) {
      alert(err.message);
    } finally {
      setCheckLoading((l) => ({ ...l, [item.id]: false }));
    }
  }

  async function handleUncheck(item: any) {
    setCheckLoading((l) => ({ ...l, [item.id]: true }));
    try {
      const token = getToken()!;
      await api.orders.uncheckItem(params.id, item.id, token);
      await load();
    } catch (err: any) {
      alert(err.message);
    } finally {
      setCheckLoading((l) => ({ ...l, [item.id]: false }));
    }
  }

  async function handleCheckAll() {
    if (!order) return;
    const unchecked = order.itemChecks.filter((i: any) => !i.checked);
    for (const item of unchecked) {
      const qty = checkQty[item.id] ?? item.expectedQty;
      const token = getToken()!;
      await api.orders.checkItem(params.id, item.id, { checkedQty: qty }, token).catch(() => {});
    }
    await load();
  }

  async function handlePhotoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setPhotoUploading(true);
    setPhotoError('');
    try {
      const token = getToken()!;
      await api.orders.uploadPhoto(params.id, file, token);
      await load();
    } catch (err: any) {
      setPhotoError(err.message || 'Error al subir foto');
    } finally {
      setPhotoUploading(false);
      if (photoRef.current) photoRef.current.value = '';
    }
  }

  async function handleDeletePhoto(photoId: string) {
    if (!confirm('¿Eliminar esta foto?')) return;
    const token = getToken()!;
    await api.orders.deletePhoto(params.id, photoId, token).catch(() => {});
    await load();
  }

  async function handleShipSave(e: React.FormEvent) {
    e.preventDefault();
    setShipLoading(true);
    setShipError('');
    try {
      const token = getToken()!;
      const updated = await api.orders.update(params.id, shipForm, token);
      setOrder(updated);
      setEditShipment(false);
    } catch (err: any) {
      setShipError(err.message || 'Error al guardar');
    } finally {
      setShipLoading(false);
    }
  }

  if (loading) return <div className="text-gray-400 text-sm py-10 text-center">Cargando...</div>;
  if (error) return <div className="text-red-600 text-sm py-10 text-center">{error}</div>;
  if (!order) return null;

  const cfg = STATUS_CONFIG[order.status] ?? STATUS_CONFIG.CANCELLED;
  const checkedCount = order.itemChecks.filter((i: any) => i.checked).length;
  const totalItems = order.itemChecks.length;
  const allChecked = totalItems > 0 && checkedCount === totalItems;
  const hasPhotos = order.photos.length > 0;
  const isDelivery = order.fulfillmentType === 'DELIVERY';
  const shortId = order.id.slice(-6).toUpperCase();

  const nextAction: Record<string, { label: string; next: string; disabled?: boolean; reason?: string }> = {
    PENDING: { label: 'Comenzar preparación', next: 'PREPARING' },
    PREPARING: {
      label: 'Marcar como Listo',
      next: 'READY',
      disabled: !allChecked,
      reason: `Faltan ${totalItems - checkedCount} producto(s) por verificar`,
    },
    READY: {
      label: isDelivery ? 'Despachar pedido' : 'Entregar al cliente',
      next: isDelivery ? 'IN_TRANSIT' : 'DELIVERED',
      disabled: isDelivery && !hasPhotos,
      reason: isDelivery && !hasPhotos ? 'Sube al menos una foto del pedido' : undefined,
    },
    IN_TRANSIT: { label: 'Confirmar entrega', next: 'DELIVERED' },
  };
  const action = nextAction[order.status];
  const isDone = order.status === 'DELIVERED' || order.status === 'CANCELLED';

  return (
    <div className="max-w-4xl">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 mb-6 text-sm">
        <a href="/dashboard/orders" className="text-gray-400 hover:text-gray-600">Órdenes</a>
        <span className="text-gray-300">/</span>
        <span className="text-gray-700 font-semibold">#{shortId}</span>
      </div>

      {/* Header */}
      <div className={`bg-white rounded-2xl border-2 ${cfg.border} p-5 mb-6`}>
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className={`px-2.5 py-1 rounded-full text-xs font-bold ${cfg.color}`}>{cfg.label}</span>
              <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                isDelivery ? 'bg-blue-50 text-blue-700' : 'bg-gray-100 text-gray-600'
              }`}>
                {isDelivery ? '🚚 Despacho' : '🏬 Retiro'}
              </span>
              {order.sale && (
                <span className="text-xs text-gray-400">
                  Canal: {CHANNEL_LABEL[order.sale.channel] || order.sale.channel}
                </span>
              )}
            </div>
            <p className="font-mono text-gray-400 text-xs">Orden #{shortId}</p>
            {order.warehouse && (
              <p className="text-xs text-gray-500 mt-0.5">Bodega: {order.warehouse.name}</p>
            )}
            {order.createdBy && (
              <p className="text-xs text-gray-400 mt-0.5">Creado por {order.createdBy.name}</p>
            )}
          </div>

          <div className="flex flex-col items-end gap-2">
            {action && isAdmin && (
              <div className="flex flex-col items-end gap-1">
                <button
                  onClick={() => handleStatus(action.next)}
                  disabled={statusLoading || !!action.disabled}
                  title={action.disabled ? action.reason : undefined}
                  className={`px-5 py-2.5 rounded-xl text-sm font-semibold transition-colors ${
                    action.disabled
                      ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                      : 'bg-blue-600 hover:bg-blue-700 text-white'
                  }`}
                >
                  {statusLoading ? 'Actualizando...' : action.label} →
                </button>
                {action.disabled && action.reason && (
                  <p className="text-xs text-amber-600">{action.reason}</p>
                )}
              </div>
            )}
            {!isDone && order.status !== 'CANCELLED' && isAdmin && (
              <button
                onClick={() => handleStatus('CANCELLED')}
                className="text-xs text-red-400 hover:text-red-600 font-medium"
              >
                Cancelar orden
              </button>
            )}
            {statusError && <p className="text-xs text-red-600 max-w-xs text-right">{statusError}</p>}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">

        {/* Columna principal */}
        <div className="lg:col-span-3 space-y-6">

          {/* Verificación de productos */}
          <div className="bg-white rounded-2xl border border-gray-200 p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-gray-800">
                Productos
                {totalItems > 0 && (
                  <span className="ml-2 text-xs font-normal text-gray-400">
                    {checkedCount}/{totalItems} verificados
                  </span>
                )}
              </h2>
              {order.status === 'PREPARING' && totalItems > 0 && !allChecked && isAdmin && (
                <button onClick={handleCheckAll}
                  className="text-xs text-blue-600 hover:text-blue-800 font-medium">
                  Marcar todo OK
                </button>
              )}
            </div>

            {totalItems > 0 && order.status === 'PREPARING' && (
              <div className="mb-4">
                <div className="flex justify-between text-xs text-gray-400 mb-1">
                  <span>Progreso de verificación</span>
                  <span>{Math.round((checkedCount / totalItems) * 100)}%</span>
                </div>
                <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${allChecked ? 'bg-green-500' : 'bg-blue-500'}`}
                    style={{ width: `${(checkedCount / totalItems) * 100}%` }}
                  />
                </div>
              </div>
            )}

            {totalItems === 0 ? (
              <p className="text-sm text-gray-400 text-center py-4">Sin productos registrados en esta orden.</p>
            ) : (
              <div className="space-y-2">
                {order.itemChecks.map((item: any) => {
                  const busy = checkLoading[item.id];
                  const isPreparing = order.status === 'PREPARING';
                  const hasDiscrepancy = item.checked && item.checkedQty !== item.expectedQty;
                  return (
                    <div key={item.id} className={`rounded-xl border p-3 transition-colors ${
                      item.checked
                        ? hasDiscrepancy ? 'border-amber-200 bg-amber-50' : 'border-green-200 bg-green-50'
                        : 'border-gray-200 bg-white'
                    }`}>
                      <div className="flex items-start gap-3">
                        <div className={`mt-0.5 w-5 h-5 rounded-full flex items-center justify-center shrink-0 text-xs font-bold ${
                          item.checked ? (hasDiscrepancy ? 'bg-amber-400 text-white' : 'bg-green-500 text-white') : 'bg-gray-200 text-gray-400'
                        }`}>
                          {item.checked ? (hasDiscrepancy ? '!' : '✓') : ''}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-gray-900 text-sm">{item.productName}</p>
                          <p className="text-xs text-gray-400 font-mono">{item.productSku}</p>
                          {item.checked && (
                            <p className={`text-xs mt-0.5 ${hasDiscrepancy ? 'text-amber-700 font-medium' : 'text-green-700'}`}>
                              {hasDiscrepancy
                                ? `⚠ Verificado: ${item.checkedQty} (esperado: ${item.expectedQty})`
                                : `✓ Verificado: ${item.checkedQty}`}
                            </p>
                          )}
                          {item.notes && <p className="text-xs text-gray-500 italic mt-0.5">"{item.notes}"</p>}
                          {item.checkedBy && (
                            <p className="text-xs text-gray-400 mt-0.5">Por: {item.checkedBy.name}</p>
                          )}
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-sm font-bold text-gray-700">×{item.expectedQty}</p>
                        </div>
                      </div>

                      {isPreparing && isAdmin && (
                        <div className="mt-2 pt-2 border-t border-gray-100">
                          {!item.checked ? (
                            <div className="flex gap-2 items-center">
                              <input
                                type="number"
                                min={0}
                                value={checkQty[item.id] ?? item.expectedQty}
                                onChange={(e) => setCheckQty((q) => ({ ...q, [item.id]: Number(e.target.value) }))}
                                className="w-16 px-2 py-1 border border-gray-300 rounded-lg text-xs text-center"
                              />
                              <input
                                type="text"
                                placeholder="Nota opcional..."
                                value={checkNote[item.id] || ''}
                                onChange={(e) => setCheckNote((n) => ({ ...n, [item.id]: e.target.value }))}
                                className="flex-1 px-2 py-1 border border-gray-300 rounded-lg text-xs"
                              />
                              <button onClick={() => handleCheck(item)} disabled={busy}
                                className="px-3 py-1 bg-green-500 hover:bg-green-600 text-white rounded-lg text-xs font-semibold disabled:opacity-50">
                                {busy ? '...' : 'OK ✓'}
                              </button>
                            </div>
                          ) : (
                            <button onClick={() => handleUncheck(item)} disabled={busy}
                              className="text-xs text-gray-400 hover:text-red-500 font-medium">
                              {busy ? '...' : 'Desmarcar'}
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Fotos del pedido */}
          {(order.status === 'READY' || order.status === 'IN_TRANSIT' || order.status === 'DELIVERED') && (
            <div className="bg-white rounded-2xl border border-gray-200 p-5">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-semibold text-gray-800">
                  Fotos del pedido
                  {order.photos.length > 0 && (
                    <span className="ml-2 text-xs font-normal text-gray-400">{order.photos.length} foto(s)</span>
                  )}
                </h2>
                {isDelivery && !hasPhotos && order.status === 'READY' && (
                  <span className="text-xs text-amber-600 font-medium">Requerido para despachar</span>
                )}
              </div>

              {order.photos.length > 0 && (
                <div className="grid grid-cols-3 gap-2 mb-4">
                  {order.photos.map((photo: any) => (
                    <div key={photo.id} className="relative group aspect-square rounded-xl overflow-hidden border border-gray-200">
                      <img src={imgUrl(photo.url)} alt="Foto pedido" className="w-full h-full object-cover" />
                      {order.status !== 'DELIVERED' && isAdmin && (
                        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                          <button onClick={() => handleDeletePhoto(photo.id)}
                            className="text-xs bg-red-500 text-white px-2 py-1 rounded-lg font-medium">
                            Eliminar
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {order.status !== 'DELIVERED' && isAdmin && (
                <div>
                  {photoError && (
                    <p className="text-xs text-red-600 mb-2">{photoError}</p>
                  )}
                  <label className={`flex items-center gap-3 px-4 py-3 border-2 border-dashed rounded-xl cursor-pointer transition-colors ${
                    photoUploading ? 'opacity-50 cursor-not-allowed' : 'border-gray-200 hover:border-blue-300 hover:bg-blue-50'
                  }`}>
                    <span className="text-2xl">📷</span>
                    <div>
                      <p className="text-sm font-medium text-gray-700">
                        {photoUploading ? 'Subiendo...' : 'Tomar foto o subir imagen'}
                      </p>
                      <p className="text-xs text-gray-400">JPG, PNG, WebP · máx. 10 MB</p>
                    </div>
                    <input
                      ref={photoRef}
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      capture="environment"
                      onChange={handlePhotoUpload}
                      disabled={photoUploading}
                      className="hidden"
                    />
                  </label>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Columna lateral — datos de cliente y despacho */}
        <div className="lg:col-span-2 space-y-4">
          <div className="bg-white rounded-2xl border border-gray-200 p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-gray-800">
                {isDelivery ? 'Datos de despacho' : 'Datos del cliente'}
              </h2>
              {!isDone && isAdmin && !editShipment && (
                <button onClick={() => setEditShipment(true)}
                  className="text-xs text-blue-500 hover:text-blue-700 font-medium">
                  Editar
                </button>
              )}
            </div>

            {editShipment ? (
              <form onSubmit={handleShipSave} className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Nombre cliente</label>
                  <input value={shipForm.customerName}
                    onChange={(e) => setShipForm((f: any) => ({ ...f, customerName: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Teléfono</label>
                  <input value={shipForm.customerPhone}
                    onChange={(e) => setShipForm((f: any) => ({ ...f, customerPhone: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Email</label>
                  <input type="email" value={shipForm.customerEmail}
                    onChange={(e) => setShipForm((f: any) => ({ ...f, customerEmail: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                </div>
                {isDelivery && (
                  <>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Dirección</label>
                      <input value={shipForm.address}
                        onChange={(e) => setShipForm((f: any) => ({ ...f, address: e.target.value }))}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Comuna</label>
                        <input value={shipForm.commune}
                          onChange={(e) => setShipForm((f: any) => ({ ...f, commune: e.target.value }))}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Ciudad</label>
                        <input value={shipForm.city}
                          onChange={(e) => setShipForm((f: any) => ({ ...f, city: e.target.value }))}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Courier</label>
                      <input value={shipForm.courier}
                        placeholder="Starken, Chilexpress, Blue Express..."
                        onChange={(e) => setShipForm((f: any) => ({ ...f, courier: e.target.value }))}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Código de seguimiento</label>
                      <input value={shipForm.trackingCode}
                        onChange={(e) => setShipForm((f: any) => ({ ...f, trackingCode: e.target.value }))}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono" />
                    </div>
                  </>
                )}
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Bodega</label>
                  <select value={shipForm.warehouseId}
                    onChange={(e) => setShipForm((f: any) => ({ ...f, warehouseId: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white">
                    <option value="">— Sin bodega —</option>
                    {warehouses.filter((w) => w.active).map((w) => (
                      <option key={w.id} value={w.id}>{w.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Notas internas</label>
                  <textarea value={shipForm.notes}
                    onChange={(e) => setShipForm((f: any) => ({ ...f, notes: e.target.value }))}
                    rows={2}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm resize-none" />
                </div>
                {shipError && <p className="text-xs text-red-600">{shipError}</p>}
                <div className="flex gap-2">
                  <button type="submit" disabled={shipLoading}
                    className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-semibold disabled:opacity-50">
                    {shipLoading ? 'Guardando...' : 'Guardar'}
                  </button>
                  <button type="button" onClick={() => setEditShipment(false)}
                    className="px-3 py-1.5 border border-gray-300 text-gray-600 rounded-lg text-xs">
                    Cancelar
                  </button>
                </div>
              </form>
            ) : (
              <div className="space-y-2 text-sm">
                {[
                  { label: 'Nombre', value: order.customerName },
                  { label: 'Teléfono', value: order.customerPhone },
                  { label: 'Email', value: order.customerEmail },
                  ...(isDelivery ? [
                    { label: 'Dirección', value: order.address },
                    { label: 'Comuna', value: order.commune },
                    { label: 'Ciudad', value: order.city },
                    { label: 'Courier', value: order.courier },
                    { label: 'Tracking', value: order.trackingCode },
                  ] : []),
                  { label: 'Bodega', value: order.warehouse?.name },
                ].map(({ label, value }) => (
                  <div key={label} className="flex gap-2">
                    <span className="text-xs text-gray-400 w-20 shrink-0">{label}</span>
                    <span className="text-xs text-gray-800 font-medium break-all">
                      {value || <span className="text-gray-300">—</span>}
                    </span>
                  </div>
                ))}
                {order.notes && (
                  <div className="mt-3 px-3 py-2 bg-gray-50 rounded-lg">
                    <p className="text-xs text-gray-500 italic">"{order.notes}"</p>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Info de venta origen */}
          {order.sale && (
            <div className="bg-white rounded-2xl border border-gray-200 p-5">
              <h2 className="font-semibold text-gray-800 mb-3 text-sm">Venta de origen</h2>
              <div className="space-y-2 text-xs">
                <div className="flex gap-2">
                  <span className="text-gray-400 w-16 shrink-0">Canal</span>
                  <span className="text-gray-800 font-medium">{CHANNEL_LABEL[order.sale.channel] || order.sale.channel}</span>
                </div>
                <div className="flex gap-2">
                  <span className="text-gray-400 w-16 shrink-0">Total</span>
                  <span className="text-gray-800 font-medium">
                    ${Number(order.sale.total).toLocaleString('es-CL')}
                  </span>
                </div>
                <div className="flex gap-2">
                  <span className="text-gray-400 w-16 shrink-0">Fecha</span>
                  <span className="text-gray-800">
                    {new Date(order.sale.createdAt).toLocaleDateString('es-CL')}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Fechas */}
          <div className="bg-white rounded-2xl border border-gray-200 p-5">
            <h2 className="font-semibold text-gray-800 mb-3 text-sm">Historial</h2>
            <div className="space-y-1.5 text-xs">
              <div className="flex gap-2">
                <span className="text-gray-400 w-20 shrink-0">Creada</span>
                <span className="text-gray-700">
                  {new Date(order.createdAt).toLocaleDateString('es-CL', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
              {order.deliveredAt && (
                <div className="flex gap-2">
                  <span className="text-gray-400 w-20 shrink-0">Entregada</span>
                  <span className="text-green-700 font-medium">
                    {new Date(order.deliveredAt).toLocaleDateString('es-CL', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
