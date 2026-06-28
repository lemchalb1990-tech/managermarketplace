'use client';

import { use, useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { getToken } from '@/lib/auth';
import { api } from '@/lib/api';

const RouteMap = dynamic(() => import('@/components/RouteMap'), { ssr: false });

type Stop = {
  id: string; position: number; notes?: string | null;
  lat?: number | null; lng?: number | null; deliveredAt?: string | null;
  order: {
    id: string; customerName?: string | null; customerPhone?: string | null;
    address?: string | null; commune?: string | null; city?: string | null;
    status: string;
  };
};

export default function MiRutaDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [token, setToken] = useState('');
  const [route, setRoute] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [delivering, setDelivering] = useState<string | null>(null);
  const [deliverNotes, setDeliverNotes] = useState('');
  const [confirmStop, setConfirmStop] = useState<Stop | null>(null);
  const [starting, setStarting] = useState(false);

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

  async function handleStart() {
    setStarting(true);
    try {
      await api.dispatch.startRoute(id, token);
      await load();
    } catch (e: any) { alert(e.message || 'Error'); }
    finally { setStarting(false); }
  }

  async function handleDeliver(stop: Stop) {
    setDelivering(stop.id);
    try {
      await api.dispatch.deliverStop(id, stop.id, { notes: deliverNotes || undefined }, token);
      setConfirmStop(null);
      setDeliverNotes('');
      await load();
    } catch (e: any) { alert(e.message || 'Error al marcar como entregado'); }
    finally { setDelivering(null); }
  }

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <p className="text-gray-400 text-sm">Cargando ruta...</p>
    </div>
  );
  if (error || !route) return (
    <div className="text-center py-16 max-w-sm mx-auto">
      <p className="text-red-500 font-medium">{error || 'Ruta no encontrada'}</p>
      <Link href="/dashboard/mis-rutas" className="text-blue-500 text-sm mt-2 inline-block">← Mis rutas</Link>
    </div>
  );

  const stops: Stop[] = (route.stops ?? []).sort((a: Stop, b: Stop) => a.position - b.position);
  const delivered = stops.filter(s => s.deliveredAt).length;
  const pending = stops.filter(s => !s.deliveredAt);
  const currentStop = pending[0] ?? null;
  const isActive = route.status === 'IN_PROGRESS';
  const isPending = route.status === 'PENDING';
  const isCompleted = route.status === 'COMPLETED';
  const dateStr = new Date(route.date + 'T12:00:00').toLocaleDateString('es-CL', {
    weekday: 'long', day: 'numeric', month: 'long',
  });

  const mapStops = stops.map(s => ({
    id: s.id, position: s.position, lat: s.lat, lng: s.lng,
    deliveredAt: s.deliveredAt,
    order: { customerName: s.order.customerName, address: s.order.address, commune: s.order.commune },
  }));

  return (
    <div className="max-w-xl mx-auto space-y-4 pb-8">
      {/* Back + header */}
      <div className="flex items-start gap-3 pt-1">
        <Link href="/dashboard/mis-rutas" className="mt-1 text-gray-400 hover:text-gray-600 text-sm shrink-0">←</Link>
        <div className="flex-1">
          <h1 className="text-lg font-bold text-gray-900 leading-tight">{route.name}</h1>
          <p className="text-xs text-gray-400 capitalize mt-0.5">{dateStr}</p>
        </div>
        {isActive && (
          <span className="flex items-center gap-1.5 text-xs font-semibold text-blue-600 bg-blue-50 px-3 py-1.5 rounded-full shrink-0">
            <span className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-pulse" />
            En progreso
          </span>
        )}
        {isCompleted && (
          <span className="text-xs font-semibold text-green-600 bg-green-50 px-3 py-1.5 rounded-full shrink-0">
            ✓ Completada
          </span>
        )}
      </div>

      {/* Progress bar */}
      {stops.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-2xl px-5 py-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-gray-700">Progreso</span>
            <span className="text-sm font-bold text-gray-900">{delivered}/{stops.length}</span>
          </div>
          <div className="h-3 bg-gray-100 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${delivered === stops.length ? 'bg-green-500' : 'bg-blue-500'}`}
              style={{ width: `${stops.length > 0 ? (delivered / stops.length) * 100 : 0}%` }}
            />
          </div>
          <p className="text-xs text-gray-400 mt-1.5">{stops.length - delivered} pendiente{stops.length - delivered !== 1 ? 's' : ''}</p>
        </div>
      )}

      {/* Start route button */}
      {isPending && stops.length > 0 && (
        <button
          onClick={handleStart}
          disabled={starting}
          className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-bold py-4 rounded-2xl text-base transition shadow-md shadow-blue-100"
        >
          {starting ? 'Iniciando...' : '🚀 Iniciar ruta'}
        </button>
      )}

      {/* Current stop — prominent */}
      {isActive && currentStop && (
        <div className="bg-blue-600 text-white rounded-2xl p-5 shadow-lg shadow-blue-100">
          <div className="flex items-center gap-2 mb-3">
            <span className="w-7 h-7 bg-white/20 rounded-full flex items-center justify-center text-sm font-bold">
              {currentStop.position}
            </span>
            <span className="text-xs font-semibold text-blue-100 uppercase tracking-wide">Próxima entrega</span>
          </div>
          <p className="text-xl font-bold mb-1">{currentStop.order.customerName || 'Sin nombre'}</p>
          {(currentStop.order.address || currentStop.order.commune) && (
            <p className="text-blue-100 text-sm mb-3">
              {[currentStop.order.address, currentStop.order.commune, currentStop.order.city].filter(Boolean).join(', ')}
            </p>
          )}
          {currentStop.notes && (
            <p className="text-blue-100 text-sm italic mb-3">"{currentStop.notes}"</p>
          )}
          <div className="flex gap-2">
            {currentStop.order.customerPhone && (
              <a
                href={`tel:${currentStop.order.customerPhone}`}
                className="flex-1 bg-white/20 hover:bg-white/30 text-white font-semibold py-3 rounded-xl text-center text-sm transition"
              >
                📞 Llamar
              </a>
            )}
            {currentStop.lat && currentStop.lng && (
              <a
                href={`https://maps.google.com/?q=${currentStop.lat},${currentStop.lng}`}
                target="_blank"
                rel="noreferrer"
                className="flex-1 bg-white/20 hover:bg-white/30 text-white font-semibold py-3 rounded-xl text-center text-sm transition"
              >
                🗺️ Navegar
              </a>
            )}
            <button
              onClick={() => { setConfirmStop(currentStop); setDeliverNotes(''); }}
              className="flex-1 bg-white text-blue-600 font-bold py-3 rounded-xl text-sm transition hover:bg-blue-50"
            >
              ✓ Entregado
            </button>
          </div>
        </div>
      )}

      {/* Map (mini) */}
      {stops.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden" style={{ height: '200px' }}>
          <RouteMap stops={mapStops} />
        </div>
      )}

      {/* All stops list */}
      <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100">
          <h2 className="text-sm font-semibold text-gray-700">Todas las paradas</h2>
        </div>
        {stops.length === 0 ? (
          <p className="text-center text-sm text-gray-400 py-8">Sin paradas asignadas</p>
        ) : (
          <div className="divide-y divide-gray-50">
            {stops.map((stop) => {
              const done = !!stop.deliveredAt;
              const isCurrent = isActive && currentStop?.id === stop.id;
              return (
                <div
                  key={stop.id}
                  className={`flex items-start gap-3 px-5 py-4 ${done ? 'opacity-50' : isCurrent ? 'bg-blue-50' : ''}`}
                >
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold shrink-0 mt-0.5 ${
                    done ? 'bg-green-500 text-white' : isCurrent ? 'bg-blue-500 text-white' : 'bg-gray-100 text-gray-500'
                  }`}>
                    {done ? '✓' : stop.position}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={`font-medium text-sm ${done ? 'line-through text-gray-400' : 'text-gray-900'}`}>
                      {stop.order.customerName || 'Sin nombre'}
                    </p>
                    {(stop.order.address || stop.order.commune) && (
                      <p className="text-xs text-gray-400 mt-0.5">
                        {[stop.order.address, stop.order.commune].filter(Boolean).join(', ')}
                      </p>
                    )}
                    {stop.order.customerPhone && (
                      <a href={`tel:${stop.order.customerPhone}`} className="text-xs text-blue-500 mt-0.5 block">
                        {stop.order.customerPhone}
                      </a>
                    )}
                    {done && stop.deliveredAt && (
                      <p className="text-xs text-green-600 mt-0.5">
                        Entregado {new Date(stop.deliveredAt).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })}
                      </p>
                    )}
                  </div>
                  {isActive && !done && !isCurrent && (
                    <button
                      onClick={() => { setConfirmStop(stop); setDeliverNotes(''); }}
                      className="text-xs text-gray-400 hover:text-blue-600 border border-gray-200 hover:border-blue-300 px-2 py-1.5 rounded-lg shrink-0 transition"
                    >
                      Entregar
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Completed message */}
      {isCompleted && (
        <div className="bg-green-50 border border-green-200 rounded-2xl px-5 py-5 text-center">
          <p className="text-3xl mb-2">🎉</p>
          <p className="font-bold text-green-700">¡Ruta completada!</p>
          <p className="text-sm text-green-600 mt-1">
            {delivered} entrega{delivered !== 1 ? 's' : ''} realizadas
            {route.completedAt && ` · finalizada a las ${new Date(route.completedAt).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })}`}
          </p>
        </div>
      )}

      {/* Confirm delivery modal */}
      {confirmStop && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 px-4 pb-4 sm:pb-0">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm">
            <div className="px-6 pt-6 pb-5">
              <p className="text-lg font-bold text-gray-900 mb-1">Confirmar entrega</p>
              <p className="text-sm text-gray-500 mb-4">
                ¿Entregaste a <strong>{confirmStop.order.customerName || 'este cliente'}</strong>?
              </p>
              <textarea
                value={deliverNotes}
                onChange={e => setDeliverNotes(e.target.value)}
                placeholder="Notas de entrega (opcional)..."
                rows={2}
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 mb-4"
              />
              <div className="flex gap-2">
                <button
                  onClick={() => handleDeliver(confirmStop)}
                  disabled={delivering === confirmStop.id}
                  className="flex-1 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white font-bold py-3.5 rounded-xl text-sm transition"
                >
                  {delivering === confirmStop.id ? 'Confirmando...' : '✓ Confirmar entrega'}
                </button>
                <button
                  onClick={() => setConfirmStop(null)}
                  className="px-4 py-3.5 border border-gray-200 text-gray-600 rounded-xl text-sm hover:bg-gray-50 transition"
                >
                  Cancelar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
