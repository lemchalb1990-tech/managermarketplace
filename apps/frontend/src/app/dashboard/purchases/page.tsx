'use client';

import { useEffect, useState } from 'react';
import { getToken, getUser } from '@/lib/auth';
import { api } from '@/lib/api';

type Tab = 'purchases' | 'transfers';

const emptyPurchaseForm = { supplierId: '', warehouseId: '', documentNumber: '', notes: '' };
const emptyItem = { productId: '', quantity: '1', unitCost: '' };
const emptyTransferForm = { productId: '', fromWarehouseId: '', toWarehouseId: '', quantity: '1', reason: '' };

const fmt = (n: number) => `$${Number(n).toLocaleString('es-CL')}`;

export default function PurchasesPage() {
  const [tab, setTab] = useState<Tab>('purchases');
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [companies, setCompanies] = useState<any[]>([]);
  const [selectedCompanyId, setSelectedCompanyId] = useState('');
  const [purchases, setPurchases] = useState<any[]>([]);
  const [transfers, setTransfers] = useState<any[]>([]);
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const [showPurchaseForm, setShowPurchaseForm] = useState(false);
  const [purchaseForm, setPurchaseForm] = useState(emptyPurchaseForm);
  const [items, setItems] = useState([{ ...emptyItem }]);
  const [purchaseLoading, setPurchaseLoading] = useState(false);
  const [purchaseError, setPurchaseError] = useState('');

  const [showTransferForm, setShowTransferForm] = useState(false);
  const [transferForm, setTransferForm] = useState(emptyTransferForm);
  const [transferLoading, setTransferLoading] = useState(false);
  const [transferError, setTransferError] = useState('');

  const isSuperAdmin = currentUser?.role === 'SUPER_ADMIN';
  const isAdmin = ['SUPER_ADMIN', 'COMPANY_ADMIN', 'CATALOG_MANAGER'].includes(currentUser?.role);

  async function load() {
    const token = getToken();
    if (!token) return;
    if (isSuperAdmin && !selectedCompanyId) {
      setPurchases([]); setTransfers([]); setSuppliers([]); setWarehouses([]); setProducts([]);
      setLoading(false);
      return;
    }
    const companyId = isSuperAdmin ? selectedCompanyId : undefined;
    setLoading(true);
    try {
      const [p, t, s, w, prods] = await Promise.all([
        api.purchases.list(token, { companyId }).catch(() => ({ purchases: [] })),
        api.stockTransfers.list(token, { companyId }).catch(() => ({ transfers: [] })),
        api.suppliers.list(token, companyId).catch(() => []),
        api.warehouses.list(token).catch(() => []),
        api.catalog.list(token, companyId).catch(() => []),
      ]);
      setPurchases(p.purchases || []);
      setTransfers(t.transfers || []);
      setSuppliers((s || []).filter((x: any) => x.active));
      setWarehouses((w || []).filter((x: any) => x.active && (!isSuperAdmin || x.companyId === selectedCompanyId)));
      setProducts(prods || []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const u = getUser();
    setCurrentUser(u);
    const token = getToken();
    if (token && u?.role === 'SUPER_ADMIN') {
      api.companies.list(token).then(setCompanies).catch(() => {});
    }
  }, []);

  useEffect(() => {
    if (!currentUser) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser, selectedCompanyId]);

  function selectCompany(companyId: string) {
    setSelectedCompanyId(companyId);
    setShowPurchaseForm(false);
    setShowTransferForm(false);
  }

  function addItemRow() {
    setItems((prev) => [...prev, { ...emptyItem }]);
  }
  function removeItemRow(idx: number) {
    setItems((prev) => prev.filter((_, i) => i !== idx));
  }
  function updateItem(idx: number, patch: Partial<typeof emptyItem>) {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  }

  const purchaseTotal = items.reduce((s, it) => s + (Number(it.quantity) || 0) * (Number(it.unitCost) || 0), 0);

  async function handleCreatePurchase(e: React.FormEvent) {
    e.preventDefault();
    setPurchaseError('');
    setPurchaseLoading(true);
    try {
      const token = getToken()!;
      const validItems = items.filter((it) => it.productId && Number(it.quantity) > 0);
      if (!validItems.length) throw new Error('Agrega al menos un producto con cantidad válida.');
      await api.purchases.create({
        supplierId: purchaseForm.supplierId,
        warehouseId: purchaseForm.warehouseId,
        documentNumber: purchaseForm.documentNumber || undefined,
        notes: purchaseForm.notes || undefined,
        items: validItems.map((it) => ({ productId: it.productId, quantity: Number(it.quantity), unitCost: Number(it.unitCost) || 0 })),
        companyId: isSuperAdmin ? selectedCompanyId : undefined,
      }, token);
      setPurchaseForm(emptyPurchaseForm);
      setItems([{ ...emptyItem }]);
      setShowPurchaseForm(false);
      await load();
    } catch (err: any) {
      setPurchaseError(err.message || 'Error al registrar la compra');
    } finally {
      setPurchaseLoading(false);
    }
  }

  async function handleCreateTransfer(e: React.FormEvent) {
    e.preventDefault();
    setTransferError('');
    setTransferLoading(true);
    try {
      const token = getToken()!;
      await api.stockTransfers.create({
        productId: transferForm.productId,
        fromWarehouseId: transferForm.fromWarehouseId,
        toWarehouseId: transferForm.toWarehouseId,
        quantity: Number(transferForm.quantity),
        reason: transferForm.reason || undefined,
        companyId: isSuperAdmin ? selectedCompanyId : undefined,
      }, token);
      setTransferForm(emptyTransferForm);
      setShowTransferForm(false);
      await load();
    } catch (err: any) {
      setTransferError(err.message || 'Error al registrar el traspaso');
    } finally {
      setTransferLoading(false);
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Compras</h1>
          <p className="text-gray-500 text-sm mt-0.5">
            Registra compras a proveedores por lotes; el costo de cada producto se calcula automáticamente.
          </p>
        </div>
        {isSuperAdmin && (
          <select
            value={selectedCompanyId}
            onChange={(e) => selectCompany(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white font-medium"
          >
            <option value="">— Selecciona una empresa —</option>
            {companies.map((c: any) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        )}
      </div>

      {isSuperAdmin && !selectedCompanyId ? (
        <div className="bg-white rounded-xl border border-dashed border-gray-300 px-4 py-12 text-center text-gray-400 text-sm">
          <p className="text-3xl mb-2">🏢</p>
          <p>Selecciona una empresa arriba para ver y registrar sus compras y traspasos.</p>
        </div>
      ) : (
      <>
      <div className="flex items-center border-b border-gray-200 mb-6">
        {(['purchases', 'transfers'] as Tab[]).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`py-2.5 px-4 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === t ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}>
            {t === 'purchases' ? 'Compras' : 'Traspasos entre bodegas'}
          </button>
        ))}
      </div>

      {tab === 'purchases' && (
        <div>
          {isAdmin && (
            <div className="flex justify-end mb-4">
              <button
                onClick={() => { setShowPurchaseForm(!showPurchaseForm); setPurchaseForm(emptyPurchaseForm); setItems([{ ...emptyItem }]); setPurchaseError(''); }}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"
              >
                + Nueva compra
              </button>
            </div>
          )}

          {showPurchaseForm && isAdmin && (
            <div className="bg-white rounded-xl border border-gray-200 p-5 mb-6">
              <h2 className="font-semibold text-gray-800 mb-4">Nueva compra</h2>
              <form onSubmit={handleCreatePurchase} className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Proveedor *</label>
                    <select value={purchaseForm.supplierId} required
                      onChange={(e) => setPurchaseForm((f) => ({ ...f, supplierId: e.target.value }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white">
                      <option value="">— Selecciona un proveedor —</option>
                      {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Bodega destino *</label>
                    <select value={purchaseForm.warehouseId} required
                      onChange={(e) => setPurchaseForm((f) => ({ ...f, warehouseId: e.target.value }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white">
                      <option value="">— Selecciona una bodega —</option>
                      {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">N° de documento</label>
                    <input value={purchaseForm.documentNumber}
                      onChange={(e) => setPurchaseForm((f) => ({ ...f, documentNumber: e.target.value }))}
                      placeholder="Factura, boleta..."
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Notas</label>
                    <input value={purchaseForm.notes}
                      onChange={(e) => setPurchaseForm((f) => ({ ...f, notes: e.target.value }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-2">Productos *</label>
                  <div className="space-y-2">
                    {items.map((it, idx) => (
                      <div key={idx} className="flex flex-wrap gap-2 items-center">
                        <select value={it.productId} required
                          onChange={(e) => updateItem(idx, { productId: e.target.value })}
                          className="flex-1 min-w-[160px] px-2 py-1.5 border border-gray-300 rounded-lg text-xs bg-white">
                          <option value="">— Producto —</option>
                          {products.map((p) => <option key={p.id} value={p.id}>{p.sku} — {p.name}</option>)}
                        </select>
                        <input type="number" min={1} value={it.quantity}
                          onChange={(e) => updateItem(idx, { quantity: e.target.value })}
                          placeholder="Cant." className="w-20 px-2 py-1.5 border border-gray-300 rounded-lg text-xs" />
                        <input type="number" min={0} step="0.01" value={it.unitCost}
                          onChange={(e) => updateItem(idx, { unitCost: e.target.value })}
                          placeholder="Costo unit." className="w-28 px-2 py-1.5 border border-gray-300 rounded-lg text-xs" />
                        <button type="button" onClick={() => removeItemRow(idx)} disabled={items.length === 1}
                          className="text-red-400 hover:text-red-600 text-lg leading-none px-1 disabled:opacity-30">×</button>
                      </div>
                    ))}
                  </div>
                  <button type="button" onClick={addItemRow}
                    className="mt-2 text-xs text-blue-600 hover:text-blue-800 font-medium">
                    + Agregar producto
                  </button>
                </div>

                <p className="text-sm text-gray-600">Total: <span className="font-semibold text-gray-900">{fmt(purchaseTotal)}</span></p>

                {purchaseError && (
                  <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{purchaseError}</p>
                )}
                <div className="flex gap-2">
                  <button type="submit" disabled={purchaseLoading}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
                    {purchaseLoading ? 'Guardando...' : 'Registrar compra'}
                  </button>
                  <button type="button" onClick={() => setShowPurchaseForm(false)}
                    className="px-4 py-2 border border-gray-300 text-gray-600 rounded-lg text-sm hover:bg-gray-50">
                    Cancelar
                  </button>
                </div>
              </form>
            </div>
          )}

          <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
            {loading ? (
              <div className="px-4 py-10 text-center text-gray-400 text-sm">Cargando...</div>
            ) : purchases.length === 0 ? (
              <div className="px-4 py-12 text-center text-gray-400">
                <div className="text-4xl mb-3">📦</div>
                <p className="text-sm font-medium mb-1">Sin compras registradas</p>
                <p className="text-xs">
                  {isAdmin ? 'Registra tu primera compra para empezar a costear por lotes.' : 'Todavía no hay compras registradas.'}
                </p>
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="text-left px-4 py-3 text-gray-600 font-medium">Fecha</th>
                    <th className="text-left px-4 py-3 text-gray-600 font-medium">Proveedor</th>
                    <th className="text-left px-4 py-3 text-gray-600 font-medium">Bodega</th>
                    <th className="text-left px-4 py-3 text-gray-600 font-medium">Documento</th>
                    <th className="text-center px-4 py-3 text-gray-600 font-medium">Ítems</th>
                    <th className="text-right px-4 py-3 text-gray-600 font-medium">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {purchases.map((p) => (
                    <tr key={p.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-gray-600">{new Date(p.date).toLocaleDateString('es-CL')}</td>
                      <td className="px-4 py-3 font-medium text-gray-900">{p.supplier?.name}</td>
                      <td className="px-4 py-3 text-gray-600">{p.warehouse?.name}</td>
                      <td className="px-4 py-3 text-gray-500">{p.documentNumber || <span className="text-gray-300">—</span>}</td>
                      <td className="px-4 py-3 text-center text-gray-600">{p._count?.items ?? 0}</td>
                      <td className="px-4 py-3 text-right font-medium text-gray-900">{fmt(Number(p.total))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {tab === 'transfers' && (
        <div>
          {isAdmin && (
            <div className="flex justify-end mb-4">
              <button
                onClick={() => { setShowTransferForm(!showTransferForm); setTransferForm(emptyTransferForm); setTransferError(''); }}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"
              >
                + Nuevo traspaso
              </button>
            </div>
          )}

          {showTransferForm && isAdmin && (
            <div className="bg-white rounded-xl border border-gray-200 p-5 mb-6">
              <h2 className="font-semibold text-gray-800 mb-4">Nuevo traspaso</h2>
              <form onSubmit={handleCreateTransfer} className="space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="col-span-2">
                    <label className="block text-xs font-medium text-gray-600 mb-1">Producto *</label>
                    <select value={transferForm.productId} required
                      onChange={(e) => setTransferForm((f) => ({ ...f, productId: e.target.value }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white">
                      <option value="">— Selecciona un producto —</option>
                      {products.map((p) => <option key={p.id} value={p.id}>{p.sku} — {p.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Bodega origen *</label>
                    <select value={transferForm.fromWarehouseId} required
                      onChange={(e) => setTransferForm((f) => ({ ...f, fromWarehouseId: e.target.value }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white">
                      <option value="">— Origen —</option>
                      {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Bodega destino *</label>
                    <select value={transferForm.toWarehouseId} required
                      onChange={(e) => setTransferForm((f) => ({ ...f, toWarehouseId: e.target.value }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white">
                      <option value="">— Destino —</option>
                      {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Cantidad *</label>
                    <input type="number" min={1} value={transferForm.quantity} required
                      onChange={(e) => setTransferForm((f) => ({ ...f, quantity: e.target.value }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Motivo</label>
                    <input value={transferForm.reason}
                      onChange={(e) => setTransferForm((f) => ({ ...f, reason: e.target.value }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                  </div>
                </div>
                {transferError && (
                  <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{transferError}</p>
                )}
                <div className="flex gap-2">
                  <button type="submit" disabled={transferLoading}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
                    {transferLoading ? 'Guardando...' : 'Registrar traspaso'}
                  </button>
                  <button type="button" onClick={() => setShowTransferForm(false)}
                    className="px-4 py-2 border border-gray-300 text-gray-600 rounded-lg text-sm hover:bg-gray-50">
                    Cancelar
                  </button>
                </div>
              </form>
            </div>
          )}

          <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
            {loading ? (
              <div className="px-4 py-10 text-center text-gray-400 text-sm">Cargando...</div>
            ) : transfers.length === 0 ? (
              <div className="px-4 py-12 text-center text-gray-400">
                <div className="text-4xl mb-3">🔀</div>
                <p className="text-sm font-medium mb-1">Sin traspasos registrados</p>
                <p className="text-xs">Mueve stock entre bodegas conservando el costo real de cada lote.</p>
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="text-left px-4 py-3 text-gray-600 font-medium">Fecha</th>
                    <th className="text-left px-4 py-3 text-gray-600 font-medium">Producto</th>
                    <th className="text-left px-4 py-3 text-gray-600 font-medium">Origen</th>
                    <th className="text-left px-4 py-3 text-gray-600 font-medium">Destino</th>
                    <th className="text-center px-4 py-3 text-gray-600 font-medium">Cantidad</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {transfers.map((t) => (
                    <tr key={t.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-gray-600">{new Date(t.createdAt).toLocaleDateString('es-CL')}</td>
                      <td className="px-4 py-3 font-medium text-gray-900">{t.product?.name}</td>
                      <td className="px-4 py-3 text-gray-600">{t.fromWarehouse?.name}</td>
                      <td className="px-4 py-3 text-gray-600">{t.toWarehouse?.name}</td>
                      <td className="px-4 py-3 text-center text-gray-800 font-semibold">{t.quantity}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
      </>
      )}
    </div>
  );
}
