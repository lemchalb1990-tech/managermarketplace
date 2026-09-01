'use client';

import { useEffect, useMemo, useState, FormEvent } from 'react';
import { getToken } from '@/lib/auth';
import { api } from '@/lib/api';
import { PageHeader, SectionCard, Badge, BrandButton } from '@/components/ui';

type Group = { key: string; label: string; items: { key: string; label: string }[] };
type Profile = {
  id: string;
  name: string;
  permissions: string[];
  isSystem: boolean;
  companyId: string | null;
  company?: { id: string; name: string } | null;
  _count?: { users: number };
};

export default function AccessProfilesPage() {
  const [me, setMe] = useState<any>(null);
  const [groups, setGroups] = useState<Group[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [companies, setCompanies] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [editing, setEditing] = useState<Profile | 'new' | null>(null);
  const [form, setForm] = useState<{ name: string; permissions: string[]; companyId: string }>({
    name: '', permissions: [], companyId: '',
  });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  const isSuperAdmin = me?.role === 'SUPER_ADMIN';
  const allKeys = useMemo(() => groups.flatMap((g) => g.items.map((i) => i.key)), [groups]);

  async function load() {
    const token = getToken();
    if (!token) return;
    setLoading(true);
    try {
      const user = await api.me(token);
      setMe(user);
      const [cat, list] = await Promise.all([
        api.accessProfiles.catalog(token),
        api.accessProfiles.list(token),
      ]);
      setGroups(cat);
      setProfiles(list);
      if (user.role === 'SUPER_ADMIN') {
        setCompanies(await api.companies.list(token).catch(() => []));
      }
    } catch (err: any) {
      setError(err.message || 'No se pudo cargar');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  function openNew() {
    setForm({ name: '', permissions: [], companyId: '' });
    setFormError('');
    setEditing('new');
  }
  function openEdit(p: Profile) {
    setForm({ name: p.name, permissions: [...p.permissions], companyId: p.companyId || '' });
    setFormError('');
    setEditing(p);
  }

  const hasKey = (k: string) => form.permissions.includes('*') || form.permissions.includes(k);
  function toggleKey(k: string) {
    setForm((f) => {
      const has = f.permissions.includes(k);
      return { ...f, permissions: has ? f.permissions.filter((x) => x !== k) : [...f.permissions, k] };
    });
  }
  function toggleGroup(g: Group) {
    const keys = g.items.map((i) => i.key);
    const allOn = keys.every((k) => form.permissions.includes(k));
    setForm((f) => ({
      ...f,
      permissions: allOn
        ? f.permissions.filter((k) => !keys.includes(k))
        : Array.from(new Set([...f.permissions, ...keys])),
    }));
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    setFormError('');
    if (form.name.trim().length < 2) { setFormError('El nombre es muy corto'); return; }
    if (form.permissions.length === 0) { setFormError('Selecciona al menos un permiso'); return; }
    setSaving(true);
    try {
      const token = getToken()!;
      if (editing === 'new') {
        await api.accessProfiles.create(
          { name: form.name.trim(), permissions: form.permissions, ...(isSuperAdmin && form.companyId ? { companyId: form.companyId } : {}) },
          token,
        );
      } else if (editing) {
        await api.accessProfiles.update(editing.id, { name: form.name.trim(), permissions: form.permissions }, token);
      }
      setEditing(null);
      await load();
    } catch (err: any) {
      setFormError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function remove(p: Profile) {
    if (!confirm(`¿Eliminar el perfil "${p.name}"?`)) return;
    try {
      await api.accessProfiles.remove(p.id, getToken()!);
      await load();
    } catch (err: any) {
      setError(err.message);
    }
  }

  return (
    <div>
      <PageHeader
        title="Perfiles de acceso"
        crumbs={[{ label: 'Inicio', href: '/dashboard' }, { label: 'Colaboradores' }, { label: 'Perfiles de acceso' }]}
        actions={<BrandButton onClick={openNew}>+ Nuevo perfil</BrandButton>}
      />

      {error && (
        <div className="mb-4 px-4 py-3 rounded-lg text-sm text-[var(--danger)] bg-[var(--danger-bg)]">{error}</div>
      )}

      <SectionCard>
        {loading ? (
          <p className="text-sm text-[var(--text-muted)] py-6 text-center">Cargando…</p>
        ) : (
          <div className="overflow-x-auto -m-5">
            <table className="w-full text-sm">
              <thead className="bg-[var(--surface-soft)] border-b border-[var(--border-soft)]">
                <tr>
                  <th className="text-left px-5 py-3 font-medium text-[var(--text-2)]">Nombre</th>
                  {isSuperAdmin && <th className="text-left px-5 py-3 font-medium text-[var(--text-2)]">Empresa</th>}
                  <th className="text-left px-5 py-3 font-medium text-[var(--text-2)]">Permisos</th>
                  <th className="text-left px-5 py-3 font-medium text-[var(--text-2)]">Usuarios</th>
                  <th className="px-5 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-soft)]">
                {profiles.map((p) => (
                  <tr key={p.id} className="hover:bg-[var(--surface-soft)]">
                    <td className="px-5 py-3 font-medium text-[var(--text)]">
                      {p.name} {p.isSystem && <Badge tone="info">sistema</Badge>}
                    </td>
                    {isSuperAdmin && (
                      <td className="px-5 py-3 text-[var(--text-2)]">{p.company?.name || <span className="text-[var(--text-muted)]">Global</span>}</td>
                    )}
                    <td className="px-5 py-3">
                      {p.permissions.includes('*')
                        ? <Badge tone="ok">Todos los permisos</Badge>
                        : <span className="text-[var(--text-2)]">{p.permissions.length} permisos</span>}
                    </td>
                    <td className="px-5 py-3 text-[var(--text-2)]">{p._count?.users ?? 0}</td>
                    <td className="px-5 py-3 text-right whitespace-nowrap">
                      {!p.isSystem && (
                        <>
                          <button onClick={() => openEdit(p)} className="text-[var(--info)] hover:underline text-xs font-medium mr-3">Editar</button>
                          <button onClick={() => remove(p)} className="text-[var(--danger)] hover:underline text-xs font-medium">Eliminar</button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
                {profiles.length === 0 && (
                  <tr><td colSpan={isSuperAdmin ? 5 : 4} className="px-5 py-10 text-center text-[var(--text-muted)]">Sin perfiles creados</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      {editing && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="ui-card w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="px-6 py-4 border-b border-[var(--border-soft)]">
              <h2 className="font-semibold text-[var(--text)]">{editing === 'new' ? 'Crear perfil de acceso' : 'Editar perfil'}</h2>
            </div>
            <form onSubmit={save} className="px-6 py-4 flex flex-col gap-4">
              <div>
                <label className="block text-xs font-medium text-[var(--text-2)] mb-1">Nombre del perfil</label>
                <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="Ej: Operador de bodega" autoFocus
                  className="w-full px-3 py-2 border border-[var(--border)] rounded-lg text-sm" />
              </div>

              {isSuperAdmin && editing === 'new' && (
                <div>
                  <label className="block text-xs font-medium text-[var(--text-2)] mb-1">Empresa (vacío = plantilla global)</label>
                  <select value={form.companyId} onChange={(e) => setForm((f) => ({ ...f, companyId: e.target.value }))}
                    className="w-full px-3 py-2 border border-[var(--border)] rounded-lg text-sm bg-white">
                    <option value="">— Global —</option>
                    {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
              )}

              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-medium text-[var(--text-2)]">Permisos</label>
                  <span className="text-xs text-[var(--text-muted)]">{form.permissions.filter((k) => k !== '*').length} de {allKeys.length}</span>
                </div>
                <div className="border border-[var(--border)] rounded-xl divide-y divide-[var(--border-soft)]">
                  {groups.map((g) => {
                    const keys = g.items.map((i) => i.key);
                    const allOn = keys.every((k) => hasKey(k));
                    const someOn = keys.some((k) => hasKey(k));
                    return (
                      <div key={g.key} className="p-3">
                        <label className="flex items-center gap-2 mb-1.5 cursor-pointer">
                          <input type="checkbox" checked={allOn} ref={(el) => { if (el) el.indeterminate = !allOn && someOn; }}
                            onChange={() => toggleGroup(g)} className="rounded" />
                          <span className="text-sm font-semibold text-[var(--text)]">{g.label}</span>
                        </label>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1 pl-6">
                          {g.items.map((it) => (
                            <label key={it.key} className="flex items-center gap-2 text-sm text-[var(--text-2)] cursor-pointer">
                              <input type="checkbox" checked={hasKey(it.key)} onChange={() => toggleKey(it.key)} className="rounded" />
                              {it.label}
                            </label>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {formError && <p className="text-sm text-[var(--danger)]">{formError}</p>}

              <div className="flex gap-2 pt-1">
                <BrandButton type="submit" disabled={saving} className="flex-1">
                  {saving ? 'Guardando…' : 'Guardar'}
                </BrandButton>
                <button type="button" onClick={() => setEditing(null)}
                  className="flex-1 px-4 py-2 border border-[var(--border)] text-[var(--text-2)] rounded-lg text-sm hover:bg-[var(--surface-soft)]">
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
