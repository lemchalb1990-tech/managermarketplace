'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getToken } from '@/lib/auth';
import { api } from '@/lib/api';

const DTE_TYPES = [
  { value: 'FACTURA', label: 'Factura Electrónica (33)', taxed: true },
  { value: 'BOLETA', label: 'Boleta Electrónica (39)', taxed: false },
  { value: 'FACTURA_EXENTA', label: 'Factura Exenta (34)', taxed: false },
  { value: 'NOTA_CREDITO', label: 'Nota de Crédito (61)', taxed: true },
  { value: 'NOTA_DEBITO', label: 'Nota de Débito (56)', taxed: true },
];

const IVA = 0.19;

interface Item { name: string; quantity: number; unitPrice: number; discount: number }
const emptyItem = (): Item => ({ name: '', quantity: 1, unitPrice: 0, discount: 0 });

export default function NewInvoicePage() {
  const router = useRouter();
  const [connections, setConnections] = useState<any[]>([]);
  const [form, setForm] = useState({
    connectionId: '',
    dteType: 'BOLETA',
    rut: '',
    razonSocial: '',
    giro: '',
    address: '',
    commune: '',
    email: '',
    notes: '',
  });
  const [items, setItems] = useState<Item[]>([emptyItem()]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const token = getToken()!;
    api.billing.connections.list(token, {}).then(setConnections).catch(() => {});
  }, []);

  const dteInfo = DTE_TYPES.find(d => d.value === form.dteType);
  const isTaxed = dteInfo?.taxed ?? true;

  const itemTotals = items.map(i => {
    const gross = i.unitPrice * i.quantity * (1 - i.discount / 100);
    return gross;
  });
  const grossTotal = itemTotals.reduce((a, b) => a + b, 0);
  const netAmount = isTaxed ? grossTotal : grossTotal / (1 + IVA);
  const tax = isTaxed ? Math.round(netAmount * IVA) : 0;
  const totalAmount = Math.round(isTaxed ? netAmount + tax : grossTotal);

  const fmt = (n: number) => new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP' }).format(Math.round(n));

  function updateItem(idx: number, field: keyof Item, val: string | number) {
    setItems(prev => prev.map((item, i) => i === idx ? { ...item, [field]: val } : item));
  }

  function addItem() { setItems(prev => [...prev, emptyItem()]); }
  function removeItem(idx: number) {
    if (items.length === 1) return;
    setItems(prev => prev.filter((_, i) => i !== idx));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.connectionId) { setError('Selecciona una conexión de facturación'); return; }
    if (!form.rut.trim() || !form.razonSocial.trim()) { setError('RUT y razón social son requeridos'); return; }
    if (items.some(i => !i.name.trim() || i.unitPrice <= 0)) { setError('Completa todos los ítems'); return; }

    setLoading(true);
    setError('');
    try {
      const token = getToken()!;
      const invoice = await api.billing.invoices.issue({
        connectionId: form.connectionId,
        dteType: form.dteType,
        rut: form.rut.trim(),
        razonSocial: form.razonSocial.trim(),
        giro: form.giro.trim() || undefined,
        address: form.address.trim() || undefined,
        commune: form.commune.trim() || undefined,
        email: form.email.trim() || undefined,
        notes: form.notes.trim() || undefined,
        items: items.map(i => ({
          name: i.name,
          quantity: i.quantity,
          unitPrice: i.unitPrice,
          discount: i.discount || undefined,
        })),
      }, token);
      router.push(`/dashboard/billing/invoices?issued=${invoice.id}`);
    } catch (err: any) {
      setError(err.message || 'Error al emitir el documento');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-3xl">
      <div className="flex items-center gap-2 mb-6">
        <a href="/dashboard/billing" className="text-sm text-gray-400 hover:text-gray-600">Facturación</a>
        <span className="text-gray-300">/</span>
        <a href="/dashboard/billing/invoices" className="text-sm text-gray-400 hover:text-gray-600">Documentos</a>
        <span className="text-gray-300">/</span>
        <span className="text-sm text-gray-600 font-medium">Emitir DTE</span>
      </div>

      <h1 className="text-2xl font-bold text-gray-900 mb-6">Emitir Documento Tributario</h1>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Sección proveedor y tipo */}
        <div className="bg-white rounded-2xl border border-gray-200 p-6">
          <h2 className="font-semibold text-gray-800 mb-4">Configuración del documento</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Tipo de documento *</label>
              <select value={form.dteType} onChange={(e) => setForm(f => ({ ...f, dteType: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white">
                {DTE_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Proveedor de facturación *</label>
              <select value={form.connectionId} onChange={(e) => setForm(f => ({ ...f, connectionId: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white">
                <option value="">— Selecciona una conexión —</option>
                {connections.map(c => (
                  <option key={c.id} value={c.id}>{c.name} ({c.provider})</option>
                ))}
              </select>
              {connections.length === 0 && (
                <p className="text-xs text-amber-600 mt-1">
                  <a href="/dashboard/billing" className="underline">Conecta un proveedor de facturación primero →</a>
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Datos del receptor */}
        <div className="bg-white rounded-2xl border border-gray-200 p-6">
          <h2 className="font-semibold text-gray-800 mb-4">Datos del receptor</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">RUT *</label>
              <input value={form.rut} onChange={(e) => setForm(f => ({ ...f, rut: e.target.value }))}
                placeholder="Ej: 12345678-9" required
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Razón Social *</label>
              <input value={form.razonSocial} onChange={(e) => setForm(f => ({ ...f, razonSocial: e.target.value }))}
                placeholder="Nombre o razón social" required
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Giro</label>
              <input value={form.giro} onChange={(e) => setForm(f => ({ ...f, giro: e.target.value }))}
                placeholder="Actividad económica"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Email</label>
              <input type="email" value={form.email} onChange={(e) => setForm(f => ({ ...f, email: e.target.value }))}
                placeholder="correo@receptor.cl"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Dirección</label>
              <input value={form.address} onChange={(e) => setForm(f => ({ ...f, address: e.target.value }))}
                placeholder="Av. Principal 123"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Comuna</label>
              <input value={form.commune} onChange={(e) => setForm(f => ({ ...f, commune: e.target.value }))}
                placeholder="Santiago"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
            </div>
          </div>
        </div>

        {/* Ítems */}
        <div className="bg-white rounded-2xl border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-gray-800">Ítems</h2>
            <button type="button" onClick={addItem}
              className="text-xs font-semibold text-blue-600 hover:text-blue-800">+ Agregar ítem</button>
          </div>

          <div className="space-y-3">
            <div className="grid grid-cols-12 gap-2 text-xs font-medium text-gray-500 pb-1 border-b border-gray-100">
              <span className="col-span-5">Descripción</span>
              <span className="col-span-2 text-center">Cantidad</span>
              <span className="col-span-2 text-right">Precio unit.</span>
              <span className="col-span-1 text-center">Dscto %</span>
              <span className="col-span-2 text-right">Total</span>
            </div>
            {items.map((item, idx) => (
              <div key={idx} className="grid grid-cols-12 gap-2 items-center">
                <div className="col-span-5">
                  <input value={item.name} onChange={(e) => updateItem(idx, 'name', e.target.value)}
                    placeholder="Descripción del ítem"
                    className="w-full px-2 py-1.5 border border-gray-300 rounded-lg text-sm" />
                </div>
                <div className="col-span-2">
                  <input type="number" min={1} value={item.quantity}
                    onChange={(e) => updateItem(idx, 'quantity', Number(e.target.value))}
                    className="w-full px-2 py-1.5 border border-gray-300 rounded-lg text-sm text-center" />
                </div>
                <div className="col-span-2">
                  <input type="number" min={0} value={item.unitPrice}
                    onChange={(e) => updateItem(idx, 'unitPrice', Number(e.target.value))}
                    className="w-full px-2 py-1.5 border border-gray-300 rounded-lg text-sm text-right" />
                </div>
                <div className="col-span-1">
                  <input type="number" min={0} max={100} value={item.discount}
                    onChange={(e) => updateItem(idx, 'discount', Number(e.target.value))}
                    className="w-full px-2 py-1.5 border border-gray-300 rounded-lg text-sm text-center" />
                </div>
                <div className="col-span-2 flex items-center justify-end gap-1">
                  <span className="text-sm font-medium text-gray-800">{fmt(itemTotals[idx])}</span>
                  {items.length > 1 && (
                    <button type="button" onClick={() => removeItem(idx)}
                      className="text-gray-300 hover:text-red-500 ml-1 text-lg leading-none">×</button>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Totales */}
          <div className="mt-6 border-t border-gray-100 pt-4 space-y-1.5">
            {isTaxed && (
              <>
                <div className="flex justify-between text-sm text-gray-600">
                  <span>Neto</span>
                  <span>{fmt(netAmount)}</span>
                </div>
                <div className="flex justify-between text-sm text-gray-600">
                  <span>IVA (19%)</span>
                  <span>{fmt(tax)}</span>
                </div>
              </>
            )}
            <div className="flex justify-between text-base font-bold text-gray-900 pt-1 border-t border-gray-200">
              <span>Total</span>
              <span>{fmt(totalAmount)}</span>
            </div>
          </div>
        </div>

        {/* Observaciones */}
        <div className="bg-white rounded-2xl border border-gray-200 p-6">
          <label className="block text-xs font-medium text-gray-600 mb-1">Observaciones (opcional)</label>
          <textarea value={form.notes} onChange={(e) => setForm(f => ({ ...f, notes: e.target.value }))}
            placeholder="Notas adicionales para el documento..."
            rows={2}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm resize-none" />
        </div>

        {error && (
          <div className="px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{error}</div>
        )}

        <div className="flex gap-3">
          <button type="submit" disabled={loading}
            className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold rounded-xl text-sm">
            {loading ? 'Emitiendo...' : `Emitir ${dteInfo?.label ?? 'DTE'}`}
          </button>
          <a href="/dashboard/billing/invoices"
            className="px-6 py-2.5 border border-gray-300 text-gray-600 rounded-xl text-sm hover:bg-gray-50 font-medium">
            Cancelar
          </a>
        </div>
      </form>
    </div>
  );
}
