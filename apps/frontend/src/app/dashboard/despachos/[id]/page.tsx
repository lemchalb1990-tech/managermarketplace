'use client';

import { use, useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { getToken } from '@/lib/auth';
import { api } from '@/lib/api';

const RouteMap = dynamic(() => import('@/components/RouteMap'), { ssr: false });

const STATUS_CFG: Record<string, { label: string; color: string }> = {
  PENDING:     { label: 'Pendiente',   color: 'bg-amber-100 text-amber-700' },
  IN_PROGRESS: { label: 'En progreso', color: 'bg-blue-100 text-blue-700' },
  COMPLETED:   { label: 'Completada',  color: 'bg-green-100 text-green-700' },
  CANCELLED:   { label: 'Cancelada',   color: 'bg-gray-100 text-gray-500' },
};

const ORDER_STATUS_BADGE: Record<string, string> = {
  PENDING: 'bg-amber-100 text-amber-700', PREPARING: 'bg-blue-100 text-blue-700',
  READY: 'bg-indigo-100 text-indigo-700', IN_TRANSIT: 'bg-yellow-100 text-yellow-700',
  DELIVERED: 'bg-green-100 text-green-700', CANCELLED: 'bg-gray-100 text-gray-500',
};

type Stop = {
  id: string; position: number; notes?: string | null;
  lat?: number | null; lng?: number | null; deliveredAt?: string | null;
  order: { id: string; customerName?: string | null; customerPhone?: string | null;
    address?: string | null; commune?: string | null; city?: string | null;
    status: string; fulfillmentType?: string | null; };
};

export default function DespachoDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [token, setToken] = useState('');
  const [route, setRoute] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [acting, setActing] = useState(false);

  // Add stop modal
  const [showAddStop, setShowAddStop] = useState(false);
  const [availableOrders, setAvailableOrders] = useState<any[]>([]);
  const [loadingOrders, setLoadingOrders] = useState(false);
  const [selectedOrderId, setSelectedOrderId] = useState('');
  const [stopNotes, setStopNotes] = useState('');
  const [geocoding, setGeocoding] = useState(false);
  const [geocodeAddress, setGeocodeAddress] = useState('');
  const [stopLat, setStopLat] = useState('');
  const [stopLng, setStopLng] = useState('');
  const [addingStop, setAddingStop] = useState(false);
  const [addStopError, setAddStopError] = useState('');

  const load = useCallback(async () => {
    const t = getToken();
    if (!t) return;
    try {
      const r = await api.dispatch.getRoute(id, t);
      setRoute(r);
    } catch (e: any) {
      setError(e.message || 'Ruta no encontrada');
    } finally { setLoading(false); }
  }, [id]);

  useEffect(() => {
    const t = getToken();
    if (t) setToken(t);
    load();
  }, [load]);

  async function act(fn: () => Promise<any>) {
    setActing(true);
    try { await fn(); await load(); }
    catch (e: any) { alert(e.message || 'Error'); }
    finally { setActing(false); }
  }

  async function openAddStop() {
    setShowAddStop(true);
    setSelectedOrderId('');
    setStopNotes('');
    setGeocodeAddress('');
    setStopLat('');
    setStopLng('');
    setAddStopError('');
    setLoadingOrders(true);
    try {
      const orders = await api.dispatch.availableOrders(token);
      setAvailableOrders(orders);
    } catch { setAvailableOrders([]); }
    finally { setLoadingOrders(false); }
  }

  async function geocode() {
    if (!geocodeAddress.trim()) return;
    setGeocoding(true);
    try {
      const q = encodeURIComponent(geocodeAddress + ', Chile');
      const res = await fetch(`https://nominatim.openstreetmap.org/search?q=${q}&format=json&limit=1`, {
        headers: { 'Accept-Language': 'es', 'User-Agent': 'AdminMarketplace/1.0' },
      });
      const data = await res.json();
      if (data[0]) {
        setStopLat(data[0].lat);
        setStopLng(data[0].lon);
      } else {
        alert('No se encontró la dirección. Ingresa coordenadas manualmente.');
      }
    } catch { alert('Error al geocodificar'); }
    finally { setGeocoding(false); }
  }

  async function handleAddStop(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedOrderId) { setAddStopError('Selecciona una orden'); return; }
    setAddingStop(true);
    setAddStopError('');
    try {
      await api.dispatch.addStop(id, {
        orderId: selectedOrderId,
        lat: stopLat ? parseFloat(stopLat) : undefined,
        lng: stopLng ? parseFloat(stopLng) : undefined,
        notes: stopNotes || undefined,
      }, token);
      setShowAddStop(false);
      await load();
    } catch (e: any) {
      setAddStopError(e.message || 'Error al agregar parada');
    } finally { setAddingStop(false); }
  }

  async function handleRemoveStop(stopId: string) {
    if (!confirm('¿Eliminar esta parada?')) return;
    await act(() => api.dispatch.removeStop(id, stopId, token));
  }

  if (loading) return <div className="flex items-center justify-center h-64"><p className="text-gray-400 text-sm">Cargando ruta...</p></div>;
  if (error || !route) return (
    <div className="text-center py-16">
      <p className="text-red-500 font-medium">{error || 'Ruta no encontrada'}</p>
      <Link href="/dashboard/despachos" className="text-blue-500 text-sm mt-2 inline-block">← Volver</Link>
    </div>
  );

  const cfg = STATUS_CFG[route.status] ?? STATUS_CFG.PENDING;
  const stops: Stop[] = (route.stops ?? []).sort((a: Stop, b: Stop) => a.position - b.position);
  const delivered = stops.filter(s => s.deliveredAt).length;
  const canEdit = route.status === 'PENDING' || route.status === 'IN_PROGRESS';
  const canStart = route.status === 'PENDING';
  const canCancel = route.status !== 'COMPLETED' && route.status !== 'CANCELLED';
  const dateStr = new Date(route.date + 'T12:00:00').toLocaleDateString('es-CL', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });

  const mapStops = stops.map(s => ({
    id: s.id, position: s.position, lat: s.lat, lng: s.lng,
    deliveredAt: s.deliveredAt,
    order: { customerName: s.order.customerName, address: s.order.address, commune: s.order.commune },
  }));

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start gap-3 flex-wrap">
        <Link href="/dashboard/despachos" className="mt-1 text-gray-400 hover:text-gray-600 text-sm">← Volver</Link>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-xl font-bold text-gray-900">{route.name}</h1>
            <span className={`text-xs px-2 py-1 rounded-full font-semibold ${cfg.color}`}>{cfg.label}</span>
          </div>
          <p className="text-sm text-gray-400 capitalize mt-0.5">{dateStr}</p>
          {route.dispatcher && <p className="text-xs text-gray-400 mt-0.5">Despachador: {route.dispatcher.name}</p>}
        </div>
        <div className="flex gap-2 flex-wrap">
          {canStart && (
            <button
              onClick={() => act(() => api.dispatch.startRoute(id, token))}
              disabled={acting || stops.length === 0}
              className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-semibold px-4 py-2 rounded-xl transition"
            >
              Iniciar ruta
            </button>
          )}
          {canEdit && stops.length > 1 && (
            <button
              onClick={() => act(() => api.dispatch.optimizeRoute(id, token))}
              disabled={acting}
              className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-semibold px-4 py-2 rounded-xl transition"
            >
              Optimizar
            </button>
          )}
          {canEdit && (
            <button
              onClick={openAddStop}
              disabled={acting}
              className="bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 text-sm font-semibold px-4 py-2 rounded-xl transition"
            >
              + Parada
            </button>
          )}
          {canCancel && (
            <button
              onClick={() => { if (confirm('¿Cancelar esta ruta?')) act(() => api.dispatch.cancelRoute(id, token)); }}
              disabled={acting}
              className="text-red-500 hover:text-red-700 text-sm px-3 py-2 rounded-xl border border-red-200 hover:border-red-300 transition"
            >
              Cancelar ruta
            </button>
          )}
        </div>
      </div>

      {/* Stats bar */}
      {stops.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-2xl px-5 py-4 flex gap-6 text-sm flex-wrap">
          <div><span className="text-gray-400">Paradas</span> <span className="font-bold text-gray-900 ml-1">{stops.length}</span></div>
          <div><span className="text-gray-400">Entregadas</span> <span className="font-bold text-green-600 ml-1">{delivered}</span></div>
          <div><span className="text-gray-400">Pendientes</span> <span className="font-bold text-amber-600 ml-1">{stops.length - delivered}</span></div>
          {route.startedAt && (
            <div><span className="text-gray-400">Inicio</span> <span className="font-medium ml-1">{new Date(route.startedAt).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })}</span></div>
          )}
          {route.completedAt && (
            <div><span className="text-gray-400">Fin</span> <span className="font-medium ml-1">{new Date(route.completedAt).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })}</span></div>
          )}
        </div>
      )}

      {/* Map + stops */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        {/* Map */}
        <div className="lg:col-span-2 bg-white border border-gray-200 rounded-2xl overflow-hidden" style={{ height: '420px' }}>
          <RouteMap stops={mapStops} />
        </div>

        {/* Stops list */}
        <div className="lg:col-span-3 bg-white border border-gray-200 rounded-2xl overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
            <h2 className="font-semibold text-gray-800">Paradas</h2>
            {stops.length > 0 && (
              <div className="h-1.5 flex-1 mx-4 bg-gray-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-green-500 rounded-full transition-all"
                  style={{ width: `${stops.length > 0 ? (delivered / stops.length) * 100 : 0}%` }}
                />
              </div>
            )}
            <span className="text-xs text-gray-400">{delivered}/{stops.length}</span>
          </div>

          {stops.length === 0 ? (
            <div className="flex items-center justify-center py-16 text-center px-6">
              <div>
                <p className="text-3xl mb-2">📍</p>
                <p className="text-gray-500 font-medium">Sin paradas</p>
                <p className="text-gray-400 text-sm mt-1">Agrega órdenes de despacho a esta ruta</p>
              </div>
            </div>
          ) : (
            <div className="divide-y divide-gray-50 max-h-96 overflow-y-auto">
              {stops.map((stop) => {
                const done = !!stop.deliveredAt;
                return (
                  <div key={stop.id} className={`flex items-start gap-3 px-5 py-3.5 ${done ? 'opacity-60' : ''}`}>
                    <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 mt-0.5 text-white ${done ? 'bg-green-500' : 'bg-blue-500'}`}>
                      {done ? '✓' : stop.position}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-sm text-gray-900">{stop.order.customerName || 'Sin nombre'}</span>
                        <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${ORDER_STATUS_BADGE[stop.order.status] ?? ''}`}>
                          {stop.order.status}
                        </span>
                      </div>
                      {(stop.order.address || stop.order.commune) && (
                        <p className="text-xs text-gray-500 mt-0.5">
                          {[stop.order.address, stop.order.commune, stop.order.city].filter(Boolean).join(', ')}
                        </p>
                      )}
                      {stop.lat && stop.lng && (
                        <p className="text-xs text-gray-400 font-mono mt-0.5">{stop.lat.toFixed(5)}, {stop.lng.toFixed(5)}</p>
                      )}
                      {stop.notes && <p className="text-xs text-gray-400 italic mt-0.5">{stop.notes}</p>}
                      {done && stop.deliveredAt && (
                        <p className="text-xs text-green-600 mt-0.5">
                          Entregado {new Date(stop.deliveredAt).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })}
                        </p>
                      )}
                    </div>
                    {canEdit && !done && (
                      <button
                        onClick={() => handleRemoveStop(stop.id)}
                        className="text-red-400 hover:text-red-600 text-xs px-2 py-1 rounded hover:bg-red-50 shrink-0 transition"
                      >
                        ×
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {route.notes && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl px-5 py-4 text-sm text-amber-800">
          <span className="font-semibold">Notas: </span>{route.notes}
        </div>
      )}

      {/* Add stop modal */}
      {showAddStop && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 max-h-screen overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 sticky top-0 bg-white">
              <h2 className="text-base font-bold text-gray-900">Agregar parada</h2>
              <button onClick={() => setShowAddStop(false)} className="w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 text-gray-500 font-bold text-lg flex items-center justify-center">×</button>
            </div>
            <form onSubmit={handleAddStop} className="px-6 py-5 space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Orden *</label>
                {loadingOrders ? (
                  <p className="text-xs text-gray-400">Cargando órdenes disponibles...</p>
                ) : availableOrders.length === 0 ? (
                  <p className="text-xs text-amber-600">Sin órdenes disponibles (deben estar en estado READY y ser tipo DESPACHO)</p>
                ) : (
                  <select
                    value={selectedOrderId}
                    onChange={e => {
                      setSelectedOrderId(e.target.value);
                      const o = availableOrders.find(o => o.id === e.target.value);
                      if (o?.address) setGeocodeAddress([o.address, o.commune, o.city].filter(Boolean).join(', '));
                    }}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">— Selecciona una orden —</option>
                    {availableOrders.map(o => (
                      <option key={o.id} value={o.id}>
                        {o.customerName || 'Sin nombre'} — {o.address || 'Sin dirección'} (#{o.id.slice(-6).toUpperCase()})
                      </option>
                    ))}
                  </select>
                )}
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Geocodificar dirección</label>
                <div className="flex gap-2">
                  <input
                    value={geocodeAddress}
                    onChange={e => setGeocodeAddress(e.target.value)}
                    placeholder="Ej: Av. Providencia 123, Santiago"
                    className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <button
                    type="button"
                    onClick={geocode}
                    disabled={geocoding || !geocodeAddress.trim()}
                    className="bg-gray-100 hover:bg-gray-200 disabled:opacity-50 text-gray-700 text-sm font-medium px-3 py-2 rounded-lg transition"
                  >
                    {geocoding ? '...' : 'Buscar'}
                  </button>
                </div>
                <p className="text-xs text-gray-400 mt-1">Busca con Nominatim / OpenStreetMap (gratis, sin API key)</p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Latitud</label>
                  <input
                    type="number" step="any" value={stopLat}
                    onChange={e => setStopLat(e.target.value)}
                    placeholder="-33.45000"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Longitud</label>
                  <input
                    type="number" step="any" value={stopLng}
                    onChange={e => setStopLng(e.target.value)}
                    placeholder="-70.65000"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Notas (opcional)</label>
                <input
                  value={stopNotes}
                  onChange={e => setStopNotes(e.target.value)}
                  placeholder="Instrucciones de entrega..."
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              {addStopError && <p className="text-xs text-red-600">{addStopError}</p>}
              <div className="flex gap-2 pt-1">
                <button type="submit" disabled={addingStop || !selectedOrderId}
                  className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold py-2.5 rounded-xl text-sm transition">
                  {addingStop ? 'Agregando...' : 'Agregar parada'}
                </button>
                <button type="button" onClick={() => setShowAddStop(false)}
                  className="px-4 py-2.5 border border-gray-300 text-gray-600 rounded-xl text-sm hover:bg-gray-50">
                  Cancelar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
