'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getToken, getUser } from '@/lib/auth';
import { api } from '@/lib/api';

const emptyClientForm = { name: '', rut: '', email: '', phone: '', address: '', commune: '', city: '' };

const fmt = (n: number) => `$${Number(n).toLocaleString('es-CL')}`;

type CartItem = { productId: string; name: string; sku: string; price: number; stock: number; quantity: number };

export default function NuevaSolicitudPage() {
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [companies, setCompanies] = useState<any[]>([]);
  const [selectedCompanyId, setSelectedCompanyId] = useState('');

  const [clients, setClients] = useState<any[]>([]);
  const [clientId, setClientId] = useState('');
  const [debt, setDebt] = useState<any>(null);
  const [debtLoading, setDebtLoading] = useState(false);

  const [showCreateClient, setShowCreateClient] = useState(false);
  const [clientForm, setClientForm] = useState(emptyClientForm);
  const [clientLoading, setClientLoading] = useState(false);
  const [clientError, setClientError] = useState('');

  const [productSearch, setProductSearch] = useState('');
  const [products, setProducts] = useState<any[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);

  const [cart, setCart] = useState<CartItem[]>([]);
  const [scheduledDispatchDate, setScheduledDispatchDate] = useState('');
  const [notes, setNotes] = useState('');

  const [submitLoading, setSubmitLoading] = useState(false);
  const [submitError, setSubmitError] = useState('');

  const isSuperAdmin = currentUser?.role === 'SUPER_ADMIN';
  const companyId = isSuperAdmin ? selectedCompanyId : undefined;
  const ready = !isSuperAdmin || !!selectedCompanyId;

  useEffect(() => {
    const u = getUser();
    setCurrentUser(u);
    const token = getToken();
    if (token && u?.role === 'SUPER_ADMIN') {
      api.companies.list(token).then(setCompanies).catch(() => {});
    }
  }, []);

  useEffect(() => {
    if (!currentUser || !ready) return;
    const token = getToken();
    if (!token) return;
    api.clients.list(token, companyId).then((data) => setClients(data.filter((c: any) => c.active))).catch(() => setClients([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser, selectedCompanyId]);

  useEffect(() => {
    setClientId('');
    setDebt(null);
    setCart([]);
  }, [selectedCompanyId]);

  useEffect(() => {
    if (!clientId) { setDebt(null); return; }
    const token = getToken();
    if (!token) return;
    setDebtLoading(true);
    api.clients.debt(clientId, token).then(setDebt).catch(() => setDebt(null)).finally(() => setDebtLoading(false));
  }, [clientId]);

  useEffect(() => {
    if (!currentUser || !ready) return;
    const token = getToken();
    if (!token) return;
    setSearchLoading(true);
    const handle = setTimeout(() => {
      api.catalog.search({ search: productSearch, active: 'true', companyId, pageSize: 15 }, token)
        .then((res) => setProducts(res.products))
        .catch(() => setProducts([]))
        .finally(() => setSearchLoading(false));
    }, 300);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productSearch, currentUser, selectedCompanyId]);

  function addToCart(p: any) {
    setCart((prev) => {
      const existing = prev.find((i) => i.productId === p.id);
      if (existing) {
        return prev.map((i) => i.productId === p.id ? { ...i, quantity: Math.min(i.quantity + 1, p.stock) } : i);
      }
      return [...prev, { productId: p.id, name: p.name, sku: p.sku, price: Number(p.price), stock: p.stock, quantity: 1 }];
    });
  }

  function updateQty(productId: string, quantity: number) {
    setCart((prev) => prev.map((i) => i.productId === productId ? { ...i, quantity: Math.max(1, Math.min(quantity, i.stock)) } : i));
  }

  function removeFromCart(productId: string) {
    setCart((prev) => prev.filter((i) => i.productId !== productId));
  }

  const cartTotal = cart.reduce((s, i) => s + i.price * i.quantity, 0);
  const overLimit = debt?.overLimit === true;

  async function handleCreateClient(e: React.FormEvent) {
    e.preventDefault();
    setClientError('');
    setClientLoading(true);
    try {
      const token = getToken()!;
      const created = await api.clients.create({
        name: clientForm.name.trim(),
        rut: clientForm.rut.trim() || undefined,
        email: clientForm.email.trim() || undefined,
        phone: clientForm.phone.trim() || undefined,
        address: clientForm.address.trim() || undefined,
        commune: clientForm.commune.trim() || undefined,
        city: clientForm.city.trim() || undefined,
        companyId,
      }, token);
      setClients((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)));
      setClientId(created.id);
      setShowCreateClient(false);
      setClientForm(emptyClientForm);
    } catch (err: any) {
      setClientError(err.message || 'Error al crear cliente');
    } finally {
      setClientLoading(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitError('');
    if (!clientId) { setSubmitError('Selecciona un cliente.'); return; }
    if (cart.length === 0) { setSubmitError('Agrega al menos un producto.'); return; }
    if (overLimit) { setSubmitError('El cliente superó su límite de crédito. No se puede enviar la solicitud.'); return; }
    setSubmitLoading(true);
    try {
      const token = getToken()!;
      await api.orderRequests.create({
        clientId,
        scheduledDispatchDate: scheduledDispatchDate || undefined,
        notes: notes.trim() || undefined,
        companyId,
        items: cart.map((i) => ({ productId: i.productId, quantity: i.quantity })),
      }, token);
      router.push('/dashboard/pedidos/mis-solicitudes');
    } catch (err: any) {
      setSubmitError(err.message || 'Error al enviar la solicitud');
    } finally {
      setSubmitLoading(false);
    }
  }

  return (
    <div className="max-w-4xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Nueva solicitud de pedido</h1>
        <p className="text-gray-500 text-sm mt-0.5">Selecciona un cliente, arma el pedido y define la fecha de despacho.</p>
      </div>

      {isSuperAdmin && (
        <div className="mb-6">
          <select
            value={selectedCompanyId}
            onChange={(e) => setSelectedCompanyId(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white font-medium"
          >
            <option value="">— Selecciona una empresa —</option>
            {companies.map((c: any) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
      )}

      {!ready ? (
        <div className="bg-white rounded-xl border border-dashed border-gray-300 px-4 py-12 text-center text-gray-400 text-sm">
          <p className="text-3xl mb-2">🏢</p>
          <p>Selecciona una empresa arriba para levantar una solicitud.</p>
        </div>
      ) : (
      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h2 className="font-semibold text-gray-800 mb-3">1. Cliente</h2>
          <div className="flex flex-wrap gap-2 items-center">
            <select value={clientId} onChange={(e) => setClientId(e.target.value)}
              className="flex-1 min-w-[220px] px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white">
              <option value="">— Selecciona un cliente —</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.name}{c.rut ? ` (${c.rut})` : ''}</option>)}
            </select>
            <button type="button" onClick={() => { setShowCreateClient(true); setClientError(''); }}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-600 hover:bg-gray-50">
              + Nuevo cliente
            </button>
          </div>

          {debtLoading && <p className="text-xs text-gray-400 mt-2">Consultando deuda...</p>}
          {debt && !debtLoading && (
            <div className={`mt-3 px-4 py-3 rounded-lg text-sm border ${
              overLimit ? 'bg-red-50 border-red-200 text-red-700' : debt.totalDebt > 0 ? 'bg-amber-50 border-amber-200 text-amber-700' : 'bg-green-50 border-green-200 text-green-700'
            }`}>
              {debt.totalDebt > 0 ? (
                <p>
                  Facturas pendientes de pago: <span className="font-semibold">{fmt(debt.totalDebt)}</span>
                  {debt.creditLimit != null && <> de un límite de <span className="font-semibold">{fmt(debt.creditLimit)}</span></>}
                  {overLimit && <span className="block mt-1 font-semibold">⚠ Cliente superó su límite de crédito. No se puede enviar la solicitud.</span>}
                </p>
              ) : (
                <p>Sin facturas pendientes de pago.</p>
              )}
            </div>
          )}
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h2 className="font-semibold text-gray-800 mb-3">2. Productos</h2>
          <input value={productSearch} onChange={(e) => setProductSearch(e.target.value)}
            placeholder="Buscar por nombre o SKU..."
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm mb-3" />

          <div className="max-h-64 overflow-y-auto border border-gray-100 rounded-lg divide-y divide-gray-100">
            {searchLoading ? (
              <p className="px-3 py-4 text-xs text-gray-400 text-center">Buscando...</p>
            ) : products.length === 0 ? (
              <p className="px-3 py-4 text-xs text-gray-400 text-center">Sin resultados.</p>
            ) : products.map((p) => (
              <div key={p.id} className="flex items-center justify-between px-3 py-2 text-sm hover:bg-gray-50">
                <div>
                  <p className="font-medium text-gray-900">{p.name}</p>
                  <p className="text-xs text-gray-400">{p.sku} · Stock: {p.stock} · {fmt(Number(p.price))}</p>
                </div>
                <button type="button" onClick={() => addToCart(p)} disabled={p.stock === 0}
                  className="text-xs px-3 py-1.5 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-40">
                  Agregar
                </button>
              </div>
            ))}
          </div>

          {cart.length > 0 && (
            <div className="mt-4 space-y-2">
              {cart.map((i) => (
                <div key={i.productId} className="flex items-center gap-2 text-sm">
                  <span className="flex-1 text-gray-800">{i.name} <span className="text-gray-400 text-xs">({i.sku})</span></span>
                  <input type="number" min={1} max={i.stock} value={i.quantity}
                    onChange={(e) => updateQty(i.productId, Number(e.target.value))}
                    className="w-20 px-2 py-1 border border-gray-300 rounded-lg text-xs" />
                  <span className="w-24 text-right text-gray-600">{fmt(i.price * i.quantity)}</span>
                  <button type="button" onClick={() => removeFromCart(i.productId)}
                    className="text-red-400 hover:text-red-600 text-lg leading-none px-1">×</button>
                </div>
              ))}
              <p className="text-right text-sm text-gray-700 pt-2 border-t border-gray-100">
                Total: <span className="font-semibold text-gray-900">{fmt(cartTotal)}</span>
              </p>
            </div>
          )}
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h2 className="font-semibold text-gray-800 mb-3">3. Despacho</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Fecha de despacho</label>
              <input type="date" value={scheduledDispatchDate} onChange={(e) => setScheduledDispatchDate(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Notas</label>
              <input value={notes} onChange={(e) => setNotes(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
            </div>
          </div>
        </div>

        {submitError && (
          <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-3">{submitError}</p>
        )}

        <button type="submit" disabled={submitLoading || overLimit}
          className="px-5 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 disabled:opacity-50">
          {submitLoading ? 'Enviando...' : 'Enviar solicitud'}
        </button>
      </form>
      )}

      {showCreateClient && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[90vh] flex flex-col">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between shrink-0">
              <h2 className="font-bold text-gray-900">Nuevo cliente</h2>
              <button onClick={() => setShowCreateClient(false)}
                className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
            </div>
            <form onSubmit={handleCreateClient} className="overflow-y-auto">
              <div className="px-6 py-5 space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Nombre / Razón social *</label>
                  <input value={clientForm.name} onChange={(e) => setClientForm((f) => ({ ...f, name: e.target.value }))}
                    required className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">RUT</label>
                  <input value={clientForm.rut} onChange={(e) => setClientForm((f) => ({ ...f, rut: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Email</label>
                  <input type="email" value={clientForm.email} onChange={(e) => setClientForm((f) => ({ ...f, email: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Teléfono</label>
                  <input value={clientForm.phone} onChange={(e) => setClientForm((f) => ({ ...f, phone: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Dirección</label>
                  <input value={clientForm.address} onChange={(e) => setClientForm((f) => ({ ...f, address: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1">Comuna</label>
                    <input value={clientForm.commune} onChange={(e) => setClientForm((f) => ({ ...f, commune: e.target.value }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1">Ciudad</label>
                    <input value={clientForm.city} onChange={(e) => setClientForm((f) => ({ ...f, city: e.target.value }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                  </div>
                </div>
                {clientError && (
                  <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{clientError}</p>
                )}
              </div>
              <div className="px-6 py-4 border-t border-gray-100 flex gap-2 justify-end">
                <button type="button" onClick={() => setShowCreateClient(false)}
                  className="px-4 py-2 border border-gray-300 text-gray-600 rounded-lg text-sm hover:bg-gray-50">
                  Cancelar
                </button>
                <button type="submit" disabled={clientLoading}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg text-sm font-semibold">
                  {clientLoading ? 'Creando...' : 'Crear cliente'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
