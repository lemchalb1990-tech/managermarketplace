'use client';

import { useEffect, useState, FormEvent } from 'react';
import { getToken } from '@/lib/auth';
import { api } from '@/lib/api';
import { Toast } from '@/components/ui';
import { SkeletonRows } from '@/components/Skeleton';
import { Invitations } from './Invitations';
import { DeleteUserModal } from './DeleteUserModal';

const roleLabels: Record<string, string> = {
  SUPER_ADMIN: 'Super Admin',
  COMPANY_ADMIN: 'Admin empresa',
  CATALOG_MANAGER: 'Gestor catálogo',
  VENDEDOR: 'Vendedor',
  DESPACHADOR: 'Despachador',
  ORDER_MANAGER: 'Admin. Pedidos',
};

const roleBadge: Record<string, string> = {
  SUPER_ADMIN: 'bg-purple-100 text-purple-700',
  COMPANY_ADMIN: 'bg-blue-100 text-blue-700',
  CATALOG_MANAGER: 'bg-green-100 text-green-700',
  VENDEDOR: 'bg-orange-100 text-orange-700',
  DESPACHADOR: 'bg-teal-100 text-teal-700',
  ORDER_MANAGER: 'bg-indigo-100 text-indigo-700',
};

const emptyForm = { name: '', email: '', password: '', companyId: '', accessProfileId: '' };
const emptyEdit = { name: '', role: '', password: '', active: true, accessProfileId: '' };

export default function UsersPage() {
  const [users, setUsers] = useState<any[]>([]);
  const [usersLoaded, setUsersLoaded] = useState(false);
  const [companies, setCompanies] = useState<any[]>([]);
  const [profiles, setProfiles] = useState<any[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const [pendingInvites, setPendingInvites] = useState(0);
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [myCompany, setMyCompany] = useState<any>(null);

  const [editUser, setEditUser] = useState<any>(null);
  const [editForm, setEditForm] = useState(emptyEdit);
  const [editLoading, setEditLoading] = useState(false);
  const [editError, setEditError] = useState('');
  const [toast, setToast] = useState<string | null>(null);
  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(null), 2500); };
  const [showPassword, setShowPassword] = useState(false);

  const [resetUser, setResetUser] = useState<any>(null);
  const [resetPwd, setResetPwd] = useState('');
  const [resetGenerated, setResetGenerated] = useState(false);
  const [resetLoading, setResetLoading] = useState(false);
  const [resetError, setResetError] = useState('');
  const [resetSaved, setResetSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const [deleteUser, setDeleteUser] = useState<any>(null);

  async function load() {
    const token = getToken();
    if (!token) return;
    const me = await api.me(token);
    setCurrentUser(me);
    const data = await api.users.list(token);
    setUsers(data);
    setUsersLoaded(true);
    api.accessProfiles.list(token).then(setProfiles).catch(() => setProfiles([]));
    if (me.role === 'SUPER_ADMIN') {
      const comps = await api.companies.list(token);
      setCompanies(comps);
    } else if (me.company) {
      const companyUsers = data.filter((u: any) => u.company?.id === me.company.id);
      setMyCompany({ ...me.company, _count: { users: companyUsers.length } });
    }
  }

  useEffect(() => { load(); }, []);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const token = getToken()!;
      const payload: any = { name: form.name, email: form.email, password: form.password };
      // Super Admin sin empresa = otro Super Admin; si no, el perfil de acceso define todo.
      if (isSuperAdmin && !form.companyId) payload.role = 'SUPER_ADMIN';
      if (form.companyId) payload.companyId = form.companyId;
      if (form.accessProfileId) payload.accessProfileId = form.accessProfileId;
      await api.users.create(payload, token);
      setForm(emptyForm);
      setShowForm(false);
      await load();
      flash('Usuario creado');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  function openEdit(u: any) {
    setEditUser(u);
    setEditForm({
      name: u.name,
      role: u.role,
      password: '',
      active: u.active,
      accessProfileId: u.accessProfile?.id || '',
    });
    setEditError('');
    setShowPassword(false);
  }

  async function handleEdit(e: FormEvent) {
    e.preventDefault();
    setEditError('');
    setEditLoading(true);
    try {
      const token = getToken()!;
      const payload: any = {
        name: editForm.name,
        active: editForm.active,
        ...(editUser.role !== 'SUPER_ADMIN' ? { accessProfileId: editForm.accessProfileId || null } : {}),
      };
      if (editForm.password) payload.password = editForm.password;
      await api.users.update(editUser.id, payload, token);
      setEditUser(null);
      await load();
      flash('Modificación realizada');
    } catch (err: any) {
      setEditError(err.message);
    } finally {
      setEditLoading(false);
    }
  }

  function openReset(u: any) {
    setResetUser(u);
    setResetPwd('');
    setResetGenerated(false);
    setResetError('');
    setResetSaved(false);
    setCopied(false);
  }

  function generatePassword() {
    const charset = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%&*?-_';
    const len = 14;
    const arr = new Uint32Array(len);
    crypto.getRandomValues(arr);
    let pwd = Array.from(arr, (n) => charset[n % charset.length]).join('');
    if (!/[0-9]/.test(pwd)) pwd = '7' + pwd.slice(1);
    if (!/[!@#$%&*?_-]/.test(pwd)) pwd = pwd.slice(0, -1) + '#';
    setResetPwd(pwd);
    setResetGenerated(true);
    setResetError('');
  }

  async function copyResetPwd() {
    try {
      await navigator.clipboard.writeText(resetPwd);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard no disponible */
    }
  }

  async function handleReset(e: FormEvent) {
    e.preventDefault();
    setResetError('');
    if (resetPwd.length < 6) {
      setResetError('La contraseña debe tener al menos 6 caracteres');
      return;
    }
    setResetLoading(true);
    try {
      const token = getToken()!;
      await api.users.update(resetUser.id, { password: resetPwd }, token);
      setResetSaved(true);
    } catch (err: any) {
      setResetError(err.message);
    } finally {
      setResetLoading(false);
    }
  }

  const isSuperAdmin = currentUser?.role === 'SUPER_ADMIN';
  // Perfiles que se pueden asignar en una empresa (los de esa empresa y las plantillas globales del Super Admin).
  const profilesFor = (companyId?: string | null) => profiles.filter((p) =>
    (p.company?.id ?? p.companyId ?? null) === (companyId ?? null) || (isSuperAdmin && !(p.company?.id ?? p.companyId)));
  const userCount = myCompany?._count?.users ?? users.length;
  const maxUsers = myCompany?.maxUsers;
  // Las invitaciones pendientes también ocupan cupo del plan.
  const atLimit = maxUsers != null && userCount + pendingInvites >= maxUsers;


  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <div>
          <h1 className="ui-page-title">Usuarios</h1>
          {!isSuperAdmin && myCompany && (
            <p className={`text-xs mt-0.5 ${atLimit ? 'text-red-600 font-medium' : 'text-gray-500'}`}>
              {userCount} de {maxUsers} usuarios utilizados
              {pendingInvites > 0 && ` (+${pendingInvites} invitación(es) pendiente(s))`}
              {atLimit && ' — límite alcanzado'}
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => { setShowForm(!showForm); setShowInvite(false); }} disabled={!isSuperAdmin && atLimit}
            className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed">
            Crear sin invitación
          </button>
          <button onClick={() => { setShowInvite(!showInvite); setShowForm(false); }} disabled={!isSuperAdmin && atLimit}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed">
            + Invitar usuario
          </button>
        </div>
      </div>

      <Invitations open={showInvite} onClose={() => setShowInvite(false)} isSuperAdmin={isSuperAdmin} companies={companies}
        profiles={profiles} onChanged={load} onPending={setPendingInvites} />

      {showForm && (
        <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
          <h2 className="ui-section-title mb-1">Crear usuario sin invitación</h2>
          <p className="text-xs text-gray-500 mb-4">Defines la contraseña y se la entregas a la persona. Si prefieres que la cree ella, usa “Invitar usuario”.</p>
          <form onSubmit={handleCreate} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Nombre *</label>
              <input value={form.name} onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))}
                required className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Email *</label>
              <input type="email" value={form.email} onChange={(e) => setForm(f => ({ ...f, email: e.target.value }))}
                required className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Contraseña *</label>
              <input type="password" value={form.password} onChange={(e) => setForm(f => ({ ...f, password: e.target.value }))}
                required className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
            </div>
            {isSuperAdmin && (
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Empresa</label>
                <select value={form.companyId} onChange={(e) => setForm(f => ({ ...f, companyId: e.target.value, accessProfileId: '' }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
                  <option value="">Sin empresa (Super Admin)</option>
                  {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
            )}
            {(!isSuperAdmin || form.companyId) && (
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Perfil de acceso *</label>
                <select value={form.accessProfileId} onChange={(e) => setForm(f => ({ ...f, accessProfileId: e.target.value }))} required
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
                  <option value="">Elige un perfil…</option>
                  {profilesFor(form.companyId || currentUser?.companyId).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                <p className="text-[11px] text-gray-400 mt-0.5">El perfil define dónde entra y qué puede hacer. Se crean y editan en Perfiles de acceso.</p>
              </div>
            )}
            {error && <p className="col-span-2 text-red-600 text-sm">{error}</p>}
            <div className="col-span-2 flex gap-2">
              <button type="submit" disabled={loading}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
                {loading ? 'Creando...' : 'Crear usuario'}
              </button>
              <button type="button" onClick={() => { setShowForm(false); setForm(emptyForm); }}
                className="px-4 py-2 border border-gray-300 text-gray-600 rounded-lg text-sm hover:bg-gray-50">
                Cancelar
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="text-left px-4 py-3 text-gray-600 font-medium">Nombre</th>
              <th className="text-left px-4 py-3 text-gray-600 font-medium">Email</th>
              <th className="text-left px-4 py-3 text-gray-600 font-medium">Perfil</th>
              <th className="text-left px-4 py-3 text-gray-600 font-medium">Empresa</th>
              <th className="text-left px-4 py-3 text-gray-600 font-medium">Estado</th>
              <th className="text-left px-4 py-3 text-gray-600 font-medium">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {users.map((u) => (
              <tr key={u.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 font-medium text-gray-900">{u.name}</td>
                <td className="px-4 py-3 text-gray-500">{u.email}</td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${u.role === 'SUPER_ADMIN' ? roleBadge.SUPER_ADMIN : 'bg-blue-50 text-blue-700'}`}>
                    {u.role === 'SUPER_ADMIN' ? 'Super Admin' : u.accessProfile?.name || roleLabels[u.role] || u.role}
                  </span>
                </td>
                <td className="px-4 py-3 text-gray-600">{u.company?.name || '—'}</td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${u.active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                    {u.active ? 'Activo' : 'Inactivo'}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex gap-3">
                    <button onClick={() => openEdit(u)}
                      className="text-blue-600 hover:text-blue-800 text-xs font-medium">
                      Editar
                    </button>
                    <button onClick={() => openReset(u)}
                      className="text-amber-600 hover:text-amber-800 text-xs font-medium">
                      Restablecer clave
                    </button>
                    {isSuperAdmin && u.role !== 'SUPER_ADMIN' && u.id !== currentUser?.id && (
                      <button onClick={() => setDeleteUser(u)}
                        className="text-red-600 hover:text-red-800 text-xs font-medium">
                        Eliminar
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {!usersLoaded && <SkeletonRows cols={6} rows={5} />}
            {usersLoaded && users.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">Sin usuarios registrados</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Modal de edición */}
      {editUser && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto">
            <div className="px-6 py-4 border-b border-gray-100">
              <h2 className="ui-section-title">Editar usuario</h2>
              <p className="text-xs text-gray-400 mt-0.5">{editUser.email}</p>
            </div>
            <form onSubmit={handleEdit} className="px-6 py-4 flex flex-col gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Nombre *</label>
                <input value={editForm.name}
                  onChange={(e) => setEditForm(f => ({ ...f, name: e.target.value }))}
                  required className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
              </div>
              {editUser.role === 'SUPER_ADMIN' ? (
                <p className="rounded-lg bg-purple-50 px-3 py-2 text-xs text-purple-700">Super Admin: acceso total a la plataforma.</p>
              ) : (
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Perfil de acceso *</label>
                  <select value={editForm.accessProfileId} required
                    onChange={(e) => setEditForm(f => ({ ...f, accessProfileId: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
                    <option value="">Elige un perfil…</option>
                    {profilesFor(editUser.company?.id).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                  <p className="text-xs text-gray-400 mt-0.5">El perfil define dónde entra y qué puede hacer.</p>
                </div>
              )}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  Nueva contraseña <span className="text-gray-400">(dejar en blanco para no cambiar)</span>
                </label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={editForm.password}
                    onChange={(e) => setEditForm(f => ({ ...f, password: e.target.value }))}
                    placeholder="••••••"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm pr-16" />
                  <button type="button" onClick={() => setShowPassword(v => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-500 hover:text-gray-800">
                    {showPassword ? 'Ocultar' : 'Mostrar'}
                  </button>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <input type="checkbox" id="active-toggle" checked={editForm.active}
                  onChange={(e) => setEditForm(f => ({ ...f, active: e.target.checked }))}
                  className="rounded" />
                <label htmlFor="active-toggle" className="text-sm text-gray-700">Usuario activo</label>
              </div>

              {editError && <p className="text-red-600 text-sm">{editError}</p>}

              <div className="flex gap-2 pt-1">
                <button type="submit" disabled={editLoading}
                  className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
                  {editLoading ? 'Guardando...' : 'Guardar cambios'}
                </button>
                <button type="button" onClick={() => setEditUser(null)}
                  className="flex-1 px-4 py-2 border border-gray-300 text-gray-600 rounded-lg text-sm hover:bg-gray-50">
                  Cancelar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal de restablecer contraseña */}
      {resetUser && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
            <div className="px-6 py-4 border-b border-gray-100">
              <h2 className="ui-section-title">Restablecer contraseña</h2>
              <p className="text-xs text-gray-400 mt-0.5">{resetUser.name} — {resetUser.email}</p>
            </div>

            {resetSaved ? (
              <div className="px-6 py-5 flex flex-col gap-4">
                <div className="rounded-lg bg-green-50 border border-green-200 px-3 py-2 text-sm text-green-700">
                  Contraseña actualizada. Cópiala y entrégasela al usuario — no se volverá a mostrar.
                </div>
                <div className="flex items-center gap-2">
                  <code className="flex-1 px-3 py-2 bg-gray-100 rounded-lg text-sm font-mono break-all">{resetPwd}</code>
                  <button type="button" onClick={copyResetPwd}
                    className="px-3 py-2 border border-gray-300 rounded-lg text-xs whitespace-nowrap hover:bg-gray-50">
                    {copied ? 'Copiado' : 'Copiar'}
                  </button>
                </div>
                <button type="button" onClick={() => setResetUser(null)}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700">
                  Listo
                </button>
              </div>
            ) : (
              <form onSubmit={handleReset} className="px-6 py-4 flex flex-col gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Nueva contraseña</label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={resetPwd}
                      onChange={(e) => { setResetPwd(e.target.value); setResetGenerated(false); }}
                      placeholder="Mínimo 6 caracteres"
                      autoFocus
                      className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono" />
                    <button type="button" onClick={generatePassword}
                      className="px-3 py-2 border border-gray-300 rounded-lg text-xs whitespace-nowrap hover:bg-gray-50">
                      Generar
                    </button>
                  </div>
                  {resetGenerated && (
                    <p className="text-xs text-amber-600 mt-1">Contraseña generada — cópiala al guardar, no se volverá a mostrar.</p>
                  )}
                </div>

                {resetError && <p className="text-red-600 text-sm">{resetError}</p>}

                <div className="flex gap-2 pt-1">
                  <button type="submit" disabled={resetLoading}
                    className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
                    {resetLoading ? 'Guardando...' : 'Guardar contraseña'}
                  </button>
                  <button type="button" onClick={() => setResetUser(null)}
                    className="flex-1 px-4 py-2 border border-gray-300 text-gray-600 rounded-lg text-sm hover:bg-gray-50">
                    Cancelar
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {deleteUser && (
        <DeleteUserModal user={deleteUser} onClose={() => setDeleteUser(null)}
          onDeleted={async (msg) => { setDeleteUser(null); await load(); flash(msg); }} />
      )}

      {toast && <Toast message={toast} onClose={() => setToast(null)} />}
    </div>
  );
}
