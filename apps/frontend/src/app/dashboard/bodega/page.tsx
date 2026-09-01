'use client';

import { useEffect, useState } from 'react';
import { getToken } from '@/lib/auth';
import { api } from '@/lib/api';
import { PageHeader, SectionCard, StatRow, StatTile, BrandButton } from '@/components/ui';

const roleShort: Record<string, string> = {
  COMPANY_ADMIN: 'Admin', CATALOG_MANAGER: 'Catálogo', VENDEDOR: 'Vendedor', SUPER_ADMIN: 'Super',
};

export default function BodegaBoardPage() {
  const [board, setBoard] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<Date>(new Date());

  async function load() {
    const token = getToken();
    if (!token) return;
    try {
      const b = await api.warehouse.board(token);
      setBoard(b);
      setUpdatedAt(new Date());
    } catch (err: any) {
      setError(err.message || 'No se pudo cargar el tablero');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, []);

  function toggle(id: string) {
    setSelected((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }

  async function distribute() {
    if (selected.size === 0) { setError('Marca al menos un colaborador en turno'); return; }
    setBusy(true); setError('');
    try {
      const res = await api.warehouse.assign({ userIds: [...selected] }, getToken()!);
      await load();
      setError(res.assigned === 0 ? 'No había pedidos sin asignar' : '');
    } catch (err: any) {
      setError(err.message);
    } finally { setBusy(false); }
  }

  async function undo() {
    setBusy(true); setError('');
    try {
      await api.warehouse.resetAssign({}, getToken()!);
      await load();
    } catch (err: any) { setError(err.message); }
    finally { setBusy(false); }
  }

  const maxTp = Math.max(1, ...(board?.throughput || []).map((t: any) => t.packed));

  return (
    <div>
      <PageHeader
        title="Tablero de bodega"
        crumbs={[{ label: 'Inicio', href: '/dashboard' }, { label: 'Bodega' }, { label: 'Tablero' }]}
        updatedAt={updatedAt}
      />

      {error && <div className="mb-4 px-4 py-3 rounded-lg text-sm text-[var(--danger)] bg-[var(--danger-bg)]">{error}</div>}

      {loading ? (
        <p className="text-sm text-[var(--text-muted)] py-8 text-center">Cargando…</p>
      ) : board && (
        <div className="space-y-5">
          <StatRow>
            <StatTile label="Sin asignar" value={board.reparto.unassigned} tone={board.reparto.unassigned > 0 ? 'warn' : undefined} />
            <StatTile label="En picking" value={board.flow.picking.pending} />
            <StatTile label="En packing" value={board.flow.packing.pending} />
            <StatTile label="Empacados hoy" value={board.packedToday} tone="ok" />
          </StatRow>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            <SectionCard title="Reparto del día" className="lg:col-span-1">
              <p className="text-sm text-[var(--text-2)] mb-3">
                <strong>{board.reparto.unassigned}</strong> pedido(s) sin asignar
              </p>
              <p className="text-xs font-medium text-[var(--text-muted)] mb-2">Colaboradores en turno hoy</p>
              <div className="space-y-1.5 mb-4 max-h-52 overflow-y-auto">
                {board.collaborators.map((c: any) => (
                  <label key={c.id} className="flex items-center gap-2 text-sm cursor-pointer">
                    <input type="checkbox" checked={selected.has(c.id)} onChange={() => toggle(c.id)} className="rounded" />
                    <span className="text-[var(--text)]">{c.name}</span>
                    <span className="text-xs text-[var(--text-muted)]">{roleShort[c.role] || c.role}</span>
                  </label>
                ))}
                {board.collaborators.length === 0 && <p className="text-xs text-[var(--text-muted)]">Sin colaboradores de bodega</p>}
              </div>
              <div className="flex gap-2">
                <BrandButton onClick={distribute} disabled={busy} className="flex-1">
                  {busy ? 'Repartiendo…' : 'Repartir ahora'}
                </BrandButton>
                <button onClick={undo} disabled={busy}
                  className="px-3 py-2 border border-[var(--border)] text-[var(--text-2)] rounded-lg text-sm hover:bg-[var(--surface-soft)]">
                  Deshacer
                </button>
              </div>
            </SectionCard>

            <SectionCard title="Flujo de bodega" className="lg:col-span-2">
              <div className="space-y-4">
                {(['picking', 'packing'] as const).map((k) => {
                  const f = board.flow[k];
                  return (
                    <div key={k}>
                      <div className="flex justify-between text-sm mb-1">
                        <span className="font-medium capitalize text-[var(--text)]">{k}</span>
                        <span className="text-[var(--text-2)]">{f.pct}% · {f.pending} pendientes</span>
                      </div>
                      <div className="h-2 rounded-full bg-[var(--border-soft)] overflow-hidden">
                        <div className="h-full bg-[var(--brand)]" style={{ width: `${f.pct}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>

              <p className="text-xs font-medium text-[var(--text-muted)] mt-5 mb-2">Empacado por hora (hoy)</p>
              <div className="flex items-end gap-0.5 h-20">
                {board.throughput.map((t: any) => (
                  <div key={t.hour} className="flex-1 bg-[var(--brand-soft)] rounded-sm relative group" style={{ height: `${(t.packed / maxTp) * 100}%`, minHeight: t.packed ? 4 : 0 }}
                    title={`${String(t.hour).padStart(2, '0')}:00 · ${t.packed}`}>
                    <div className="absolute inset-0 bg-[var(--brand)] rounded-sm opacity-0 group-hover:opacity-100" />
                  </div>
                ))}
              </div>
            </SectionCard>
          </div>

          <SectionCard title="Rendimiento por colaborador (hoy)">
            <div className="overflow-x-auto -m-5">
              <table className="w-full text-sm">
                <thead className="bg-[var(--surface-soft)] border-b border-[var(--border-soft)]">
                  <tr>
                    <th className="text-left px-5 py-2.5 font-medium text-[var(--text-2)]">Colaborador</th>
                    <th className="text-left px-5 py-2.5 font-medium text-[var(--text-2)]">Estado</th>
                    <th className="text-right px-5 py-2.5 font-medium text-[var(--text-2)]">Asignados</th>
                    <th className="text-right px-5 py-2.5 font-medium text-[var(--text-2)]">Pickeados</th>
                    <th className="text-right px-5 py-2.5 font-medium text-[var(--text-2)]">Empacados</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border-soft)]">
                  {board.collaborators.map((c: any) => (
                    <tr key={c.id}>
                      <td className="px-5 py-2.5 font-medium text-[var(--text)]">{c.name}</td>
                      <td className="px-5 py-2.5 text-xs text-[var(--text-muted)]">{c.active ? 'Activo hoy' : 'Sin actividad'}</td>
                      <td className="px-5 py-2.5 text-right text-[var(--text-2)]">{c.assigned}</td>
                      <td className="px-5 py-2.5 text-right text-[var(--text-2)]">{c.picked}</td>
                      <td className="px-5 py-2.5 text-right text-[var(--text-2)]">{c.packed}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </SectionCard>
        </div>
      )}
    </div>
  );
}
