'use client';

import { useCallback, useEffect, useState } from 'react';
import { getToken } from '@/lib/auth';
import { api } from '@/lib/api';
import { Modal, FormError, btnPrimary, btnSecondary } from '@/components/ui/Modal';
import { fmtQty, type InventoryContext } from './shared';

type Mismatch = { id: string; sku: string; name: string; total: number; warehousesSum: number; difference: number };

// Productos cuyo stock total (lo que se publica en los canales) no coincide con la suma de
// sus bodegas. Corregir lleva las bodegas al total y deja el ajuste en el historial.
export function ReconciliationTab({ ctx }: { ctx: InventoryContext }) {
  const [rows, setRows] = useState<Mismatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState<{ ids?: string[]; label: string } | null>(null);
  const [fixing, setFixing] = useState(false);
  const [done, setDone] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try { setRows(await api.inventory.reconciliation(getToken()!, ctx.companyId)); }
    catch (err: any) { setError(err.message || 'No se pudo revisar la cuadratura'); }
    finally { setLoading(false); }
  }, [ctx.companyId]);

  useEffect(() => { load(); }, [load]);

  async function fix(e: React.FormEvent) {
    e.preventDefault();
    if (!confirm) return;
    setFixing(true);
    setError('');
    try {
      const res = await api.inventory.reconcile({ companyId: ctx.companyId, productIds: confirm.ids }, getToken()!);
      setDone(`${res.fixed} producto(s) cuadrado(s). Los ajustes quedaron en el historial.`);
      setConfirm(null);
      await load();
    } catch (err: any) {
      setError(err.message || 'No se pudo cuadrar');
    } finally {
      setFixing(false);
    }
  }

  return (
    <div className="max-w-4xl">
      <div className="mb-4 flex flex-wrap items-start gap-3">
        <p className="text-sm text-gray-600 max-w-2xl">
          El <b>stock total</b> es lo que se publica en tus canales; el <b>stock por bodega</b> dice dónde está.
          Si no suman lo mismo (por ejemplo, por cambios hechos antes de llevar inventario por bodega),
          cuadrar ajusta las bodegas al total: lo que falta entra a la bodega del producto y lo que sobra sale de las bodegas con más stock.
        </p>
        {rows.length > 0 && (
          <button onClick={() => setConfirm({ label: `los ${rows.length} producto(s)` })} className={`${btnPrimary} ml-auto`}>Cuadrar todo</button>
        )}
      </div>

      {done && <div className="mb-3 px-4 py-2 bg-green-50 border border-green-200 rounded-lg text-sm text-green-800">{done}</div>}
      {error && <div className="mb-3 px-4 py-2 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{error}</div>}

      <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
        {loading ? (
          <div className="px-4 py-10 text-center text-gray-400 text-sm">Revisando...</div>
        ) : rows.length === 0 ? (
          <div className="px-4 py-12 text-center text-gray-400">
            <p className="text-sm font-medium text-green-700 mb-1">Todo cuadra</p>
            <p className="text-xs">El stock total de cada producto coincide con la suma de sus bodegas.</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200 text-xs">
              <tr>
                <th className="text-left px-4 py-2.5 text-gray-600 font-medium">Producto</th>
                <th className="text-right px-3 py-2.5 text-gray-600 font-medium">Stock total</th>
                <th className="text-right px-3 py-2.5 text-gray-600 font-medium">Suma de bodegas</th>
                <th className="text-right px-3 py-2.5 text-gray-600 font-medium">Diferencia</th>
                <th className="px-3 py-2.5"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((r) => (
                <tr key={r.id} className="hover:bg-gray-50">
                  <td className="px-4 py-2.5">
                    <p className="text-gray-900">{r.name}</p>
                    <p className="text-[11px] text-gray-400">{r.sku}</p>
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono tabular-nums">{fmtQty(r.total)}</td>
                  <td className="px-3 py-2.5 text-right font-mono tabular-nums">{fmtQty(r.warehousesSum)}</td>
                  <td className={`px-3 py-2.5 text-right font-mono tabular-nums font-semibold ${r.difference > 0 ? 'text-emerald-700' : 'text-red-600'}`}>
                    {r.difference > 0 ? '+' : ''}{r.difference}
                  </td>
                  <td className="px-3 py-2.5 text-right whitespace-nowrap text-xs font-medium">
                    <button onClick={() => ctx.goTo('historial', { productId: r.id })} className="text-blue-600 hover:text-blue-800 mr-3">Historial</button>
                    <button onClick={() => setConfirm({ ids: [r.id], label: `"${r.name}"` })} className="text-gray-700 hover:text-gray-900">Cuadrar</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {confirm && (
        <Modal title="Cuadrar stock por bodega" size="sm" onClose={() => setConfirm(null)} onSubmit={fix} busy={fixing}
          footer={<>
            <button type="button" onClick={() => setConfirm(null)} disabled={fixing} className={btnSecondary}>Cancelar</button>
            <button type="submit" disabled={fixing} className={btnPrimary}>{fixing ? 'Cuadrando...' : 'Cuadrar'}</button>
          </>}>
          <div className="space-y-3 text-sm text-gray-600">
            <p>Se ajustarán las bodegas de {confirm.label} para que sumen su stock total. El stock publicado en los canales no cambia.</p>
            <p className="text-xs text-gray-500">Cada corrección queda como movimiento de ajuste en el historial.</p>
            <FormError message={error} />
          </div>
        </Modal>
      )}
    </div>
  );
}
