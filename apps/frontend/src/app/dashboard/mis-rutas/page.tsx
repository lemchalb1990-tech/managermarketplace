'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { getToken } from '@/lib/auth';
import { api } from '@/lib/api';

const STATUS_CFG: Record<string, { label: string; color: string; dot: string }> = {
  PENDING:     { label: 'Pendiente',   color: 'bg-amber-100 text-amber-700',   dot: 'bg-amber-400' },
  IN_PROGRESS: { label: 'En progreso', color: 'bg-blue-100 text-blue-700',     dot: 'bg-blue-500' },
  COMPLETED:   { label: 'Completada',  color: 'bg-green-100 text-green-700',   dot: 'bg-green-500' },
  CANCELLED:   { label: 'Cancelada',   color: 'bg-gray-100 text-gray-500',     dot: 'bg-gray-400' },
};

function groupRoutes(routes: any[]) {
  const today = new Date().toISOString().split('T')[0];
  const active = routes.filter(r => r.status === 'IN_PROGRESS');
  const todayPending = routes.filter(r => r.date === today && r.status === 'PENDING');
  const upcoming = routes.filter(r => r.date > today && r.status === 'PENDING');
  const done = routes.filter(r => r.status === 'COMPLETED' || r.status === 'CANCELLED');
  return { active, todayPending, upcoming, done };
}

export default function MisRutasPage() {
  const [routes, setRoutes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const t = getToken();
    if (!t) return;
    api.dispatch.listRoutes(t)
      .then(setRoutes)
      .catch(() => setRoutes([]))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-gray-400 text-sm">Cargando rutas...</p>
      </div>
    );
  }

  const { active, todayPending, upcoming, done } = groupRoutes(routes);

  return (
    <div className="max-w-xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Mis Rutas</h1>
        <p className="text-sm text-gray-400 mt-0.5">Rutas de despacho asignadas a ti</p>
      </div>

      {routes.length === 0 && (
        <div className="text-center py-16 bg-white rounded-2xl border border-gray-200">
          <p className="text-4xl mb-3">🚚</p>
          <p className="text-gray-500 font-semibold">Sin rutas asignadas</p>
          <p className="text-gray-400 text-sm mt-1">El administrador te asignará rutas de despacho</p>
        </div>
      )}

      {/* En progreso */}
      {active.length > 0 && (
        <Section title="En progreso ahora" accent="blue">
          {active.map(r => <RouteCard key={r.id} route={r} highlight />)}
        </Section>
      )}

      {/* Hoy pendientes */}
      {todayPending.length > 0 && (
        <Section title="Para hoy" accent="amber">
          {todayPending.map(r => <RouteCard key={r.id} route={r} />)}
        </Section>
      )}

      {/* Próximas */}
      {upcoming.length > 0 && (
        <Section title="Próximas" accent="gray">
          {upcoming.map(r => <RouteCard key={r.id} route={r} />)}
        </Section>
      )}

      {/* Completadas / canceladas (max 5) */}
      {done.length > 0 && (
        <Section title="Historial reciente" accent="gray">
          {done.slice(0, 5).map(r => <RouteCard key={r.id} route={r} muted />)}
        </Section>
      )}
    </div>
  );
}

function Section({ title, accent, children }: { title: string; accent: string; children: React.ReactNode }) {
  const bar = accent === 'blue' ? 'bg-blue-500' : accent === 'amber' ? 'bg-amber-400' : 'bg-gray-300';
  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <div className={`w-1 h-4 rounded-full ${bar}`} />
        <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">{title}</h2>
      </div>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function RouteCard({ route, highlight, muted }: { route: any; highlight?: boolean; muted?: boolean }) {
  const cfg = STATUS_CFG[route.status] ?? STATUS_CFG.PENDING;
  const stops = route._count?.stops ?? route.stops?.length ?? 0;
  const delivered = route.stops?.filter((s: any) => s.deliveredAt).length ?? 0;
  const progress = stops > 0 ? Math.round((delivered / stops) * 100) : 0;
  const dateStr = new Date(route.date + 'T12:00:00').toLocaleDateString('es-CL', {
    weekday: 'short', day: 'numeric', month: 'short',
  });

  return (
    <Link
      href={`/dashboard/mis-rutas/${route.id}`}
      className={`block rounded-2xl border p-4 transition-all ${
        highlight
          ? 'bg-blue-600 border-blue-600 shadow-lg shadow-blue-100'
          : muted
          ? 'bg-white border-gray-200 opacity-60 hover:opacity-100'
          : 'bg-white border-gray-200 hover:border-blue-300 hover:shadow-sm'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <p className={`font-semibold truncate ${highlight ? 'text-white' : 'text-gray-900'}`}>{route.name}</p>
          <p className={`text-xs mt-0.5 ${highlight ? 'text-blue-100' : 'text-gray-400'}`}>{dateStr}</p>
        </div>
        <span className={`text-xs px-2 py-0.5 rounded-full font-semibold shrink-0 ${
          highlight ? 'bg-white/20 text-white' : cfg.color
        }`}>{cfg.label}</span>
      </div>

      <div className={`mt-3 flex items-center gap-3 text-sm ${highlight ? 'text-blue-100' : 'text-gray-500'}`}>
        <span>{stops} parada{stops !== 1 ? 's' : ''}</span>
        {stops > 0 && <span>· {delivered} entregada{delivered !== 1 ? 's' : ''}</span>}
      </div>

      {stops > 0 && (
        <div className={`mt-3 h-1.5 rounded-full overflow-hidden ${highlight ? 'bg-white/20' : 'bg-gray-100'}`}>
          <div
            className={`h-full rounded-full transition-all ${progress === 100 ? 'bg-green-400' : highlight ? 'bg-white' : 'bg-blue-500'}`}
            style={{ width: `${progress}%` }}
          />
        </div>
      )}

      {highlight && (
        <div className="mt-3 flex items-center gap-1 text-white text-sm font-semibold">
          <span>Ver ruta activa</span>
          <span className="text-lg">→</span>
        </div>
      )}
    </Link>
  );
}
