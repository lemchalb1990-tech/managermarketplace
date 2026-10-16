'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { getToken, getUser } from '@/lib/auth';
import { api, type ProductionOrderSummary } from '@/lib/api';
import { useAdminCompany } from '../../AdminCompanyContext';
import { Badge, KIND_CLS, ORDER_STATUS_CLS, ORDER_STATUS_LABEL, ofNumber } from '../shared';

type Area = { id: string; name: string; dailyCapacityHours: number | null; load: Record<string, number> };

const DAY = 24 * 3600_000;
const dayKey = (d: Date) => d.toISOString().slice(0, 10);

function startOfWeek(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  const wd = (x.getDay() + 6) % 7; // lunes = 0
  return new Date(x.getTime() - wd * DAY);
}

// Calendario de entregas comprometidas (4 semanas) y carga de trabajo estimada por área y día.
export default function ProductionCalendarPage() {
  const { companyId, selectedCompanyId } = useAdminCompany();
  const [start, setStart] = useState(() => startOfWeek(new Date()));
  const [orders, setOrders] = useState<ProductionOrderSummary[]>([]);
  const [areas, setAreas] = useState<Area[]>([]);
  const [error, setError] = useState('');
  const [noCompany, setNoCompany] = useState(false);

  const days = useMemo(() => Array.from({ length: 28 }, (_, i) => new Date(start.getTime() + i * DAY)), [start]);

  const load = useCallback(() => {
    const t = getToken();
    if (!t) return;
    if (getUser()?.role === 'SUPER_ADMIN' && !selectedCompanyId) { setNoCompany(true); return; }
    setNoCompany(false);
    api.production.calendar(t, { companyId, from: start.toISOString(), to: new Date(start.getTime() + 28 * DAY).toISOString() })
      .then((r) => { setOrders(r.orders); setAreas(r.areas); setError(''); })
      .catch((e) => setError(e.message));
  }, [companyId, selectedCompanyId, start]);

  useEffect(() => {
    const id = requestAnimationFrame(load);
    return () => cancelAnimationFrame(id);
  }, [load]);

  const byDay = useMemo(() => {
    const m: Record<string, ProductionOrderSummary[]> = {};
    for (const o of orders) if (o.dueDate) (m[dayKey(new Date(o.dueDate))] ||= []).push(o);
    return m;
  }, [orders]);

  const today = dayKey(new Date());
  const shift = (weeks: number) => setStart((s) => new Date(s.getTime() + weeks * 7 * DAY));

  return (
    <div className="max-w-[1400px]">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="ui-page-title mb-1">Calendario y carga</h1>
          <p className="ui-page-subtitle">Entregas comprometidas y horas estimadas por área (según las etapas y la capacidad diaria de cada área).</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => shift(-1)} className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50">← Semana</button>
          <button onClick={() => setStart(startOfWeek(new Date()))} className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50">Hoy</button>
          <button onClick={() => shift(1)} className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50">Semana →</button>
        </div>
      </div>
      {noCompany && <p className="text-sm text-gray-500">Selecciona una empresa en la barra superior.</p>}
      {error && <div className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      {!noCompany && (
        <>
          <div className="overflow-x-auto">
            <div className="grid min-w-[840px] grid-cols-7 gap-px overflow-hidden rounded-2xl border border-gray-200 bg-gray-200">
              {['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'].map((d) => (
                <div key={d} className="bg-gray-50 px-2 py-1.5 text-center text-xs font-semibold text-gray-500">{d}</div>
              ))}
              {days.map((d) => {
                const k = dayKey(d);
                const list = byDay[k] || [];
                return (
                  <div key={k} className={`min-h-[110px] bg-white p-1.5 ${k === today ? 'ring-2 ring-inset ring-blue-400' : ''}`}>
                    <p className={`text-right text-[11px] ${k === today ? 'font-bold text-blue-600' : 'text-gray-400'}`}>{d.getDate()}{d.getDate() === 1 || d.getTime() === start.getTime() ? ` ${d.toLocaleDateString('es-CL', { month: 'short' })}` : ''}</p>
                    <div className="space-y-1">
                      {list.slice(0, 4).map((o) => (
                        <Link key={o.id} href={`/dashboard/fabricacion/${o.id}`}
                          className={`block truncate rounded px-1.5 py-0.5 text-[11px] ${o.status === 'DONE' ? 'bg-green-50 text-green-700' : o.overdue ? 'bg-red-50 text-red-700' : 'bg-blue-50 text-blue-800'}`}
                          title={`${ofNumber(o.number)} · ${o.productName}`}>
                          {ofNumber(o.number)} {o.productName}
                        </Link>
                      ))}
                      {list.length > 4 && <p className="text-[11px] text-gray-400">+{list.length - 4} más</p>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <section className="mt-6">
            <h2 className="ui-section-title mb-2">Carga por área (horas estimadas / capacidad)</h2>
            {areas.length === 0 ? (
              <p className="text-sm text-gray-400">Crea áreas en Procesos y áreas, y asígnalas a las etapas con horas estimadas para ver la carga.</p>
            ) : (
              <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white">
                <table className="w-full min-w-[840px] text-xs">
                  <thead className="border-b border-gray-100 bg-gray-50 text-gray-500">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium">Área</th>
                      {days.slice(0, 14).map((d) => <th key={dayKey(d)} className="px-1 py-2 text-center font-medium">{d.getDate()}</th>)}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {areas.map((a) => (
                      <tr key={a.id}>
                        <td className="px-3 py-2 font-medium text-gray-800">{a.name}<span className="block font-normal text-gray-400">{a.dailyCapacityHours != null ? `${a.dailyCapacityHours} h/día` : 'sin capacidad definida'}</span></td>
                        {days.slice(0, 14).map((d) => {
                          const h = Math.round((a.load[dayKey(d)] || 0) * 10) / 10;
                          const over = a.dailyCapacityHours != null && h > a.dailyCapacityHours;
                          return (
                            <td key={dayKey(d)} className={`px-1 py-2 text-center ${!h ? 'text-gray-300' : over ? 'bg-red-50 font-semibold text-red-700' : 'text-gray-700'}`}>
                              {h || '·'}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="mt-6">
            <h2 className="ui-section-title mb-2">Entregas del período ({orders.length})</h2>
            <ul className="divide-y divide-gray-100 rounded-2xl border border-gray-200 bg-white">
              {orders.map((o) => (
                <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm">
                  <Link href={`/dashboard/fabricacion/${o.id}`} className="min-w-0 hover:underline">
                    <span className="font-mono text-xs text-gray-500">{ofNumber(o.number)}</span> <span className="font-medium text-gray-900">{o.productName}</span>
                    {o.customerName && <span className="text-gray-500"> · {o.customerName}</span>}
                  </Link>
                  <div className="flex items-center gap-2">
                    <Badge cls={KIND_CLS[o.kind]}>{o.kindLabel}</Badge>
                    <Badge cls={ORDER_STATUS_CLS[o.status]}>{ORDER_STATUS_LABEL[o.status]}</Badge>
                    <span className={`text-xs ${o.overdue ? 'font-semibold text-red-600' : 'text-gray-500'}`}>{o.dueDate ? new Date(o.dueDate).toLocaleDateString('es-CL') : ''}</span>
                  </div>
                </li>
              ))}
              {orders.length === 0 && <li className="px-4 py-6 text-center text-sm text-gray-400">Sin entregas en estas 4 semanas.</li>}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}
