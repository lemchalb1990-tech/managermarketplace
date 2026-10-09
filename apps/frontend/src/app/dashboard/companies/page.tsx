'use client';

import { useEffect, useState, FormEvent } from 'react';
import { getToken, getUser } from '@/lib/auth';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import type { AiPlan, SubscriptionPlan } from '@/lib/api';
import { confirmDialog, alertDialog } from '../ConfirmDialog';
import { Modal, btnDanger, btnSecondary, inputCls, labelCls, FormError } from '@/components/ui/Modal';
import { SkeletonRows } from '@/components/Skeleton';

const ALL_COMPANY_MODULES = [
  { key: 'catalog', label: 'Catálogo', description: 'Gestión de productos e imágenes' },
  { key: 'ecommerce_ml', label: 'Mercado Libre', description: 'Publicaciones en ML Chile' },
  { key: 'ecommerce_shopify', label: 'Shopify', description: 'Sincronización con Shopify' },
  { key: 'ecommerce_woocommerce', label: 'WooCommerce', description: 'Sincronización con WooCommerce' },
  { key: 'ecommerce_jumpseller', label: 'JumpSeller', description: 'Sincronización con JumpSeller' },
  { key: 'ecommerce_falabella', label: 'Falabella', description: 'Marketplace Falabella' },
  { key: 'ecommerce_paris', label: 'Paris', description: 'Marketplace Paris (Cencosud)' },
  { key: 'ecommerce_hites', label: 'Hites', description: 'Marketplace Hites (Cencosud)' },
  { key: 'ecommerce_ripley', label: 'Ripley', description: 'Marketplace Ripley' },
  { key: 'ecommerce_walmart', label: 'Walmart', description: 'Marketplace Walmart Chile' },
  { key: 'pos', label: 'Punto de Venta', description: 'Terminal de ventas físicas' },
  { key: 'sales', label: 'Ventas', description: 'Historial y resumen de ventas' },
  { key: 'billing', label: 'Facturación electrónica', description: 'Documentos tributarios electrónicos' },
  { key: 'rentabilidad', label: 'Rentabilidad', description: 'Comparador de costo propio vs. precio de la competencia' },
  { key: 'finance', label: 'Finanzas', description: 'Plan de cuentas, gastos e ingresos y presupuesto mensual vs. real' },
  { key: 'purchases', label: 'Compras', description: 'Compras a proveedores con costeo por lotes (FIFO)' },
  { key: 'dropshipping', label: 'Dropshipping', description: 'Productos que despacha un proveedor externo al cliente final' },
  { key: 'dispatch', label: 'Despacho', description: 'Rutas de despacho y seguimiento de entregas' },
];


const emptyForm = { name: '', slug: '', maxUsers: 10, adminName: '', adminEmail: '', adminPassword: '' };
type EditState = { id: string; name: string; active: boolean; maxUsers: number; modules: string[] | null; autoSyncSales: boolean; autoSyncIntervalMinutes: number; planId: string; billing: 'MONTHLY' | 'ANNUAL'; origPlanId: string; origBilling: string; aiPlanId: string; origAiPlanId: string } | null;

export default function CompaniesPage() {
  const [companies, setCompanies] = useState<any[]>([]);
  const [companiesLoaded, setCompaniesLoaded] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [listingsLoadingId, setListingsLoadingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [editing, setEditing] = useState<EditState>(null);
  // Planes comerciales para asignar a la empresa.
  const [plans, setPlans] = useState<SubscriptionPlan[]>([]);
  const [aiPlans, setAiPlans] = useState<AiPlan[]>([]);
  // Empresa a eliminar definitivamente (modal de confirmación).
  const [purging, setPurging] = useState<{ id: string; name: string; typed: string; backingUp: boolean; error: string; progress?: { percent: number; step: string } } | null>(null);
  const [editLoading, setEditLoading] = useState(false);
  const [editError, setEditError] = useState('');
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const router = useRouter();
  const [allowed, setAllowed] = useState(false);

  async function load() {
    const token = getToken();
    if (!token) return;
    const data = await api.companies.list(token);
    setCompanies(data);
    setCompaniesLoaded(true);
    api.subscription.plans.list(token).then(setPlans).catch(() => {});
    api.ai.plans.list(token).then(setAiPlans).catch(() => {});
  }

  // La gestión de empresas es solo de Super Admin (el backend también lo exige).
  useEffect(() => {
    if (getUser()?.role !== 'SUPER_ADMIN') {
      router.replace('/dashboard');
      return;
    }
    setAllowed(true);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Eliminación definitiva: se confirma escribiendo el nombre de la empresa (ver PurgeModal).
  function handleDelete(id: string, name: string) {
    setDeleteError('');
    setPurging({ id, name, typed: '', backingUp: false, error: '' });
  }

  async function confirmPurge() {
    if (!purging) return;
    setDeletingId(purging.id);
    setPurging((p) => p && { ...p, error: '', progress: { percent: 0, step: 'Iniciando' } });
    try {
      const token = getToken()!;
      // La eliminación corre en el servidor; se consulta el avance hasta que termina.
      const { jobId } = await api.companies.purge(purging.id, purging.typed, token);
      let status = await api.companies.purgeStatus(jobId, token);
      while (!status.done) {
        setPurging((p) => p && { ...p, progress: { percent: status.percent, step: status.step } });
        await new Promise((r) => setTimeout(r, 800));
        status = await api.companies.purgeStatus(jobId, token);
      }
      if (status.error) throw new Error(status.error);
      setPurging((p) => p && { ...p, progress: { percent: 100, step: 'Eliminación terminada' } });
      const res = status.result!;
      setPurging(null);
      await load();
      await alertDialog(`Empresa "${purging.name}" eliminada con toda su información (${res.rows.toLocaleString('es-CL')} registros y ${res.files} archivos).`);
    } catch (err: any) {
      setPurging((p) => p && { ...p, progress: undefined, error: err.message || 'No se pudo eliminar la empresa.' });
    } finally {
      setDeletingId(null);
    }
  }

  async function downloadBackup() {
    if (!purging) return;
    setPurging((p) => p && { ...p, backingUp: true, error: '' });
    try {
      await api.companies.backup(purging.id, purging.name, getToken()!);
    } catch (err: any) {
      setPurging((p) => p && { ...p, error: err.message || 'No se pudo descargar el respaldo.' });
    } finally {
      setPurging((p) => p && { ...p, backingUp: false });
    }
  }

  async function handleCancelClosure(id: string, name: string) {
    if (!(await confirmDialog(`¿Revertir la baja de "${name}"? La cuenta vuelve a quedar activa, sus usuarios pueden entrar y se reactivan las conexiones que tenía.`))) return;
    try {
      const res = await api.companies.cancelClosure(id, getToken()!);
      await load();
      await alertDialog(`Baja revertida. ${res.connectionsReactivated} conexión(es) reactivada(s).`);
    } catch (err: any) {
      await alertDialog(err.message || 'No se pudo revertir la baja');
    }
  }

  async function handleDeleteAllListings(id: string, name: string) {
    if (!(await confirmDialog(
      `¿Eliminar TODAS las publicaciones de "${name}"?\n\n` +
      `Esto solo borra el vínculo interno con los marketplaces: las publicaciones seguirán vivas en Mercado Libre (u otra plataforma), pero el sistema dejará de rastrearlas para todos los productos de esta empresa.`,
      { danger: true },
    ))) return;
    setListingsLoadingId(id);
    setDeleteError('');
    try {
      const token = getToken()!;
      const res = await api.companies.deleteAllListings(id, token);
      await alertDialog(`${res.deleted} publicación(es) eliminada(s) del sistema.`);
    } catch (err: any) {
      setDeleteError(err.message || 'Error al eliminar las publicaciones de la empresa.');
    } finally {
      setListingsLoadingId(null);
    }
  }

  function handleNameChange(name: string) {
    const slug = name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    setForm(f => ({ ...f, name, slug }));
  }

  function handleLogoChange(file: File | null) {
    setLogoFile(file);
    setLogoPreview(file ? URL.createObjectURL(file) : null);
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const token = getToken()!;
      const payload: any = { name: form.name, slug: form.slug, maxUsers: form.maxUsers };
      if (form.adminEmail) {
        payload.admin = { name: form.adminName, email: form.adminEmail, password: form.adminPassword };
      }
      const created = await api.companies.create(payload, token);
      if (logoFile) {
        // El logo queda guardado en el Perfil de Facturación de la empresa (mismo membrete
        // que ya usan boletas/facturas) — no se duplica el dato en otro lugar.
        await api.billing.profile.uploadLogo(logoFile, token, created.id).catch((err: any) => {
          setError(`Empresa creada, pero no se pudo subir el logo: ${err.message}`);
        });
      }
      setForm(emptyForm);
      handleLogoChange(null);
      setShowForm(false);
      await load();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  function toggleCompanyModule(key: string) {
    setEditing((s) => {
      if (!s) return s;
      const current = s.modules ?? ALL_COMPANY_MODULES.map((m) => m.key);
      const has = current.includes(key);
      const next = has ? current.filter((k) => k !== key) : [...current, key];
      return { ...s, modules: next.length === ALL_COMPANY_MODULES.length ? null : next };
    });
  }

  function isCompanyModuleEnabled(key: string): boolean {
    if (!editing) return true;
    if (editing.modules === null) return true;
    return editing.modules.includes(key);
  }

  async function handleUpdate(e: FormEvent) {
    e.preventDefault();
    if (!editing) return;
    setEditError('');
    setEditLoading(true);
    try {
      const token = getToken()!;
      const result = await api.companies.update(editing.id, {
        name: editing.name,
        active: editing.active,
        maxUsers: editing.maxUsers,
        modules: editing.modules,
        autoSyncSales: editing.autoSyncSales,
        autoSyncIntervalMinutes: editing.autoSyncIntervalMinutes,
      }, token);
      if (editing.planId !== editing.origPlanId || (editing.planId && editing.billing !== editing.origBilling)) {
        await api.subscription.assign(editing.id, editing.planId || null, editing.planId ? editing.billing : null, token);
      }
      if (editing.aiPlanId !== editing.origAiPlanId) {
        await api.ai.assignPlan(editing.id, editing.aiPlanId || null, token);
      }
      if (result?.bootstrap) {
        const { migrated, skipped } = result.bootstrap;
        let msg = `Módulo de Compras activado: se crearon lotes de apertura para ${migrated} producto(s).`;
        if (skipped?.length) {
          msg += `\n\n${skipped.length} producto(s) no se migraron (sin bodega asignada):\n` +
            skipped.map((s: any) => `- ${s.name}`).join('\n');
        }
        await alertDialog(msg);
      }
      setEditing(null);
      await load();
    } catch (err: any) {
      setEditError(err.message);
    } finally {
      setEditLoading(false);
    }
  }

  if (!allowed) return null;

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h1 className="ui-page-title">Empresas</h1>
        <button onClick={() => setShowForm(!showForm)}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700">
          + Nueva empresa
        </button>
      </div>

      {showForm && (
        <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
          <h2 className="ui-section-title mb-4">Nueva empresa</h2>
          <form onSubmit={handleCreate} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Nombre de la empresa *</label>
                <input value={form.name} onChange={(e) => handleNameChange(e.target.value)}
                  required className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Máximo de usuarios</label>
                <input type="number" min={1} max={500} value={form.maxUsers}
                  onChange={(e) => setForm(f => ({ ...f, maxUsers: Number(e.target.value) }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Logo (opcional)</label>
              <div className="flex items-center gap-3">
                {logoPreview && (
                  <img src={logoPreview} alt="Logo" className="w-12 h-12 object-contain border border-gray-200 rounded-lg" />
                )}
                <input type="file" accept="image/jpeg,image/png,image/webp,image/svg+xml"
                  onChange={(e) => handleLogoChange(e.target.files?.[0] || null)}
                  className="text-sm text-gray-600" />
              </div>
              <p className="text-xs text-gray-400 mt-1">
                Queda guardado en el Perfil de Facturación de la empresa (membrete de boletas, facturas y órdenes de trabajo). El resto del membrete (razón social, RUT, dirección) se completa después desde ahí.
              </p>
            </div>

            <div className="border-t border-gray-100 pt-4">
              <p className="text-xs font-semibold text-gray-500 uppercase mb-3">Administrador de empresa (opcional)</p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Nombre</label>
                  <input value={form.adminName} onChange={(e) => setForm(f => ({ ...f, adminName: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder="Juan García" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Email</label>
                  <input type="email" value={form.adminEmail} onChange={(e) => setForm(f => ({ ...f, adminEmail: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder="admin@empresa.com" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Contraseña</label>
                  <input type="password" value={form.adminPassword} onChange={(e) => setForm(f => ({ ...f, adminPassword: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder="mínimo 6 caracteres" />
                </div>
              </div>
            </div>

            {error && <p className="text-red-600 text-sm">{error}</p>}
            <div className="flex gap-2">
              <button type="submit" disabled={loading}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
                {loading ? 'Creando...' : 'Crear empresa'}
              </button>
              <button type="button" onClick={() => { setShowForm(false); setForm(emptyForm); handleLogoChange(null); }}
                className="px-4 py-2 border border-gray-300 text-gray-600 rounded-lg text-sm hover:bg-gray-50">
                Cancelar
              </button>
            </div>
          </form>
        </div>
      )}

      {editing && (
        <div className="bg-white rounded-xl border border-blue-200 p-6 mb-6">
          <h2 className="ui-section-title mb-4">Editar empresa</h2>
          <form onSubmit={handleUpdate} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Nombre *</label>
                <input value={editing.name} onChange={(e) => setEditing(s => s && ({ ...s, name: e.target.value }))}
                  required className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Máximo de usuarios</label>
                <input type="number" min={1} max={500} value={editing.maxUsers}
                  onChange={(e) => setEditing(s => s && ({ ...s, maxUsers: Number(e.target.value) }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
              </div>
              <div className="flex items-end pb-1">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={editing.active}
                    onChange={(e) => setEditing(s => s && ({ ...s, active: e.target.checked }))}
                    className="w-4 h-4 accent-blue-600" />
                  <span className="text-sm text-gray-700">Empresa activa</span>
                </label>
              </div>
            </div>

            <div className="rounded-lg border border-gray-200 p-3 space-y-2">
              <p className="text-xs font-medium text-gray-600">Plan comercial</p>
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex flex-col gap-1">
                  <span className="text-[11px] text-gray-500">Plan</span>
                <select value={editing.planId} onChange={(e) => setEditing(s => s && ({ ...s, planId: e.target.value }))}
                  className="px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white min-w-[200px]">
                  <option value="">Sin plan (sin límites)</option>
                  {plans.filter((p) => p.active || p.id === editing.planId).map((p) => (
                    <option key={p.id} value={p.id}>{p.name}{p.isTrial ? ` (prueba ${p.trialDays} días)` : ''}</option>
                  ))}
                </select>
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-[11px] text-gray-500">Plan de IA (revisión de fotos)</span>
                  <select value={editing.aiPlanId} onChange={(e) => setEditing(s => s && ({ ...s, aiPlanId: e.target.value }))}
                    className="px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white min-w-[200px]">
                    <option value="">Sin plan de IA</option>
                    {aiPlans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>
                {editing.planId && !plans.find((p) => p.id === editing.planId)?.isTrial && (
                  <div className="flex items-center gap-3 text-sm">
                    {(['MONTHLY', 'ANNUAL'] as const).map((b) => (
                      <label key={b} className="flex items-center gap-1.5 cursor-pointer">
                        <input type="radio" name="billing" checked={editing.billing === b} onChange={() => setEditing(s => s && ({ ...s, billing: b }))} className="accent-blue-600" />
                        {b === 'MONTHLY' ? 'Mensual' : 'Anual'}
                      </label>
                    ))}
                  </div>
                )}
              </div>
              <p className="text-[11px] text-gray-400">
                El plan limita canales, productos, usuarios y bodegas, y oculta del menú lo que no incluye (con plan, el máximo de usuarios lo define el plan). El plan de IA define el diagnóstico, la revisión, la corrección y las fotos generadas, con sus créditos. Se editan en Administrador de plataforma → Planes e Inteligencia artificial.
              </p>
            </div>

            <div className="rounded-lg border border-gray-200 p-3">
              <label className="flex items-start gap-2 cursor-pointer">
                <input type="checkbox" checked={editing.autoSyncSales}
                  onChange={(e) => setEditing(s => s && ({ ...s, autoSyncSales: e.target.checked }))}
                  className="w-4 h-4 mt-0.5 accent-blue-600" />
                <span>
                  <span className="block text-sm font-medium text-gray-800">Sincronización con marketplaces</span>
                  <span className="block text-xs text-gray-500 mt-0.5">
                    Envía stock y precios a todas las tiendas conectadas y trae sus ventas, preguntas, reclamos y cambios de estado.
                    Desactivada, la empresa no mueve nada con los marketplaces. Cada tienda se puede pausar por separado con su check “Sincronizar” en Mis conexiones.
                  </span>
                </span>
              </label>
              {editing.autoSyncSales && (
                <label className="flex items-center gap-2 mt-3 ml-6">
                  <span className="text-sm text-gray-600">Revisar ventas cada</span>
                  <input type="number" min={1} max={1440} value={editing.autoSyncIntervalMinutes}
                    onChange={(e) => setEditing(s => s && ({ ...s, autoSyncIntervalMinutes: Math.max(1, Number(e.target.value)) }))}
                    className="w-20 px-2 py-1 border border-gray-300 rounded-lg text-sm" />
                  <span className="text-sm text-gray-600">minuto(s)</span>
                </label>
              )}
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-medium text-gray-600">Módulos licenciados</label>
                <span className="text-xs text-gray-400">
                  {editing.modules === null ? 'Todos activos' : `${editing.modules.length} de ${ALL_COMPANY_MODULES.length}`}
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
                {ALL_COMPANY_MODULES.map((mod) => {
                  const enabled = isCompanyModuleEnabled(mod.key);
                  return (
                    <label key={mod.key}
                      className={`flex items-center gap-2 px-3 py-2.5 border rounded-lg cursor-pointer transition-colors ${enabled ? 'bg-white border-gray-200' : 'bg-gray-50 border-gray-200'}`}>
                      <div onClick={() => toggleCompanyModule(mod.key)}
                        className={`w-9 h-5 rounded-full transition-colors flex items-center shrink-0 cursor-pointer ${enabled ? 'bg-blue-500' : 'bg-gray-200'}`}>
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
              <p className="text-xs text-gray-400 mt-1.5">Todos activos por defecto. Desactiva los módulos que la empresa no tiene contratados.</p>
            </div>

            {editError && <p className="text-red-600 text-sm">{editError}</p>}
            <div className="flex gap-2">
              <button type="submit" disabled={editLoading}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
                {editLoading ? 'Guardando...' : 'Guardar cambios'}
              </button>
              <button type="button" onClick={() => setEditing(null)}
                className="px-4 py-2 border border-gray-300 text-gray-600 rounded-lg text-sm hover:bg-gray-50">
                Cancelar
              </button>
            </div>
          </form>
        </div>
      )}

      {deleteError && (
        <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          {deleteError}
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="text-left px-4 py-3 text-gray-600 font-medium">Empresa</th>
              <th className="text-left px-4 py-3 text-gray-600 font-medium">Slug</th>
              <th className="text-left px-4 py-3 text-gray-600 font-medium">Usuarios / Límite</th>
              <th className="text-left px-4 py-3 text-gray-600 font-medium">Productos</th>
              <th className="text-left px-4 py-3 text-gray-600 font-medium">Estado</th>
              <th className="text-left px-4 py-3 text-gray-600 font-medium">Sincronización</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {companies.map((c) => (
              <tr key={c.id} className={`hover:bg-gray-50 ${editing?.id === c.id ? 'bg-blue-50' : ''}`}>
                <td className="px-4 py-3 font-medium text-gray-900">
                  {c.name}
                  {c.subscriptionPlan && <span className="ml-1.5 text-[10px] font-medium px-1.5 py-0.5 rounded bg-blue-50 text-blue-700">{c.subscriptionPlan.name}</span>}
                  {c.aiPlan && <span className="ml-1 text-[10px] font-medium px-1.5 py-0.5 rounded bg-violet-50 text-violet-700">IA: {c.aiPlan.name}</span>}
                </td>
                <td className="px-4 py-3 text-gray-500 font-mono">{c.slug}</td>
                <td className="px-4 py-3 text-gray-600">
                  {(() => {
                    // Con plan, el límite de usuarios lo define el plan (null = sin límite).
                    const max = c.subscriptionPlan ? c.subscriptionPlan.maxUsers : (c.maxUsers ?? 10);
                    return (
                      <>
                        <span className={max != null && (c._count?.users ?? 0) >= max ? 'text-red-600 font-medium' : ''}>
                          {c._count?.users ?? 0}
                        </span>
                        <span className="text-gray-400"> / {max ?? '∞'}</span>
                      </>
                    );
                  })()}
                </td>
                <td className="px-4 py-3 text-gray-600">{c._count?.products ?? 0}</td>
                <td className="px-4 py-3">
                  {c.closureScheduledFor ? (
                    <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700"
                      title={c.closureReason ? `Motivo: ${c.closureReason}` : undefined}>
                      Baja: se borra el {new Date(c.closureScheduledFor).toLocaleDateString('es-CL')}
                    </span>
                  ) : (
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${c.active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                      {c.active ? 'Activa' : 'Inactiva'}
                    </span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${c.autoSyncSales ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                    {c.autoSyncSales ? `Activa (cada ${c.autoSyncIntervalMinutes ?? 1} min)` : 'Desactivada'}
                  </span>
                </td>
                <td className="px-4 py-3 text-right flex gap-3 justify-end">
                  {c.closureScheduledFor && (
                    <button onClick={() => handleCancelClosure(c.id, c.name)} className="text-xs text-emerald-600 hover:text-emerald-800 font-semibold">
                      Revertir baja
                    </button>
                  )}
                  <button onClick={() => { setEditing({ id: c.id, name: c.name, active: c.active, maxUsers: c.maxUsers ?? 10, modules: Array.isArray(c.modules) ? c.modules : null, autoSyncSales: !!c.autoSyncSales, autoSyncIntervalMinutes: c.autoSyncIntervalMinutes ?? 1, planId: c.subscriptionPlanId ?? '', billing: c.subscriptionBilling === 'ANNUAL' ? 'ANNUAL' : 'MONTHLY', origPlanId: c.subscriptionPlanId ?? '', origBilling: c.subscriptionBilling ?? 'MONTHLY', aiPlanId: c.aiPlanId ?? '', origAiPlanId: c.aiPlanId ?? '' }); setEditError(''); }}
                    className="text-xs text-blue-500 hover:text-blue-700 font-medium">
                    Editar
                  </button>
                  <button onClick={() => handleDeleteAllListings(c.id, c.name)}
                    disabled={listingsLoadingId === c.id}
                    title="Borra el vínculo interno con los marketplaces sin afectar las publicaciones reales"
                    className="text-xs text-amber-600 hover:text-amber-800 font-medium disabled:opacity-50">
                    {listingsLoadingId === c.id ? 'Eliminando...' : 'Eliminar publicaciones'}
                  </button>
                  <button onClick={() => handleDelete(c.id, c.name)} disabled={deletingId === c.id}
                    className="text-xs text-red-500 hover:text-red-700 font-medium disabled:opacity-50">
                    {deletingId === c.id ? 'Eliminando...' : 'Eliminar empresa'}
                  </button>
                </td>
              </tr>
            ))}
            {!companiesLoaded && <SkeletonRows cols={7} rows={5} />}
            {companiesLoaded && companies.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">Sin empresas registradas</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {purging && (
        <Modal
          title="Eliminar empresa definitivamente"
          subtitle={purging.name}
          busy={deletingId === purging.id}
          onClose={() => setPurging(null)}
          footer={(
            <>
              <button type="button" onClick={() => setPurging(null)} disabled={deletingId === purging.id} className={btnSecondary}>Cancelar</button>
              <button type="button" onClick={confirmPurge}
                disabled={deletingId === purging.id || purging.typed.trim().toLowerCase() !== purging.name.trim().toLowerCase()}
                className={btnDanger}>
                {deletingId === purging.id ? 'Eliminando…' : 'Eliminar definitivamente'}
              </button>
            </>
          )}
        >
          {purging.progress ? (
            // Avance de la eliminación (no se puede cerrar mientras corre).
            <div className="py-4 text-center">
              <div className="mx-auto w-10 h-10 rounded-full border-4 border-red-100 border-t-red-600 animate-spin" />
              <p className="mt-4 text-sm font-semibold text-gray-800">Eliminando la empresa…</p>
              <p className="mt-1 text-xs text-gray-500 min-h-[1rem]">{purging.progress.step}</p>
              <div className="mt-4 h-2 bg-gray-100 rounded-full overflow-hidden">
                <div className="h-full bg-red-600 rounded-full transition-all duration-500" style={{ width: `${purging.progress.percent}%` }} />
              </div>
              <p className="mt-2 text-2xl font-bold text-red-600">{purging.progress.percent}%</p>
              <p className="mt-3 text-[11px] text-gray-400">No cierres esta ventana hasta que termine.</p>
            </div>
          ) : (
          <div className="space-y-4 text-sm">
            <div className="px-3 py-2.5 bg-red-50 border border-red-200 rounded-lg text-red-800">
              Se borrará la empresa y <strong>toda su información</strong>: productos, stock y bodegas, ventas y órdenes,
              clientes, compras, documentos tributarios, conexiones a marketplaces, finanzas, usuarios y archivos subidos.
              <strong> No se puede deshacer.</strong>
            </div>
            <p className="text-xs text-gray-500">
              Las publicaciones en los marketplaces no se tocan: siguen activas en cada plataforma, solo dejan de estar conectadas a este sistema.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={downloadBackup} disabled={purging.backingUp || deletingId === purging.id} className={btnSecondary}>
                {purging.backingUp ? 'Preparando respaldo…' : 'Descargar respaldo antes (ZIP)'}
              </button>
              <span className="text-xs text-gray-400">Recomendado: Excel con los datos y documentos.</span>
            </div>
            <div>
              <label className={labelCls}>Escribe <strong>{purging.name}</strong> para confirmar</label>
              <input value={purging.typed} onChange={(e) => setPurging((p) => p && { ...p, typed: e.target.value })}
                autoComplete="off" className={inputCls} />
            </div>
            <FormError message={purging.error} />
          </div>
          )}
        </Modal>
      )}
    </div>
  );
}
