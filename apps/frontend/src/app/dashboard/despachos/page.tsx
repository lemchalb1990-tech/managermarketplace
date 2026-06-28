'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { getToken, getUser } from '@/lib/auth';
import { api } from '@/lib/api';

const STATUS_CFG: Record<string, { label: string; color: string; dot: string }> = {
  PENDING:     { label: 'Pendiente',   color: 'bg-amber-100 text-amber-700',   dot: 'bg-amber-400' },
  IN_PROGRESS: { label: 'En progreso', color: 'bg-blue-100 text-blue-700',     dot: 'bg-blue-500' },
  COMPLETED:   { label: 'Completada',  color: 'bg-green-100 text-green-700',   dot: 'bg-green-500' },
  CANCELLED:   { label: 'Cancelada',   color: 'bg-gray-100 text-gray-500',     dot: 'bg-gray-400' },
};

const TABS = [
  { key: '', label: 'Todas' },
  { key: 'PENDING', label: 'Pendientes' },
  { key: 'IN_PROGRESS', label: 'En progreso' },
  { key: 'COMPLETED', label: 'Completadas' },
  { key: 'CANCELLED', label: 'Canceladas' },
];

const emptyForm = { name: '', date: '', dispatcherId: '', notes: '' };

export default function DespachosPage() {
  const [token, setToken] = useState('');
  const [user, setUser] = useState<any>(null);
  const [routes, setRoutes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('');
  const [dispatchers, setDispatchers] = useState<any[]>([]);

  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');

  async function load(status = tab) {
    const t = getToken();
    if (!t) return;
    setLoading(true);
    try {
      const res = await api.dispatch.listRoutes(t, { status: status || undefined });
      setRoutes(res);
    } catch { setRoutes([]); }
    finally { setLoading(false); }
  }

  useEffect(() => {
    const t = getToken();
    const u = getUser();
    if (t && u) { setToken(t); setUser(u); }
    load();
    // Load dispatchers for the create form
    if (t) {
      api.users.list(t).then(users => setDispatchers(users.filter((u: any) => u.role === 'DESPACHADOR'))).catch(() => {});
    }
  }, []);

  function handleTabChange(key: string) {
    setTab(key);
    load(key);
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    setCreateError('');
    try {
      await api.dispatch.createRoute({
        name: form.name,
        date: form.date,
        dispatcherId: form.dispatcherId || undefined,
        notes: form.notes || undefined,
      }, token);
      setShowCreate(false);
      setForm(emptyForm);
      load();
    } catch (err: any) {
      setCreateError(err.message || 'Error al crear ruta');
    } finally { setCreating(false); }
  }

  const today = new Date().toISOString().split('T')[0];

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Rutas de Despacho</h1>
          <p className="text-sm text-gray-400 mt-0.5">Gestión y seguimiento de despachos</p>
        </div>
        <button
          onClick={() => { setShowCreate(true); setForm({ ...emptyForm, date: today }); }}
          className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold px-4 py-2 rounded-xl transition"
        >
          + Nueva ruta
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-5 border-b border-gray-200">
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => handleTabChange(t.key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === t.key
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Routes list */}
      {loading ? (
        <p className="text-gray-400 text-sm text-center py-12">Cargando...</p>
      ) : routes.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-2xl border border-gray-200">
          <p className="text-3xl mb-2">🚚</p>
          <p className="text-gray-500 font-medium">Sin rutas de despacho</p>
          <p className="text-gray-400 text-sm mt-1">Crea una nueva ruta para comenzar</p>
        </div>
      ) : (
        <div className="space-y-3">
          {routes.map((route) => {
            const cfg = STATUS_CFG[route.status] ?? STATUS_CFG.PENDING;
            const delivered = route.stops?.filter((s: any) => s.deliveredAt).length ?? 0;
            const total = route._count?.stops ?? 0;
            const progress = total > 0 ? Math.round((delivered / total) * 100) : 0;
            const dateStr = new Date(route.date + 'T12:00:00').toLocaleDateString('es-CL', {
              weekday: 'long', day: 'numeric', month: 'long',
            });
            return (
              <Link
                key={route.id}
                href={`/dashboard/despachos/${route.id}`}
                className="flex items-center gap-4 bg-white border border-gray-200 rounded-2xl p-4 hover:border-blue-300 hover:shadow-sm transition-all"
              >
                <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${cfg.dot}`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span className="font-semibold text-gray-900">{route.name}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${cfg.color}`}>{cfg.label}</span>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-gray-400 flex-wrap">
                    <span className="capitalize">{dateStr}</span>
                    {route.dispatcher && <span>· {route.dispatcher.name}</span>}
                    {!route.dispatcher && <span className="text-amber-500">· Sin despachador</span>}
                    <span>· {total} parada{total !== 1 ? 's' : ''}</span>
                  </div>
                  {total > 0 && (
                    <div className="mt-2 flex items-center gap-2">
                      <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${progress === 100 ? 'bg-green-500' : 'bg-blue-500'}`}
                          style={{ width: `${progress}%` }}
                        />
                      </div>
                      <span className="text-xs text-gray-400 shrink-0">{delivered}/{total}</span>
                    </div>
                  )}
                </div>
                <span className="text-gray-300 text-lg shrink-0">›</span>
              </Link>
            );
          })}
        </div>
      )}

      {/* Modal crear ruta */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h2 className="text-base font-bold text-gray-900">Nueva ruta de despacho</h2>
              <button onClick={() => setShowCreate(false)} className="w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 text-gray-500 font-bold text-lg flex items-center justify-center">×</button>
            </div>
            <form onSubmit={handleCreate} className="px-6 py-5 space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Nombre de la ruta *</label>
                <input
                  required value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="Ej: Ruta Norte — 27 Jun"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Fecha de despacho *</label>
                <input
                  required type="date" value={form.date}
                  onChange={e => setForm(f => ({ ...f, date: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Despachador (opcional)</label>
                <select
                  value={form.dispatcherId}
                  onChange={e => setForm(f => ({ ...f, dispatcherId: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">— Sin asignar —</option>
                  {dispatchers.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Notas (opcional)</label>
                <textarea
                  value={form.notes}
                  onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                  rows={2}
                  placeholder="Instrucciones adicionales..."
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              {createError && <p className="text-xs text-red-600">{createError}</p>}
              <div className="flex gap-2 pt-1">
                <button type="submit" disabled={creating}
                  className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold py-2.5 rounded-xl text-sm transition">
                  {creating ? 'Creando...' : 'Crear ruta'}
                </button>
                <button type="button" onClick={() => setShowCreate(false)}
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
