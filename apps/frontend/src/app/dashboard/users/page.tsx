'use client';

import { useEffect, useState, FormEvent } from 'react';
import { getToken } from '@/lib/auth';
import { api } from '@/lib/api';

const ALL_ROLES = [
  { value: 'COMPANY_ADMIN', label: 'Admin de empresa' },
  { value: 'CATALOG_MANAGER', label: 'Gestor de catálogo' },
  { value: 'VENDEDOR', label: 'Vendedor (solo POS)' },
  { value: 'DESPACHADOR', label: 'Despachador (solo rutas)' },
];

const roleLabels: Record<string, string> = {
  SUPER_ADMIN: 'Super Admin',
  COMPANY_ADMIN: 'Admin empresa',
  CATALOG_MANAGER: 'Gestor catálogo',
  VENDEDOR: 'Vendedor',
  DESPACHADOR: 'Despachador',
};

const roleBadge: Record<string, string> = {
  SUPER_ADMIN: 'bg-purple-100 text-purple-700',
  COMPANY_ADMIN: 'bg-blue-100 text-blue-700',
  CATALOG_MANAGER: 'bg-green-100 text-green-700',
  VENDEDOR: 'bg-orange-100 text-orange-700',
  DESPACHADOR: 'bg-teal-100 text-teal-700',
};

const ALL_MODULES = [
  { key: 'catalog', label: 'Catálogo', description: 'Gestión de productos e imágenes' },
  { key: 'ecommerce_ml', label: 'Mercado Libre', description: 'Publicaciones en Mercado Libre Chile' },
  { key: 'ecommerce_shopify', label: 'Shopify', description: 'Sincronización con tienda Shopify' },
  { key: 'ecommerce_woocommerce', label: 'WooCommerce', description: 'Sincronización con WooCommerce' },
  { key: 'ecommerce_jumpseller', label: 'JumpSeller', description: 'Sincronización con JumpSeller' },
  { key: 'ecommerce_falabella', label: 'Falabella', description: 'Publicaciones en Falabella Marketplace' },
  { key: 'ecommerce_paris', label: 'Paris', description: 'Publicaciones en Paris Marketplace' },
  { key: 'ecommerce_hites', label: 'Hites', description: 'Publicaciones en Hites Marketplace' },
  { key: 'ecommerce_ripley', label: 'Ripley', description: 'Publicaciones en Ripley Marketplace' },
  { key: 'ecommerce_walmart', label: 'Walmart', description: 'Publicaciones en Walmart Chile' },
  { key: 'pos', label: 'Punto de Venta', description: 'Terminal de ventas físicas' },
  { key: 'sales', label: 'Ventas', description: 'Historial y resumen de ventas' },
  { key: 'billing', label: 'Facturación electrónica', description: 'Emisión de documentos tributarios electrónicos' },
];

const emptyForm = { name: '', email: '', password: '', role: 'CATALOG_MANAGER', companyId: '' };
const emptyEdit = { name: '', role: '', password: '', active: true, modules: null as string[] | null };

export default function UsersPage() {
  const [users, setUsers] = useState<any[]>([]);
  const [companies, setCompanies] = useState<any[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [myCompany, setMyCompany] = useState<any>(null);

  const [editUser, setEditUser] = useState<any>(null);
  const [editForm, setEditForm] = useState(emptyEdit);
  const [editLoading, setEditLoading] = useState(false);
  const [editError, setEditError] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  async function load() {
    const token = getToken();
    if (!token) return;
    const me = await api.me(token);
    setCurrentUser(me);
    const data = await api.users.list(token);
    setUsers(data);
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
      const payload: any = { name: form.name, email: form.email, password: form.password, role: form.role };
      if (form.companyId) payload.companyId = form.companyId;
      await api.users.create(payload, token);
      setForm(emptyForm);
      setShowForm(false);
      await load();
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
      modules: Array.isArray(u.modules) ? u.modules : null,
    });
    setEditError('');
    setShowPassword(false);
  }

  function toggleModule(key: string) {
    setEditForm((f) => {
      // null = todos habilitados; al tocar uno, expandimos a array explícito
      const current = f.modules ?? ALL_MODULES.map((m) => m.key);
      const hasIt = current.includes(key);
      const next = hasIt ? current.filter((k) => k !== key) : [...current, key];
      // Si todos están activos, volver a null (valor por defecto = todo habilitado)
      return { ...f, modules: next.length === ALL_MODULES.length ? null : next };
    });
  }

  function isModuleEnabled(key: string): boolean {
    if (editForm.modules === null) return true;
    return editForm.modules.includes(key);
  }

  async function handleEdit(e: FormEvent) {
    e.preventDefault();
    setEditError('');
    setEditLoading(true);
    try {
      const token = getToken()!;
      const payload: any = {
        name: editForm.name,
        role: editForm.role,
        active: editForm.active,
        modules: editForm.modules,
      };
      if (editForm.password) payload.password = editForm.password;
      await api.users.update(editUser.id, payload, token);
      setEditUser(null);
      await load();
    } catch (err: any) {
      setEditError(err.message);
    } finally {
      setEditLoading(false);
    }
  }

  const isSuperAdmin = currentUser?.role === 'SUPER_ADMIN';
  const userCount = myCompany?._count?.users ?? users.length;
  const maxUsers = myCompany?.maxUsers;
  const atLimit = maxUsers != null && userCount >= maxUsers;

  const canEditModules = (u: any) => u.role !== 'SUPER_ADMIN';

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Usuarios</h1>
          {!isSuperAdmin && myCompany && (
            <p className={`text-sm mt-0.5 ${atLimit ? 'text-red-600 font-medium' : 'text-gray-500'}`}>
              {userCount} de {maxUsers} usuarios utilizados
              {atLimit && ' — límite alcanzado'}
            </p>
          )}
        </div>
        <button onClick={() => setShowForm(!showForm)} disabled={!isSuperAdmin && atLimit}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed">
          + Nuevo usuario
        </button>
      </div>

      {showForm && (
        <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
          <h2 className="font-semibold text-gray-800 mb-4">Nuevo usuario</h2>
          <form onSubmit={handleCreate} className="grid grid-cols-2 gap-4">
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
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Perfil *</label>
              <select value={form.role} onChange={(e) => setForm(f => ({ ...f, role: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
                {ALL_ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
            </div>
            {isSuperAdmin && (
              <div className="col-span-2">
                <label className="block text-xs font-medium text-gray-600 mb-1">Empresa</label>
                <select value={form.companyId} onChange={(e) => setForm(f => ({ ...f, companyId: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
                  <option value="">Sin empresa</option>
                  {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
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

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="text-left px-4 py-3 text-gray-600 font-medium">Nombre</th>
              <th className="text-left px-4 py-3 text-gray-600 font-medium">Email</th>
              <th className="text-left px-4 py-3 text-gray-600 font-medium">Perfil</th>
              <th className="text-left px-4 py-3 text-gray-600 font-medium">Empresa</th>
              <th className="text-left px-4 py-3 text-gray-600 font-medium">Módulos</th>
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
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${roleBadge[u.role] || 'bg-gray-100 text-gray-600'}`}>
                    {roleLabels[u.role] || u.role}
                  </span>
                </td>
                <td className="px-4 py-3 text-gray-600">{u.company?.name || '—'}</td>
                <td className="px-4 py-3">
                  {u.role === 'SUPER_ADMIN' ? (
                    <span className="text-xs text-gray-400">Todos</span>
                  ) : !u.modules || !Array.isArray(u.modules) ? (
                    <span className="text-xs text-green-600 font-medium">Todos activos</span>
                  ) : u.modules.length === 0 ? (
                    <span className="text-xs text-red-500">Sin módulos</span>
                  ) : (
                    <div className="flex flex-wrap gap-1">
                      {(u.modules as string[]).map((m) => {
                        const mod = ALL_MODULES.find((x) => x.key === m);
                        return (
                          <span key={m} className="text-xs bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded-full">
                            {mod?.label || m}
                          </span>
                        );
                      })}
                    </div>
                  )}
                </td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${u.active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                    {u.active ? 'Activo' : 'Inactivo'}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <button onClick={() => openEdit(u)}
                    className="text-blue-600 hover:text-blue-800 text-xs font-medium">
                    Editar
                  </button>
                </td>
              </tr>
            ))}
            {users.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">Sin usuarios registrados</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Modal de edición */}
      {editUser && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto">
            <div className="px-6 py-4 border-b border-gray-100">
              <h2 className="font-semibold text-gray-800">Editar usuario</h2>
              <p className="text-xs text-gray-400 mt-0.5">{editUser.email}</p>
            </div>
            <form onSubmit={handleEdit} className="px-6 py-4 flex flex-col gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Nombre *</label>
                <input value={editForm.name}
                  onChange={(e) => setEditForm(f => ({ ...f, name: e.target.value }))}
                  required className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Perfil *</label>
                <select value={editForm.role}
                  onChange={(e) => setEditForm(f => ({ ...f, role: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
                  {ALL_ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                  {isSuperAdmin && <option value="SUPER_ADMIN">Super Admin</option>}
                </select>
              </div>
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

              {/* Módulos — solo para no SUPER_ADMIN */}
              {canEditModules(editUser) && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-xs font-medium text-gray-600">Módulos habilitados</label>
                    <span className="text-xs text-gray-400">
                      {editForm.modules === null ? 'Todos activos' : `${editForm.modules.length} de ${ALL_MODULES.length}`}
                    </span>
                  </div>
                  <div className="border border-gray-200 rounded-xl overflow-hidden divide-y divide-gray-100">
                    {ALL_MODULES.map((mod) => {
                      const enabled = isModuleEnabled(mod.key);
                      return (
                        <label
                          key={mod.key}
                          className={`flex items-center gap-3 px-4 py-3 cursor-pointer transition-colors ${enabled ? 'bg-white' : 'bg-gray-50'}`}
                        >
                          <div
                            onClick={() => toggleModule(mod.key)}
                            className={`w-9 h-5 rounded-full transition-colors flex items-center shrink-0 cursor-pointer ${enabled ? 'bg-blue-500' : 'bg-gray-200'}`}
                          >
                            <div className={`w-4 h-4 bg-white rounded-full shadow-sm transition-transform mx-0.5 ${enabled ? 'translate-x-4' : 'translate-x-0'}`} />
                          </div>
                          <div className="min-w-0">
                            <p className={`text-sm font-medium ${enabled ? 'text-gray-800' : 'text-gray-400'}`}>{mod.label}</p>
                            <p className="text-xs text-gray-400 truncate">{mod.description}</p>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                  <p className="text-xs text-gray-400 mt-1.5">
                    Todos activos por defecto. Al desactivar uno, el usuario no verá ese módulo en el menú.
                  </p>
                </div>
              )}

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
    </div>
  );
}
