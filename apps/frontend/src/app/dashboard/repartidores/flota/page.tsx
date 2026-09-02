'use client';

import { useEffect, useState } from 'react';
import { getToken } from '@/lib/auth';
import { api } from '@/lib/api';
import { PageHeader, SectionCard, Badge, BrandButton } from '@/components/ui';

const PAY_MODELS = [
  { key: 'FLAT', label: 'Tarifa plana (por día con reparto)' },
  { key: 'PER_PACKAGE', label: 'Por paquete entregado' },
];

export default function FlotaPage() {
  const [drivers, setDrivers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState<any>({});
  const [busy, setBusy] = useState(false);

  async function load() {
    const token = getToken();
    if (!token) return;
    try { setDrivers(await api.drivers.fleet(token)); }
    catch (err: any) { setError(err.message); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  function openEdit(d: any) {
    setEditing(d);
    setForm({
      phone: d.profile?.phone || '',
      zone: d.profile?.zone || '',
      notes: d.profile?.notes || '',
      payModel: d.profile?.payModel || 'FLAT',
      flatRate: d.profile?.flatRate ?? 0,
      perPackageRate: d.profile?.perPackageRate ?? 0,
      active: d.profile?.active ?? true,
    });
  }

  async function save() {
    setBusy(true);
    try {
      await api.drivers.upsertProfile(editing.id, {
        phone: form.phone || undefined,
        zone: form.zone || undefined,
        notes: form.notes || undefined,
        payModel: form.payModel,
        flatRate: Number(form.flatRate) || 0,
        perPackageRate: Number(form.perPackageRate) || 0,
        active: !!form.active,
      }, getToken()!);
      setEditing(null);
      await load();
    } catch (err: any) { setError(err.message); }
    finally { setBusy(false); }
  }

  return (
    <div>
      <PageHeader
        title="Flota"
        crumbs={[{ label: 'Inicio', href: '/dashboard' }, { label: 'Repartidores' }, { label: 'Flota' }]}
      />
      {error && <div className="mb-4 px-4 py-3 rounded-lg text-sm text-[var(--danger)] bg-[var(--danger-bg)]">{error}</div>}

      {loading ? (
        <p className="text-sm text-[var(--text-muted)] py-8 text-center">Cargando…</p>
      ) : drivers.length === 0 ? (
        <SectionCard><p className="text-sm text-[var(--text-muted)] text-center py-6">
          Sin repartidores. Crea usuarios con perfil "Despachador" en Colaboradores → Usuarios.
        </p></SectionCard>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {drivers.map((d) => (
            <SectionCard key={d.id} title={d.name}
              actions={<Badge tone={d.profile?.active === false || !d.active ? 'neutral' : 'ok'}>
                {d.profile?.active === false || !d.active ? 'Inactivo' : 'Activo'}
              </Badge>}>
              <p className="text-xs text-[var(--text-muted)] -mt-2 mb-2">{d.email}</p>
              <dl className="text-sm space-y-1 mb-3">
                <div className="flex justify-between"><dt className="text-[var(--text-muted)]">Teléfono</dt><dd>{d.profile?.phone || '—'}</dd></div>
                <div className="flex justify-between"><dt className="text-[var(--text-muted)]">Zona</dt><dd>{d.profile?.zone || '—'}</dd></div>
                <div className="flex justify-between"><dt className="text-[var(--text-muted)]">Pago</dt><dd>
                  {d.profile?.payModel === 'PER_PACKAGE'
                    ? `$${Number(d.profile.perPackageRate).toLocaleString('es-CL')} / paquete`
                    : `$${Number(d.profile?.flatRate ?? 0).toLocaleString('es-CL')} plano`}
                </dd></div>
                <div className="flex justify-between"><dt className="text-[var(--text-muted)]">Hoy</dt><dd>
                  {d.today.delivered}/{d.today.stops} entregas · {d.today.routes} ruta(s)
                </dd></div>
              </dl>
              <button onClick={() => openEdit(d)}
                className="w-full px-3 py-2 border border-[var(--border)] text-[var(--text-2)] rounded-lg text-sm hover:bg-[var(--surface-soft)]">
                Editar ficha
              </button>
            </SectionCard>
          ))}
        </div>
      )}

      {editing && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="ui-card w-full max-w-md">
            <div className="px-6 py-4 border-b border-[var(--border-soft)]">
              <h2 className="font-semibold text-[var(--text)]">Ficha de {editing.name}</h2>
            </div>
            <div className="px-6 py-4 flex flex-col gap-3">
              <div className="grid grid-cols-2 gap-3">
                <label className="text-xs font-medium text-[var(--text-2)]">Teléfono
                  <input value={form.phone} onChange={(e) => setForm((f: any) => ({ ...f, phone: e.target.value }))}
                    className="mt-1 w-full px-3 py-2 border border-[var(--border)] rounded-lg text-sm" /></label>
                <label className="text-xs font-medium text-[var(--text-2)]">Zona
                  <input value={form.zone} onChange={(e) => setForm((f: any) => ({ ...f, zone: e.target.value }))}
                    className="mt-1 w-full px-3 py-2 border border-[var(--border)] rounded-lg text-sm" /></label>
              </div>
              <label className="text-xs font-medium text-[var(--text-2)]">Modelo de pago
                <select value={form.payModel} onChange={(e) => setForm((f: any) => ({ ...f, payModel: e.target.value }))}
                  className="mt-1 w-full px-3 py-2 border border-[var(--border)] rounded-lg text-sm bg-white">
                  {PAY_MODELS.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
                </select></label>
              <div className="grid grid-cols-2 gap-3">
                <label className="text-xs font-medium text-[var(--text-2)]">Tarifa plana
                  <input type="number" value={form.flatRate} onChange={(e) => setForm((f: any) => ({ ...f, flatRate: e.target.value }))}
                    className="mt-1 w-full px-3 py-2 border border-[var(--border)] rounded-lg text-sm" /></label>
                <label className="text-xs font-medium text-[var(--text-2)]">$ / paquete
                  <input type="number" value={form.perPackageRate} onChange={(e) => setForm((f: any) => ({ ...f, perPackageRate: e.target.value }))}
                    className="mt-1 w-full px-3 py-2 border border-[var(--border)] rounded-lg text-sm" /></label>
              </div>
              <label className="flex items-center gap-2 text-sm text-[var(--text-2)]">
                <input type="checkbox" checked={form.active} onChange={(e) => setForm((f: any) => ({ ...f, active: e.target.checked }))} className="rounded" />
                Repartidor activo
              </label>
              <div className="flex gap-2 pt-1">
                <BrandButton onClick={save} disabled={busy} className="flex-1">{busy ? 'Guardando…' : 'Guardar'}</BrandButton>
                <button onClick={() => setEditing(null)}
                  className="flex-1 px-4 py-2 border border-[var(--border)] text-[var(--text-2)] rounded-lg text-sm hover:bg-[var(--surface-soft)]">Cancelar</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
