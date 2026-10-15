'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getToken, getUser } from '@/lib/auth';
import { api, type SimulationPreview, type SimulationTarget, type SimulationTargets } from '@/lib/api';
import { hasModule, planAllows } from '@/lib/modules';
import { startSimulation } from '@/lib/simulation';
import { useAdminCompany } from '../AdminCompanyContext';
import { navGroups, navItemVisible } from '../navConfig';

type Kind = 'profile' | 'user';

/**
 * Probar permisos (solo Super Admin): elige un perfil o un usuario de la empresa gestionada, revisa
 * qué menús y permisos tendrá, y entra al panel viéndolo como él, en modo solo lectura.
 */
export default function ProbarPermisosPage() {
  const router = useRouter();
  const { selectedCompanyId, companies } = useAdminCompany();
  const [allowed, setAllowed] = useState(false);
  const [targets, setTargets] = useState<SimulationTargets | null>(null);
  const [kind, setKind] = useState<Kind>('profile');
  const [targetId, setTargetId] = useState('');
  const [preview, setPreview] = useState<SimulationPreview | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');

  const companyName = companies.find((c) => c.id === selectedCompanyId)?.name ?? '';

  useEffect(() => {
    const id = requestAnimationFrame(() => {
      if (getUser()?.role !== 'SUPER_ADMIN') { router.replace('/dashboard'); return; }
      setAllowed(true);
    });
    return () => cancelAnimationFrame(id);
  }, [router]);

  useEffect(() => {
    if (!allowed || !selectedCompanyId) return;
    const id = requestAnimationFrame(() => {
      setTargets(null);
      setTargetId('');
      setPreview(null);
      setError('');
      api.simulation.targets(selectedCompanyId, getToken()!)
        .then(setTargets)
        .catch((e) => setError((e as Error).message));
    });
    return () => cancelAnimationFrame(id);
  }, [allowed, selectedCompanyId]);

  const target: SimulationTarget | null = targetId
    ? { companyId: selectedCompanyId, ...(kind === 'user' ? { userId: targetId } : { profileId: targetId }) }
    : null;

  async function choose(k: Kind, id: string) {
    setKind(k);
    setTargetId(id);
    setPreview(null);
    setError('');
    if (!id) return;
    setLoadingPreview(true);
    try {
      setPreview(await api.simulation.preview(
        { companyId: selectedCompanyId, ...(k === 'user' ? { userId: id } : { profileId: id }) }, getToken()!,
      ));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoadingPreview(false);
    }
  }

  async function start() {
    if (!target) return;
    setStarting(true);
    setError('');
    try {
      const r = await api.simulation.start(target, getToken()!);
      startSimulation(r.access_token, r.user);
      // Recarga completa: menú, contexto de empresa y permisos parten con la sesión simulada.
      window.location.href = '/dashboard';
    } catch (e) {
      setError((e as Error).message);
      setStarting(false);
    }
  }

  // Menú que verá (sin las opciones de plataforma, que son solo del Super Admin) y por qué se oculta el resto.
  const menu = useMemo(() => {
    if (!preview) return [];
    const u = preview.user;
    return navGroups
      .map((g) => ({
        label: g.label,
        items: g.items.filter((n) => !n.superOnly).map((n) => {
          const visible = navItemVisible(u, n);
          const reason = visible ? null
            : !hasModule(u, n.module) ? 'Módulo no activo en la empresa'
            : !planAllows(u, n.planFeature) ? 'No incluido en el plan'
            : 'Sin permiso';
          return { href: n.href, label: n.label, visible, reason };
        }),
      }))
      .filter((g) => g.items.length > 0);
  }, [preview]);
  const visibleCount = menu.reduce((n, g) => n + g.items.filter((i) => i.visible).length, 0);

  if (!allowed) return null;
  const who = preview?.user?.simulation;

  return (
    <div className="max-w-6xl">
      <h1 className="ui-page-title mb-1">Probar permisos</h1>
      <p className="ui-page-subtitle mb-5">
        Revisa qué ve un perfil o un usuario de <strong>{companyName || 'la empresa seleccionada'}</strong> y entra al panel como él, en modo solo lectura: ningún cambio se guarda.
      </p>
      {error && <p className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}

      <section className="ui-card mb-5 p-5">
        <h2 className="ui-section-title mb-3">¿A quién quieres simular?</h2>
        <div role="radiogroup" className="mb-3 inline-grid grid-cols-2 gap-1 rounded-lg bg-gray-100 p-1 text-sm font-medium">
          {([['profile', 'Un perfil'], ['user', 'Un usuario']] as [Kind, string][]).map(([k, label]) => (
            <button key={k} type="button" role="radio" aria-checked={kind === k}
              onClick={() => kind !== k && choose(k, '')}
              className={`rounded-md px-4 py-1.5 transition-colors ${kind === k ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-800'}`}>
              {label}
            </button>
          ))}
        </div>
        {!targets ? (
          <p className="text-sm text-gray-500">Cargando…</p>
        ) : kind === 'profile' ? (
          <select className="w-full max-w-md rounded-lg border border-gray-300 px-3 py-2 text-sm" value={targetId} onChange={(e) => choose('profile', e.target.value)}>
            <option value="">Elige un perfil…</option>
            {targets.profiles.map((p) => (
              <option key={p.id} value={p.id}>{p.name} · {p.users} usuario(s)</option>
            ))}
          </select>
        ) : targets.users.length ? (
          <select className="w-full max-w-md rounded-lg border border-gray-300 px-3 py-2 text-sm" value={targetId} onChange={(e) => choose('user', e.target.value)}>
            <option value="">Elige un usuario…</option>
            {targets.users.map((u) => (
              <option key={u.id} value={u.id}>{u.name} — {u.email} · {u.profileName ?? u.roleLabel}</option>
            ))}
          </select>
        ) : (
          <p className="text-sm text-gray-500">La empresa no tiene usuarios activos.</p>
        )}
        <p className="mt-2 text-xs text-gray-500">
          {kind === 'profile'
            ? 'Por perfil se ven sus menús y permisos. Lo propio de cada persona (por ejemplo, la bodega de venta del POS) no aplica.'
            : 'Por usuario se ve exactamente lo de esa persona: su perfil y lo propio de ella, como la bodega de venta del POS.'}
        </p>
      </section>

      {loadingPreview && <p className="mb-5 text-sm text-gray-500">Armando la ficha…</p>}

      {preview && who && (
        <>
          <section className="ui-card mb-5 p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="ui-section-title">
                  {who.mode === 'user' ? who.userName : `Perfil «${who.profileName}»`}
                </h2>
                <p className="mt-1 text-sm text-gray-600">
                  Rol: <strong>{preview.roleLabel}</strong>
                  {who.mode === 'user' && <> · Perfil: <strong>{who.profileName ?? 'sin perfil (permisos del rol)'}</strong></>}
                  {' · '}Plan: <strong>{preview.user.company?.planName ?? 'sin plan'}</strong>
                  {' · '}{visibleCount} opción(es) de menú
                </p>
              </div>
              <button type="button" className="ui-btn-brand" onClick={start} disabled={starting}>
                {starting ? 'Entrando…' : who.mode === 'user' ? 'Ver el panel como este usuario' : 'Ver el panel como este perfil'}
              </button>
            </div>
            {preview.uncovered.length > 0 && (
              <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                Ojo: el perfil incluye {preview.uncovered.join(', ')}, pero con su rol ({preview.roleLabel}) esas páginas no se pueden abrir. Revisa el perfil en Perfiles de acceso.
              </p>
            )}
          </section>

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <section className="ui-card p-5">
              <h2 className="ui-section-title mb-3">Menú que verá</h2>
              <div className="space-y-3">
                {menu.map((g) => (
                  <div key={g.label}>
                    <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">{g.label}</h3>
                    <ul className="space-y-0.5">
                      {g.items.map((i) => (
                        <li key={i.href} className="flex items-center justify-between gap-2 text-sm">
                          <span className={i.visible ? 'text-gray-900' : 'text-gray-400 line-through'}>{i.label}</span>
                          {i.visible
                            ? <span className="ui-badge ui-badge--ok">Visible</span>
                            : <span className="ui-badge ui-badge--neutral">{i.reason}</span>}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </section>

            <section className="ui-card p-5">
              <h2 className="ui-section-title mb-3">Permisos</h2>
              <div className="space-y-3">
                {preview.groups.map((g) => (
                  <div key={g.label}>
                    <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
                      {g.label} <span className="font-normal normal-case">({g.items.filter((i) => i.granted).length}/{g.items.length})</span>
                    </h3>
                    <div className="flex flex-wrap gap-1">
                      {g.items.map((i) => (
                        <span key={i.key} className={i.granted ? 'ui-badge ui-badge--ok' : 'ui-badge ui-badge--neutral line-through opacity-60'}>
                          {i.label}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </div>
        </>
      )}
    </div>
  );
}
