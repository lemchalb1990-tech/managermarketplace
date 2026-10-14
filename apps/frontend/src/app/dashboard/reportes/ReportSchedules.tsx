'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { getToken, getUser } from '@/lib/auth';
import { api, type ReportSchedule, type SalesReportType } from '@/lib/api';

const DAYS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
const hh = (h: number) => `${String(h).padStart(2, '0')}:00`;

// Envío programado por correo: cada semana, el día y la hora elegidos, llega el reporte de los
// últimos 7 días con el Excel adjunto.
export function ReportSchedules({ type, titles, companyId }: { type: SalesReportType; titles: Record<SalesReportType, string>; companyId?: string }) {
  const [list, setList] = useState<ReportSchedule[] | null>(null);
  const [form, setForm] = useState<{ email: string; weekday: number; hour: number } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    const token = getToken();
    if (!token) return;
    api.reports.schedules.list(token, companyId).then(setList).catch(() => setList([]));
  }, [companyId]);

  useEffect(() => { load(); }, [load]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!form) return;
    setSaving(true);
    setError('');
    try {
      await api.reports.schedules.create({ type, ...form }, getToken()!, companyId);
      setForm(null);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo programar.');
    }
    setSaving(false);
  }

  async function remove(id: string) {
    await api.reports.schedules.remove(id, getToken()!, companyId).catch(() => null);
    load();
  }

  const inputCls = 'border border-gray-300 rounded-lg px-2 py-1.5 text-sm bg-white';

  return (
    <div className="ui-card p-4 flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2 justify-between">
        <div>
          <p className="text-sm font-semibold text-[var(--text)]">📧 Envío por correo</p>
          <p className="text-xs text-[var(--text-muted)]">Cada semana llega el reporte de los últimos 7 días, con el Excel adjunto.</p>
        </div>
        {!form && (
          <button type="button" onClick={() => setForm({ email: getUser()?.email || '', weekday: 1, hour: 8 })} className="ui-btn-secondary !py-1.5 text-xs">
            Programar «{titles[type]}»
          </button>
        )}
      </div>

      {form && (
        <form onSubmit={submit} className="flex flex-wrap items-end gap-2 border border-dashed border-[var(--border)] rounded-xl p-3 bg-[var(--surface-soft)]">
          <label className="text-xs text-[var(--text-muted)] flex-1 min-w-[200px]">Correo
            <input type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className={`${inputCls} block w-full`} placeholder="administracion@empresa.cl" />
          </label>
          <label className="text-xs text-[var(--text-muted)]">Día
            <select value={form.weekday} onChange={(e) => setForm({ ...form, weekday: Number(e.target.value) })} className={`${inputCls} block`}>
              {DAYS.map((d, i) => <option key={d} value={i + 1}>{d}</option>)}
            </select>
          </label>
          <label className="text-xs text-[var(--text-muted)]">Hora
            <select value={form.hour} onChange={(e) => setForm({ ...form, hour: Number(e.target.value) })} className={`${inputCls} block`}>
              {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{hh(h)}</option>)}
            </select>
          </label>
          <button type="button" onClick={() => { setForm(null); setError(''); }} className="ui-btn-secondary !py-1.5 text-xs">Cancelar</button>
          <button type="submit" disabled={saving} className="ui-btn-brand !py-1.5 text-xs disabled:opacity-50">{saving ? 'Guardando…' : 'Programar'}</button>
          {error && <p className="w-full text-xs text-[var(--danger)]">{error}</p>}
        </form>
      )}

      {list && list.length > 0 && (
        <ul className="divide-y divide-[var(--border-soft)]">
          {list.map((s) => (
            <li key={s.id} className="py-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
              <span className="font-medium text-[var(--text)]">{titles[s.type] || s.type}</span>
              <span className="text-[var(--text-2)]">{DAYS[s.weekday - 1]} a las {hh(s.hour)} → {s.email}</span>
              <span className="text-xs text-[var(--text-muted)]">{s.lastSentAt ? `Último envío: ${new Date(s.lastSentAt).toLocaleDateString('es-CL')}` : 'Aún no se envía'}</span>
              <button type="button" onClick={() => remove(s.id)} className="ml-auto text-xs text-[var(--danger)] hover:underline">Quitar</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
