'use client';

import { useEffect, useState } from 'react';
import { getToken, getUser } from '@/lib/auth';
import { api } from '@/lib/api';
import { useAdminCompany } from '../AdminCompanyContext';
import { useDashboardTimezone } from '@/lib/dashboardTimezone';
import Link from 'next/link';
import { Modal, FormError, btnPrimary, btnSecondary } from '@/components/ui/Modal';

const emptyPurchaseForm = { supplierId: '', warehouseId: '', documentNumber: '', notes: '' };
const emptyItem = { productId: '', quantity: '1', unitCost: '' };

const fmt = (n: number) => `$${Number(n).toLocaleString('es-CL')}`;

export default function PurchasesPage() {
  const { selectedCompanyId } = useAdminCompany();
  const tz = useDashboardTimezone();
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [purchases, setPurchases] = useState<any[]>([]);
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const [showPurchaseForm, setShowPurchaseForm] = useState(false);
  const [purchaseForm, setPurchaseForm] = useState(emptyPurchaseForm);
  const [items, setItems] = useState([{ ...emptyItem }]);
  const [purchaseLoading, setPurchaseLoading] = useState(false);
  const [purchaseError, setPurchaseError] = useState('');

  const isSuperAdmin = currentUser?.role === 'SUPER_ADMIN';
  const isAdmin = ['SUPER_ADMIN', 'COMPANY_ADMIN', 'CATALOG_MANAGER'].includes(currentUser?.role);

  async function load() {
    const token = getToken();
    if (!token) return;
    if (isSuperAdmin && !selectedCompanyId) {
      setPurchases([]); setSuppliers([]); setWarehouses([]); setProducts([]);
      setLoading(false);
      return;
    }
    const companyId = isSuperAdmin ? selectedCompanyId : undefined;
    setLoading(true);
    try {
      const [p, s, w, prods] = await Promise.all([
        api.purchases.list(token, { companyId }).catch(() => ({ purchases: [] })),
        api.suppliers.list(token, companyId).catch(() => []),
        api.warehouses.list(token).catch(() => []),
        api.catalog.list(token, companyId).catch(() => []),
      ]);
      setPurchases(p.purchases || []);
      setSuppliers((s || []).filter((x: any) => x.active));
      setWarehouses((w || []).filter((x: any) => x.active && (!isSuperAdmin || x.companyId === selectedCompanyId)));
      setProducts(prods || []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setCurrentUser(getUser());
  }, []);

  useEffect(() => {
    if (!currentUser) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser, selectedCompanyId]);

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

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-[1.375rem] font-bold text-gray-900">Compras</h1>
          <p className="text-gray-500 text-xs mt-0.5">
            Registra compras a proveedores por lotes; el costo de cada producto se calcula automáticamente.
          </p>
        </div>
      </div>

      {isSuperAdmin && !selectedCompanyId ? (
        <div className="bg-white rounded-xl border border-dashed border-gray-300 px-4 py-12 text-center text-gray-400 text-sm">
          <p className="text-3xl mb-2">🏢</p>
          <p>Selecciona una empresa arriba para ver y registrar sus compras.</p>
        </div>
      ) : (
      <>
      <div className="mb-4 px-4 py-2.5 bg-blue-50 border border-blue-100 rounded-lg text-xs text-blue-800">
        Los traspasos entre bodegas ahora se registran con documento y recepción en{' '}
        <Link href="/dashboard/inventario?tab=traspasos" className="font-semibold underline">Inventario → Traspasos</Link>.
      </div>

        <div>
          {isAdmin && (
            <div className="flex justify-end mb-4">
              <button
                onClick={() => { setShowPurchaseForm(true); setPurchaseForm(emptyPurchaseForm); setItems([{ ...emptyItem }]); setPurchaseError(''); }}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"
              >
                + Nueva compra
              </button>
            </div>
          )}

          {showPurchaseForm && isAdmin && (
            <Modal title="Nueva compra" subtitle="Cada producto entra como un lote a la bodega destino y queda en el historial."
              size="lg" onClose={() => setShowPurchaseForm(false)} onSubmit={handleCreatePurchase} busy={purchaseLoading}
              footer={<>
                <button type="button" onClick={() => setShowPurchaseForm(false)} disabled={purchaseLoading} className={btnSecondary}>Cancelar</button>
                <button type="submit" disabled={purchaseLoading} className={btnPrimary}>{purchaseLoading ? 'Guardando...' : 'Registrar compra'}</button>
              </>}>
              <div className="space-y-4">
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

                <FormError message={purchaseError} />
              </div>
            </Modal>
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
                      <td className="px-4 py-3 text-gray-600">{new Date(p.date).toLocaleDateString('es-CL', { timeZone: tz })}</td>
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

      </>
      )}
    </div>
  );
}
