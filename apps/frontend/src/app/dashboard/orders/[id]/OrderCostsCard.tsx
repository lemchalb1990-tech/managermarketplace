'use client';

// Costos de la venta de una orden: precio de cada producto, comisión del marketplace por
// producto (tal como la informa el canal), envío, impuestos, descuentos, neto recibido, IVA,
// costo de los productos y ganancia. Mercado Libre informa sus montos CON IVA: el neto recibido
// (lo que deposita) incluye el 19% de IVA, que se separa para llegar al neto sin IVA. Walmart,
// Ripley, Paris, Falabella y JumpSeller ya se importan SIN IVA (ver sale-breakdown.ts).
// Todo lo que se compara con el costo queda SIN IVA (Product.cost viene con IVA).

const NET_SIN_IVA_CHANNELS = new Set(['WALMART', 'RIPLEY', 'PARIS', 'FALABELLA', 'JUMPSELLER']);
const IVA_RATE = 0.19;

const fmt = (n: number) => `${n < 0 ? '-' : ''}$${Math.round(Math.abs(n)).toLocaleString('es-CL')}`;

function Row({ label, value, tone = 'normal', hint }: {
  label: string; value: string; tone?: 'normal' | 'minus' | 'plus' | 'strong' | 'muted'; hint?: string;
}) {
  const cls = tone === 'minus' ? 'text-red-600'
    : tone === 'plus' ? 'text-green-600'
      : tone === 'strong' ? 'text-gray-900 font-semibold'
        : tone === 'muted' ? 'text-gray-400' : 'text-gray-700';
  return (
    <div className="flex items-baseline justify-between gap-3 text-xs">
      <span className="text-gray-500 min-w-0" title={hint}>{label}</span>
      <span className={`shrink-0 tabular-nums ${cls}`}>{value}</span>
    </div>
  );
}

export default function OrderCostsCard({ sale, channelLabel }: { sale: any; channelLabel: string }) {
  const items: any[] = sale.items || [];
  const sinIva = NET_SIN_IVA_CHANNELS.has(sale.channel);
  const num = (v: any) => (v == null ? null : Number(v));

  const total = num(sale.total) ?? 0;
  const fee = num(sale.marketplaceFee);
  const shipping = num(sale.shippingCost);
  const taxes = num(sale.taxes);
  const discount = num(sale.discount);
  const net = num(sale.netAmount);

  // Neto sin IVA: en los canales que informan con IVA, se separa el 19% incluido en lo recibido.
  const netIva = net != null && !sinIva ? net - net / (1 + IVA_RATE) : null;
  const netSinIva = net != null ? (sinIva ? net : net - (netIva ?? 0)) : null;

  // Costo de cada línea SIN IVA: costo real por lotes (totalCost) o el costo del catálogo;
  // ambos vienen con IVA.
  const lineCost = (it: any): number | null => {
    if (it.totalCost != null) return Number(it.totalCost) / (1 + IVA_RATE);
    const c = Number(it.product?.cost ?? 0);
    if (!(c > 0)) return null;
    return (c / (1 + IVA_RATE)) * it.quantity;
  };
  const costs = items.map(lineCost);
  const allCosts = items.length > 0 && costs.every((c) => c != null);
  const productCost = allCosts ? costs.reduce((s: number, c) => s + (c ?? 0), 0) : null;
  const profit = netSinIva != null && productCost != null ? netSinIva - productCost : null;
  const hasCharges = fee != null || shipping != null || taxes != null || discount != null || net != null;

  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-4 sm:p-5">
      <div className="flex items-start justify-between gap-2 mb-3">
        <h2 className="font-semibold text-gray-800 text-sm">Costos de la venta</h2>
        <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">
          {sinIva ? 'montos sin IVA' : 'montos con IVA · ganancia sin IVA'}
        </span>
      </div>

      {/* Por producto */}
      {items.length > 0 && (
        <ul className="space-y-2 mb-3">
          {items.map((it, idx) => {
            const gross = Number(it.unitPrice) * it.quantity;
            const itemFee = num(it.marketplaceFee);
            const c = costs[idx];
            return (
              <li key={it.id} className="rounded-lg bg-gray-50 px-3 py-2">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-xs font-medium text-gray-800 line-clamp-2 min-w-0" title={it.product?.name}>
                    {it.product?.name || 'Producto'} <span className="text-gray-400 font-normal">× {it.quantity}</span>
                  </p>
                  <span className="shrink-0 text-xs font-semibold text-gray-800 tabular-nums">{fmt(gross)}</span>
                </div>
                <div className="mt-1 grid grid-cols-1 min-[380px]:grid-cols-2 gap-x-4 gap-y-0.5 text-[11px]">
                  <span className="flex justify-between gap-2">
                    <span className="text-gray-500">Precio unitario</span>
                    <span className="tabular-nums text-gray-700">{fmt(Number(it.unitPrice))}</span>
                  </span>
                  {itemFee != null && (
                    <span className="flex justify-between gap-2"
                      title={gross > 0 ? `Equivale al ${((itemFee / gross) * 100).toFixed(1)}% del precio` : undefined}>
                      <span className="text-gray-500">Comisión {channelLabel}</span>
                      <span className="tabular-nums text-red-600">-{fmt(itemFee)}</span>
                    </span>
                  )}
                  <span className="flex justify-between gap-2">
                    <span className="text-gray-500">Costo producto s/IVA</span>
                    <span className={`tabular-nums ${c != null ? 'text-gray-700' : 'text-gray-300'}`}>{c != null ? `-${fmt(c)}` : 'sin costo'}</span>
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {/* Totales */}
      <div className="space-y-1 border-t border-gray-100 pt-3">
        <Row label="Total de la venta" value={fmt(total)} tone="strong" />
        {fee != null && <Row label={`Comisión ${channelLabel}`} value={`-${fmt(fee)}`} tone="minus" />}
        {shipping != null && (
          <Row
            label={shipping < 0 ? 'Envío (bonificado)' : 'Envío a cargo del vendedor'}
            value={shipping > 0 ? `-${fmt(shipping)}` : shipping < 0 ? `+${fmt(Math.abs(shipping))}` : fmt(0)}
            tone={shipping > 0 ? 'minus' : shipping < 0 ? 'plus' : 'muted'}
            hint={sale.shippingMethod ? `Envío: ${sale.shippingMethod}` : undefined}
          />
        )}
        {taxes != null && taxes !== 0 && (
          <Row label={sinIva ? 'IVA incluido en el total (va al fisco)' : 'Impuestos'} value={fmt(taxes)} tone="muted" />
        )}
        {discount != null && discount !== 0 && <Row label="Descuento / cupón" value={`-${fmt(discount)}`} tone="minus" />}
        {net != null && (
          <div className="pt-1 mt-1 border-t border-dashed border-gray-200 space-y-1">
            {sinIva ? (
              <Row label="Neto recibido sin IVA" value={fmt(net)} tone="strong" />
            ) : (
              <>
                <Row label="Neto recibido (con IVA)" value={fmt(net)} tone="strong"
                  hint={`Lo que deposita ${channelLabel}: total menos comisión y envío`} />
                <Row label="IVA incluido (19%)" value={`-${fmt(netIva ?? 0)}`} tone="minus"
                  hint="IVA contenido en el neto recibido: neto − neto ÷ 1,19" />
                <Row label="Neto sin IVA" value={fmt(netSinIva ?? 0)} tone="strong" />
              </>
            )}
          </div>
        )}
        {productCost != null && <Row label="Costo de productos sin IVA" value={`-${fmt(productCost)}`} tone="minus" />}
        {profit != null && (
          <div className={`flex items-baseline justify-between gap-3 rounded-lg px-2 py-1.5 mt-1 text-xs font-semibold ${profit < 0 ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700'}`}>
            <span>Ganancia sin IVA</span>
            <span className="tabular-nums">{fmt(profit)}</span>
          </div>
        )}
        {!hasCharges && (
          <p className="text-[11px] text-gray-400">Esta venta no tiene cargos del marketplace registrados.</p>
        )}
        {net != null && productCost == null && items.length > 0 && (
          <p className="text-[11px] text-gray-400">Carga el costo de los productos en el catálogo para ver la ganancia.</p>
        )}
      </div>
    </div>
  );
}
