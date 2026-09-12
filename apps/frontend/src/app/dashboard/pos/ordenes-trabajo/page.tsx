'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { getToken, getUser } from '@/lib/auth';
import { api } from '@/lib/api';

interface LineItem {
  productId?: string;
  productName: string;
  productSku?: string;
  quantity: number;
  unitPrice: number;
}

const STATUS_LABEL: Record<string, string> = {
  PENDING: 'Pendiente', CONVERTED: 'Cobrada', REJECTED: 'Rechazada', CANCELLED: 'Anulada',
};
const STATUS_COLOR: Record<string, string> = {
  PENDING: 'bg-amber-100 text-amber-700',
  CONVERTED: 'bg-green-100 text-green-700',
  REJECTED: 'bg-red-100 text-red-700',
  CANCELLED: 'bg-gray-100 text-gray-500',
};
const PAYMENT_LABELS: Record<string, string> = { CASH: 'Efectivo', CARD: 'Tarjeta', TRANSFER: 'Transferencia', OTHER: 'Otro' };

const emptyForm = () => ({
  id: undefined as string | undefined,
  clientId: '',
  customerName: '',
  customerPhone: '',
  customerEmail: '',
  notes: '',
  items: [] as LineItem[],
});

export default function WorkOrdersPage() {
  const [token, setToken] = useState('');
  const [user, setUser] = useState<any>(null);
  const isSuperAdmin = user?.role === 'SUPER_ADMIN';
  const [companies, setCompanies] = useState<any[]>([]);
  const [selectedCompanyId, setSelectedCompanyId] = useState('');
  const activeCompanyId = isSuperAdmin ? selectedCompanyId : user?.companyId;

  const [workOrders, setWorkOrders] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [loading, setLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');

  const [clients, setClients] = useState<any[]>([]);
  const [notice, setNotice] = useState('');
  const [noticeIsError, setNoticeIsError] = useState(false);

  useEffect(() => {
    const t = getToken();
    const u = getUser();
    if (t && u) { setToken(t); setUser(u); }
  }, []);

  useEffect(() => {
    if (!token) return;
    if (user?.role === 'SUPER_ADMIN') api.companies.list(token).then(setCompanies).catch(() => {});
  }, [token, user]);

  const loadWorkOrders = useCallback(async (p = 1) => {
    if (!token) return;
    if (isSuperAdmin && !selectedCompanyId) { setWorkOrders([]); setTotal(0); setPages(1); return; }
    setLoading(true);
    try {
      const res = await api.pos.workOrders.list({
        companyId: isSuperAdmin ? selectedCompanyId : undefined,
        status: statusFilter || undefined,
        search: search || undefined,
        page: p,
      }, token);
      setWorkOrders(res.workOrders);
      setTotal(res.total);
      setPage(res.page);
      setPages(res.pages);
    } catch {}
    setLoading(false);
  }, [token, isSuperAdmin, selectedCompanyId, statusFilter, search]);

  useEffect(() => { loadWorkOrders(1); }, [loadWorkOrders]);

  useEffect(() => {
    if (!token) return;
    if (isSuperAdmin && !selectedCompanyId) { setClients([]); return; }
    api.clients.list(token, isSuperAdmin ? selectedCompanyId : undefined)
      .then((d) => setClients(d.filter((c: any) => c.active)))
      .catch(() => setClients([]));
  }, [token, isSuperAdmin, selectedCompanyId]);

  function notify(msg: string, isError = false) {
    setNotice(msg);
    setNoticeIsError(isError);
    setTimeout(() => setNotice(''), 4000);
  }

  // ── Crear / editar ──────────────────────────────────────────────────────
  const [form, setForm] = useState<ReturnType<typeof emptyForm> | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [productSearch, setProductSearch] = useState('');
  const [productResults, setProductResults] = useState<any[]>([]);
  const [freeDesc, setFreeDesc] = useState('');
  const [freeQty, setFreeQty] = useState('1');
  const [freePrice, setFreePrice] = useState('');

  function openEdit(wo: any) {
    setForm({
      id: wo.id,
      clientId: wo.clientId || '',
      customerName: wo.customerName || '',
      customerPhone: wo.customerPhone || '',
      customerEmail: wo.customerEmail || '',
      notes: wo.notes || '',
      items: wo.items.map((i: any) => ({
        productId: i.productId || undefined,
        productName: i.productName,
        productSku: i.productSku || undefined,
        quantity: i.quantity,
        unitPrice: Number(i.unitPrice),
      })),
    });
    setFormError('');
    setProductSearch(''); setProductResults([]);
    setFreeDesc(''); setFreeQty('1'); setFreePrice('');
  }

  useEffect(() => {
    if (!form || !productSearch.trim()) { setProductResults([]); return; }
    const t = setTimeout(async () => {
      try {
        const res = await api.catalog.search({
          search: productSearch.trim(),
          active: 'true',
          pageSize: 8,
          companyId: isSuperAdmin ? selectedCompanyId : undefined,
        }, token);
        setProductResults(res.products);
      } catch { setProductResults([]); }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, 300);
    return () => clearTimeout(t);
  }, [productSearch, form]);

  function addCatalogItem(p: any) {
    if (!form) return;
    setForm({
      ...form,
      items: [...form.items, {
        productId: p.id, productName: p.name, productSku: p.sku,
        quantity: 1, unitPrice: Number(p.price),
      }],
    });
    setProductSearch(''); setProductResults([]);
  }

  function addFreeItem() {
    if (!form || !freeDesc.trim()) return;
    const qty = parseInt(freeQty) || 1;
    const price = Number(freePrice) || 0;
    setForm({ ...form, items: [...form.items, { productName: freeDesc.trim(), quantity: qty, unitPrice: price }] });
    setFreeDesc(''); setFreeQty('1'); setFreePrice('');
  }

  function updateItem(idx: number, patch: Partial<LineItem>) {
    if (!form) return;
    const items = form.items.map((it, i) => (i === idx ? { ...it, ...patch } : it));
    setForm({ ...form, items });
  }

  function removeItem(idx: number) {
    if (!form) return;
    setForm({ ...form, items: form.items.filter((_, i) => i !== idx) });
  }

  const formTotal = (form?.items || []).reduce((s, i) => s + i.quantity * i.unitPrice, 0);

  async function handleSaveForm() {
    if (!form?.id) return;
    if (!form.items.length) { setFormError('Agrega al menos un ítem.'); return; }
    setSaving(true);
    setFormError('');
    try {
      const payload = {
        clientId: form.clientId || undefined,
        customerName: form.customerName || undefined,
        customerPhone: form.customerPhone || undefined,
        customerEmail: form.customerEmail || undefined,
        notes: form.notes || undefined,
        items: form.items.map((i) => ({
          productId: i.productId,
          productName: i.productName,
          productSku: i.productSku,
          quantity: i.quantity,
          unitPrice: i.unitPrice,
        })),
      };
      await api.pos.workOrders.update(form.id, payload, token);
      setForm(null);
      await loadWorkOrders(page);
      notify('Orden de trabajo actualizada.');
    } catch (err: any) {
      setFormError(err.message || 'No se pudo guardar la orden de trabajo.');
    } finally {
      setSaving(false);
    }
  }

  async function handleReject(id: string) {
    if (!confirm('¿Marcar esta orden de trabajo como rechazada por el cliente?')) return;
    try {
      await api.pos.workOrders.reject(id, token);
      await loadWorkOrders(page);
      notify('Orden de trabajo rechazada.');
    } catch (err: any) {
      notify(err.message || 'No se pudo rechazar la orden.', true);
    }
  }

  async function handleCancel(id: string) {
    if (!confirm('¿Anular esta orden de trabajo?')) return;
    try {
      await api.pos.workOrders.cancel(id, token);
      await loadWorkOrders(page);
      notify('Orden de trabajo anulada.');
    } catch (err: any) {
      notify(err.message || 'No se pudo anular la orden.', true);
    }
  }

  // ── Aceptar y cobrar ────────────────────────────────────────────────────
  const [converting, setConverting] = useState<any>(null);
  const [billingConns, setBillingConns] = useState<any[]>([]);
  const [paymentMethod, setPaymentMethod] = useState('CASH');
  const [emitDte, setEmitDte] = useState(false);
  const [dteFamily, setDteFamily] = useState<'BOLETA' | 'FACTURA'>('BOLETA');
  const [dteType, setDteType] = useState<'BOLETA' | 'FACTURA' | 'FACTURA_EXENTA'>('BOLETA');
  const [dteConnId, setDteConnId] = useState('');
  const [convertSaving, setConvertSaving] = useState(false);
  const [convertError, setConvertError] = useState('');
  const isFactura = dteType === 'FACTURA' || dteType === 'FACTURA_EXENTA';

  async function openConvert(wo: any) {
    setConverting(wo);
    setPaymentMethod('CASH');
    setEmitDte(false);
    setDteFamily('BOLETA'); setDteType('BOLETA');
    setConvertError('');
    try {
      const conns = await api.billing.connections.list(token, { companyId: wo.companyId });
      setBillingConns(conns);
      if (conns[0]) setDteConnId(conns[0].id);
    } catch { setBillingConns([]); }
  }

  async function handleConfirmConvert() {
    if (!converting) return;
    const client = converting.client;
    if (emitDte) {
      if (!dteConnId) { setConvertError('Selecciona la conexión de facturación.'); return; }
      if (isFactura && (!client?.rut || !client?.name)) {
        setConvertError('Para emitir Factura la orden debe tener un cliente con RUT y razón social.');
        return;
      }
    }
    setConvertSaving(true);
    setConvertError('');
    try {
      const sale = await api.pos.workOrders.convert(converting.id, { paymentMethod }, token);
      let dteMsg = '';
      if (emitDte) {
        try {
          await api.billing.invoices.issue({
            connectionId: dteConnId,
            dteType,
            rut: client?.rut || '66666666-6',
            razonSocial: client?.name || converting.customerName || 'Consumidor final',
            giro: client?.giro || undefined,
            address: client?.address || undefined,
            commune: client?.commune || undefined,
            email: client?.email || converting.customerEmail || undefined,
            items: converting.items.map((i: any) => ({ name: i.productName, quantity: i.quantity, unitPrice: Number(i.unitPrice) })),
            saleId: sale.id,
            clientId: converting.clientId || undefined,
            paymentCondition: 'CONTADO',
            markPaid: true,
            paymentMethod,
          }, token);
          dteMsg = ' · documento emitido';
        } catch (e: any) {
          dteMsg = ` · venta OK, pero el documento falló: ${e.message}`;
        }
      }
      setConverting(null);
      await loadWorkOrders(page);
      notify(`Orden de trabajo cobrada y convertida en venta${dteMsg}.`);
    } catch (err: any) {
      setConvertError(err.message || 'No se pudo cobrar la orden de trabajo.');
    } finally {
      setConvertSaving(false);
    }
  }

  const fmt = (v: number) => `$${Math.round(v).toLocaleString('es-CL')}`;

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Órdenes de trabajo</h1>
          <p className="text-sm text-gray-500 mt-1">
            Presupuestos para imprimir y entregar al cliente. No descuentan stock ni se cobran hasta que el cliente acepta.
          </p>
        </div>
        {(!isSuperAdmin || selectedCompanyId) && (
          <Link href="/dashboard/pos" className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-semibold">
            + Nueva orden de trabajo
          </Link>
        )}
      </div>

      {isSuperAdmin && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
          <label className="block text-xs font-semibold text-blue-700 mb-1">Empresa a gestionar</label>
          <select value={selectedCompanyId} onChange={(e) => setSelectedCompanyId(e.target.value)}
            className="w-full sm:w-96 px-3 py-2 border border-blue-300 rounded-lg text-sm bg-white">
            <option value="">— Selecciona una empresa —</option>
            {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
      )}

      {notice && (
        <div className={`px-4 py-3 rounded-lg text-sm border ${noticeIsError ? 'bg-red-50 border-red-200 text-red-700' : 'bg-green-50 border-green-200 text-green-700'}`}>
          {notice}
        </div>
      )}

      {isSuperAdmin && !selectedCompanyId ? (
        <div className="flex flex-col items-center justify-center text-center text-gray-400 text-sm border border-dashed border-gray-300 rounded-2xl py-20">
          <p className="text-3xl mb-2">🧾</p>
          <p>Selecciona una empresa para ver sus órdenes de trabajo.</p>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white">
              <option value="">Todos los estados</option>
              <option value="PENDING">Pendientes</option>
              <option value="CONVERTED">Cobradas</option>
              <option value="REJECTED">Rechazadas</option>
              <option value="CANCELLED">Anuladas</option>
            </select>
            <input value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por N°, cliente o nombre..."
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm flex-1 min-w-[200px]" />
          </div>

          <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-left px-4 py-3 text-gray-600 font-medium">N°</th>
                  <th className="text-left px-4 py-3 text-gray-600 font-medium">Cliente</th>
                  <th className="text-left px-4 py-3 text-gray-600 font-medium">Total</th>
                  <th className="text-left px-4 py-3 text-gray-600 font-medium">Estado</th>
                  <th className="text-left px-4 py-3 text-gray-600 font-medium">Fecha</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {loading && <tr><td colSpan={6} className="px-4 py-10 text-center text-gray-400">Cargando...</td></tr>}
                {!loading && workOrders.map((wo) => {
                  const woTotal = wo.items.reduce((s: number, i: any) => s + i.quantity * Number(i.unitPrice), 0);
                  return (
                    <tr key={wo.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 font-mono font-semibold text-gray-700">#{String(wo.folio).padStart(4, '0')}</td>
                      <td className="px-4 py-3 text-gray-800">
                        {wo.client?.name || wo.customerName || <span className="text-gray-300">— Sin cliente —</span>}
                      </td>
                      <td className="px-4 py-3 font-semibold text-gray-900">{fmt(woTotal)}</td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLOR[wo.status]}`}>
                          {STATUS_LABEL[wo.status]}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-500 text-xs">
                        {new Date(wo.createdAt).toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric' })}
                      </td>
                      <td className="px-4 py-3 text-right space-x-3 whitespace-nowrap">
                        <Link href={`/imprimir/orden-trabajo/${wo.id}`} target="_blank"
                          className="text-xs text-gray-500 hover:text-gray-700 font-medium">
                          Imprimir
                        </Link>
                        {wo.status === 'PENDING' && (
                          <>
                            <button onClick={() => openEdit(wo)} className="text-xs text-blue-600 hover:text-blue-800 font-medium">Editar</button>
                            <button onClick={() => openConvert(wo)} className="text-xs text-green-600 hover:text-green-800 font-medium">Aceptar y cobrar</button>
                            <button onClick={() => handleReject(wo.id)} className="text-xs text-amber-600 hover:text-amber-800 font-medium">Rechazar</button>
                            <button onClick={() => handleCancel(wo.id)} className="text-xs text-red-500 hover:text-red-700 font-medium">Anular</button>
                          </>
                        )}
                        {wo.status === 'CONVERTED' && wo.saleId && (
                          <Link href={`/dashboard/sales`} className="text-xs text-gray-400">Venta registrada</Link>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {!loading && workOrders.length === 0 && (
                  <tr><td colSpan={6} className="px-4 py-10 text-center text-gray-400">Sin órdenes de trabajo.</td></tr>
                )}
              </tbody>
            </table>
          </div>

          {pages > 1 && (
            <div className="flex items-center justify-between">
              <button onClick={() => loadWorkOrders(page - 1)} disabled={page <= 1}
                className="text-sm text-blue-600 disabled:text-gray-300 hover:underline">← Anterior</button>
              <span className="text-sm text-gray-500">Página {page} de {pages} · {total} orden(es)</span>
              <button onClick={() => loadWorkOrders(page + 1)} disabled={page >= pages}
                className="text-sm text-blue-600 disabled:text-gray-300 hover:underline">Siguiente →</button>
            </div>
          )}
        </>
      )}

      {/* Modal crear/editar */}
      {form && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between shrink-0">
              <h2 className="font-bold text-gray-900 text-base">Editar orden de trabajo</h2>
              <button onClick={() => setForm(null)} className="text-gray-400 hover:text-gray-600 text-xl leading-none w-8 h-8 flex items-center justify-center">×</button>
            </div>
            <div className="overflow-y-auto flex-1 px-6 py-4 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-gray-600 mb-1">Cliente registrado (opcional)</label>
                  <select value={form.clientId} onChange={(e) => setForm({ ...form, clientId: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white">
                    <option value="">— Sin cliente registrado —</option>
                    {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Nombre (si no eliges cliente)</label>
                  <input value={form.customerName} onChange={(e) => setForm({ ...form, customerName: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Teléfono</label>
                  <input value={form.customerPhone} onChange={(e) => setForm({ ...form, customerPhone: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-gray-600 mb-1">Correo</label>
                  <input value={form.customerEmail} onChange={(e) => setForm({ ...form, customerEmail: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                </div>
              </div>

              <div className="border-t border-gray-100 pt-4">
                <h3 className="text-sm font-semibold text-gray-700 mb-2">Ítems</h3>

                {form.items.length > 0 && (
                  <div className="space-y-2 mb-3">
                    {form.items.map((it, idx) => (
                      <div key={idx} className="flex items-center gap-2 bg-gray-50 rounded-lg px-3 py-2">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-gray-800 truncate">{it.productName}</p>
                          {it.productSku && <p className="text-xs text-gray-400 font-mono">{it.productSku}</p>}
                        </div>
                        <input type="number" min={1} value={it.quantity}
                          onChange={(e) => updateItem(idx, { quantity: Math.max(1, parseInt(e.target.value) || 1) })}
                          className="w-16 px-2 py-1 border border-gray-300 rounded-lg text-sm" />
                        <input type="number" min={0} value={it.unitPrice}
                          onChange={(e) => updateItem(idx, { unitPrice: Number(e.target.value) || 0 })}
                          className="w-24 px-2 py-1 border border-gray-300 rounded-lg text-sm" />
                        <span className="w-24 text-right text-sm font-medium text-gray-700 shrink-0">{fmt(it.quantity * it.unitPrice)}</span>
                        <button onClick={() => removeItem(idx)} className="text-gray-400 hover:text-red-500 text-lg leading-none px-1">×</button>
                      </div>
                    ))}
                  </div>
                )}

                <div className="relative mb-3">
                  <input value={productSearch} onChange={(e) => setProductSearch(e.target.value)}
                    placeholder="Buscar producto del catálogo para agregar..."
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                  {productResults.length > 0 && (
                    <div className="absolute z-10 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-52 overflow-y-auto">
                      {productResults.map((p) => (
                        <button key={p.id} onClick={() => addCatalogItem(p)}
                          className="w-full text-left px-3 py-2 hover:bg-gray-50 text-sm flex items-center justify-between gap-2">
                          <span className="truncate">{p.name} <span className="text-gray-400 font-mono text-xs">{p.sku}</span></span>
                          <span className="text-gray-500 shrink-0">{fmt(Number(p.price))}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap items-end gap-2 bg-indigo-50 border border-indigo-100 rounded-lg p-3">
                  <div className="flex-1 min-w-[160px]">
                    <label className="block text-xs font-medium text-gray-600 mb-1">Línea libre (mano de obra, servicio...)</label>
                    <input value={freeDesc} onChange={(e) => setFreeDesc(e.target.value)} placeholder="Ej: Mano de obra - diagnóstico"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Cant.</label>
                    <input type="number" min={1} value={freeQty} onChange={(e) => setFreeQty(e.target.value)}
                      className="w-16 px-2 py-2 border border-gray-300 rounded-lg text-sm" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Precio</label>
                    <input type="number" min={0} value={freePrice} onChange={(e) => setFreePrice(e.target.value)}
                      className="w-24 px-2 py-2 border border-gray-300 rounded-lg text-sm" />
                  </div>
                  <button onClick={addFreeItem} disabled={!freeDesc.trim()}
                    className="px-3 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-lg text-sm font-medium">
                    + Agregar
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Notas / observaciones</label>
                <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
              </div>

              <div className="flex items-center justify-between border-t border-gray-100 pt-3">
                <span className="text-sm font-semibold text-gray-700">Total</span>
                <span className="text-lg font-bold text-gray-900">{fmt(formTotal)}</span>
              </div>

              {formError && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{formError}</p>}
            </div>
            <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-2 shrink-0">
              <button onClick={() => setForm(null)} className="px-4 py-2 border border-gray-300 text-gray-600 rounded-lg text-sm hover:bg-gray-50">Cancelar</button>
              <button onClick={handleSaveForm} disabled={saving}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg text-sm font-semibold">
                {saving ? 'Guardando...' : 'Guardar orden de trabajo'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal aceptar y cobrar */}
      {converting && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
              <h2 className="font-bold text-gray-900 text-base">Aceptar y cobrar #{String(converting.folio).padStart(4, '0')}</h2>
              <button onClick={() => setConverting(null)} className="text-gray-400 hover:text-gray-600 text-xl leading-none w-8 h-8 flex items-center justify-center">×</button>
            </div>
            <div className="p-6 space-y-4">
              <div className="bg-gray-50 rounded-lg p-3 text-sm">
                <p className="font-medium text-gray-800">{fmt(converting.items.reduce((s: number, i: any) => s + i.quantity * Number(i.unitPrice), 0))}</p>
                <p className="text-xs text-gray-500 mt-0.5">Al confirmar, se registra la venta y se descuenta el stock de los productos de la orden.</p>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Método de pago</label>
                <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white">
                  {Object.entries(PAYMENT_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </div>

              {billingConns.length > 0 && (
                <div>
                  <label className="flex items-center gap-2 text-sm font-semibold text-gray-700 mb-2 cursor-pointer">
                    <input type="checkbox" checked={emitDte} onChange={(e) => setEmitDte(e.target.checked)} className="rounded" />
                    Emitir documento tributario
                  </label>
                  {emitDte && (
                    <div className="space-y-2 pl-6">
                      <div className="flex gap-2">
                        <button type="button" onClick={() => { setDteFamily('BOLETA'); setDteType('BOLETA'); }}
                          className={`flex-1 py-2 rounded-lg border-2 text-xs font-semibold ${dteFamily === 'BOLETA' ? 'border-blue-600 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-600'}`}>
                          Boleta
                        </button>
                        <button type="button" onClick={() => { setDteFamily('FACTURA'); setDteType('FACTURA'); }}
                          className={`flex-1 py-2 rounded-lg border-2 text-xs font-semibold ${dteFamily === 'FACTURA' ? 'border-blue-600 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-600'}`}>
                          Factura
                        </button>
                      </div>
                      {dteFamily === 'FACTURA' && (
                        <select value={dteType} onChange={(e) => setDteType(e.target.value as any)}
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white">
                          <option value="FACTURA">Factura Electrónica (33)</option>
                          <option value="FACTURA_EXENTA">Factura Exenta (34)</option>
                        </select>
                      )}
                      {billingConns.length > 1 && (
                        <select value={dteConnId} onChange={(e) => setDteConnId(e.target.value)}
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white">
                          {billingConns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </select>
                      )}
                      {isFactura && !converting.client?.rut && (
                        <p className="text-xs text-amber-600">La orden necesita un cliente con RUT y razón social para emitir Factura.</p>
                      )}
                    </div>
                  )}
                </div>
              )}
              {!emitDte && (
                <p className="text-xs text-gray-400">Sin documento tributario — la venta queda registrada igual.</p>
              )}

              {convertError && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{convertError}</p>}
            </div>
            <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-2">
              <button onClick={() => setConverting(null)} className="px-4 py-2 border border-gray-300 text-gray-600 rounded-lg text-sm hover:bg-gray-50">Cancelar</button>
              <button onClick={handleConfirmConvert} disabled={convertSaving}
                className="px-4 py-2 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white rounded-lg text-sm font-semibold">
                {convertSaving ? 'Procesando...' : 'Confirmar y cobrar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
