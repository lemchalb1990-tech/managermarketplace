'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';

/**
 * Disponibilidad de stock en Mercado Libre (sale_term MANUFACTURING_TIME): "Disponible N días
 * después de la compra". Solo se puede usar si la categoría lo acepta; si no, la ficha avisa que
 * el producto se publica con entrega inmediata.
 */
export default function MlAvailabilityField({ categoryId, connectionId, value, onChange }: {
  categoryId: string;
  connectionId?: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const [state, setState] = useState<'idle' | 'loading' | 'yes' | 'no' | 'error'>('idle');

  useEffect(() => {
    if (!categoryId || !connectionId) return;
    let alive = true;
    const id = requestAnimationFrame(() => {
      setState('loading');
      api.marketplace.getSaleTerms(connectionId, categoryId, getToken()!)
        .then((terms) => { if (alive) setState(terms.some((t) => t.id === 'MANUFACTURING_TIME') ? 'yes' : 'no'); })
        .catch(() => { if (alive) setState('error'); });
    });
    return () => { alive = false; cancelAnimationFrame(id); };
  }, [categoryId, connectionId]);

  if (!categoryId) return null;
  const days = Number(value) || 0;

  return (
    <div className="sm:col-span-2">
      <label className="block text-xs font-medium text-gray-600 mb-1">Disponibilidad de stock (tiempo de pedido)</label>
      {!connectionId ? (
        <p className="text-xs text-gray-400">Conecta una cuenta de Mercado Libre para saber si esta categoría acepta plazo de disponibilidad.</p>
      ) : state === 'loading' || state === 'idle' ? (
        <p className="text-xs text-gray-400">Consultando a Mercado Libre si la categoría acepta plazo…</p>
      ) : state === 'error' ? (
        <p className="text-xs text-amber-700">No se pudo consultar la categoría. Se publicará con entrega inmediata hasta poder confirmarlo.</p>
      ) : state === 'no' ? (
        <p className="rounded-lg bg-gray-50 border border-gray-200 px-3 py-2 text-xs text-gray-600">
          <strong>Entrega inmediata.</strong> Esta categoría de Mercado Libre no permite plazo de disponibilidad, así que el producto se publica con entrega inmediata.
        </p>
      ) : (
        <>
          <div className="flex items-center gap-2">
            <input type="number" min={0} step={1} value={value} onChange={(e) => onChange(e.target.value)}
              placeholder="0" className="w-24 px-3 py-2 border border-gray-300 rounded-lg text-sm" />
            <span className="text-sm text-gray-600">días</span>
          </div>
          <p className="mt-1 text-xs text-gray-400">
            {days > 0
              ? <>Se publica como <strong className="text-gray-600">&quot;Disponible {days} días después de tu compra&quot;</strong>. Mercado Libre valida el máximo de la categoría.</>
              : <>Sin plazo: se publica con <strong className="text-gray-600">entrega inmediata</strong>.</>}
          </p>
        </>
      )}
    </div>
  );
}
