"use client";

import { useEffect, useState, type ReactNode } from "react";

const LINE = "1px solid rgba(0,0,0,0.08)";

type Channel = { key: string; name: string; price: string };

// Cada canal con su propio precio, como se configura en el panel.
const CHANNELS: Channel[] = [
  { key: "mercadolibre", name: "Mercado Libre", price: "$49.990" },
  { key: "falabella", name: "Falabella", price: "$51.990" },
  { key: "paris", name: "Paris", price: "$51.990" },
  { key: "ripley", name: "Ripley", price: "$50.990" },
  { key: "walmart", name: "Walmart", price: "$49.990" },
  { key: "pos", name: "Tienda física", price: "$52.990" },
];

// Orden de las ventas de la animación (índice en CHANNELS). Las de dropshipping
// son de un producto del proveedor: se le envía el pedido y el stock propio no cambia.
const SALES: Array<{ ch: number; drop?: boolean }> = [
  { ch: 0 }, { ch: 1 }, { ch: 4, drop: true }, { ch: 0 }, { ch: 2 }, { ch: 5 }, { ch: 3, drop: true }, { ch: 4 },
];
const START = 24;
const OWN_SALES = SALES.filter((x) => !x.drop).length;

const ICON = {
  doc: "M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5M9 13h6M9 17h4",
  truck: "M3 16V7a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v9M16 10h3l2 3v3h-5M7.5 19.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Zm10 0a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z",
  box: "M21 8 12 3 3 8v8l9 5 9-5zM3 8l9 5 9-5M12 13v8",
  bag: "M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4ZM3 6h18M16 10a4 4 0 0 1-8 0",
};
const Svg = ({ d, size = 15 }: { d: string; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={d} />
  </svg>
);

/** Servicio que se activa con la venta (facturación o dropshipping), como círculo con nombre. */
function ServiceDot({ icon, label, tone, active, pulse }: { icon: string; label: string; tone: string; active: boolean; pulse: number }) {
  return (
    <span className="flex items-center gap-2">
      <span className="relative grid h-9 w-9 place-items-center">
        {active && <span key={pulse} className="absolute inset-0 animate-ping rounded-full opacity-40 motion-reduce:hidden" style={{ background: tone }} />}
        <span className={`relative grid h-9 w-9 place-items-center rounded-full transition-[box-shadow,transform,background-color,color] duration-300 ${active ? "scale-110 text-white" : "bg-white"}`}
          style={active ? { background: tone, boxShadow: `0 6px 16px ${tone}55` } : { color: tone, border: LINE }}>
          <Svg d={icon} />
        </span>
      </span>
      <span className={`text-[13px] font-medium transition-colors ${active ? "text-black" : "text-[#615d59]"}`}>{label}</span>
    </span>
  );
}
const STEP_MS = 2600;

function PosLogo() {
  return (
    <svg viewBox="0 0 64 40" className="h-full w-full" aria-hidden="true">
      <rect width="64" height="40" rx="8" fill="#02093a" />
      <path d="M20 14h24l-2 6H22zM22 20v8h20v-8M29 28v-4h6v4" stroke="#fff" strokeWidth="2" strokeLinejoin="round" fill="none" />
    </svg>
  );
}

// Canal como círculo con su logo: sin precios ni stock, solo el movimiento de la venta.
function ChannelDot({ logo, active, pulse }: { logo: ReactNode; active: boolean; pulse: number }) {
  return (
    <div className="relative grid h-14 w-14 place-items-center">
      {active && <span key={pulse} className="absolute inset-0 animate-ping rounded-full bg-[#0075de]/35 motion-reduce:hidden" />}
      <span className={`relative grid h-14 w-14 place-items-center rounded-full bg-white transition-[box-shadow,transform] duration-300 ${active ? "scale-110 shadow-[0_0_0_3px_#0075de,0_8px_20px_rgba(0,117,222,0.25)]" : "shadow-[0_2px_8px_rgba(0,0,0,0.08)]"}`}
        style={{ border: LINE }}>
        <span className="h-6 w-9 overflow-hidden rounded-[5px] [&>*]:h-full [&>*]:w-full [&>img]:object-contain">{logo}</span>
      </span>
      {/* Conector hacia el producto (cuando los canales van en columna al lado) */}
      <span className={`pointer-events-none absolute -left-5 top-1/2 hidden h-px w-5 xl:block ${active ? "bg-[#0075de]" : "bg-black/15"}`}>
        {/* Punto que viaja: del canal que vendió al producto, y del producto a los demás */}
        {pulse > 0 && (
          <span key={pulse} className={`absolute -top-[3px] h-[7px] w-[7px] rounded-full bg-[#0075de] ${active ? "lp-dot-in" : "lp-dot-out"}`} />
        )}
      </span>
    </div>
  );
}

/** Escena del inicio: una venta en cualquier canal descuenta el stock y lo publica en todos. */
export function HeroScene({ logos }: { logos: Record<string, ReactNode> }) {
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = window.setInterval(() => setStep((s) => (s + 1) % (SALES.length + 1)), STEP_MS);
    return () => window.clearInterval(id);
  }, []);

  // step 0: recién repuesto; step n: n ventas hechas (las de dropshipping no tocan el stock).
  const sale = step > 0 ? SALES[step - 1] : null;
  const stock = START - SALES.slice(0, step).filter((x) => !x.drop).length;
  const active = sale ? CHANNELS[sale.ch] : null;
  const drop = !!sale?.drop;
  const logoOf = (k: string) => (k === "pos" ? <PosLogo /> : logos[k]);

  return (
    <div className="relative overflow-hidden rounded-[12px] bg-[#ffb110] p-3 sm:p-5">
      <div className="lp-dotgrid absolute inset-0 opacity-50" style={{ WebkitMaskImage: "none", maskImage: "none" }} />
      <div className="relative grid gap-3 xl:grid-cols-[minmax(0,1fr)_56px] xl:items-center xl:gap-5">
          {/* Producto */}
          <div className="lp-shot rounded-[12px] bg-white p-4" style={{ border: LINE }}>
            <div className="flex items-center justify-between gap-2 text-[11px]">
              <span className="rounded-full bg-[#f6f5f4] px-2 py-0.5 font-medium text-[#615d59]">Bodega Centro</span>
              <span className="flex items-center gap-1.5 font-medium text-[#15803d]">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#15803d] opacity-60 motion-reduce:hidden" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-[#15803d]" />
                </span>
                Sincronizado
              </span>
            </div>
            <div className="relative mt-3 overflow-hidden rounded-[10px] bg-[#f6f5f4]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/landing/products/zapatillas-blancas-ancha.jpg" alt="" width={960} height={640}
                className="aspect-[2/1] w-full object-cover" fetchPriority="high" />
              {/* Aviso de venta flotando sobre la foto (siempre dentro del recuadro) */}
              {active && (
                <div key={`sale-${step}`} className="lp-slide absolute inset-x-2 top-2 sm:inset-x-auto sm:left-3 sm:top-3 sm:max-w-[85%]">
                  <div className="lp-float flex w-full items-center gap-2.5 rounded-[10px] bg-white/95 px-3 py-2 shadow-[0_6px_18px_rgba(0,0,0,0.18)]">
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#0075de1f] text-[#0075de]">
                      <Svg d={ICON.bag} />
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-[12px] font-semibold leading-tight">¡Nueva venta! · {active.name}</span>
                      <span className="block truncate text-[11px] leading-tight text-[#757575]">{drop ? "Mochila urbana 25 L · $34.990 · dropshipping" : `Zapatillas urbanas blancas · ${active.price}`}</span>
                    </span>
                  </div>
                </div>
              )}
            </div>
            {/* Nombre y stock en una sola fila */}
            <div className="mt-3 flex items-end justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-[15px] font-semibold leading-tight">Zapatillas urbanas blancas</p>
                <p className="mt-0.5 truncate text-[12px] text-[#757575]">SKU ZAP-URB-40 · stock en 6 canales</p>
              </div>
              <p key={stock} className="lp-pop shrink-0 text-[40px] font-semibold leading-none tracking-[-0.04em] tabular-nums">{stock}</p>
            </div>
            <div className="mt-3 min-h-[52px] rounded-[10px] bg-[#f6f5f4] p-2.5">
              {active && drop ? (
                <div key={step} className="lp-slide flex items-center gap-2.5">
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#7c3aed1f] text-[#7c3aed]">
                    <Svg d={ICON.truck} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12px] font-semibold leading-tight">Pedido enviado al proveedor · boleta N° {4520 + step}</span>
                    <span className="block truncate text-[11px] leading-tight text-[#757575]">Despacha directo a tu cliente · tu stock no cambia</span>
                  </span>
                </div>
              ) : active ? (
                <div key={step} className="lp-slide flex items-center gap-2.5">
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#15803d1f] text-[#15803d]">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5M9 13h6M9 17h4" />
                    </svg>
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12px] font-semibold leading-tight">Boleta N° {4520 + step} emitida</span>
                    <span className="block truncate text-[11px] leading-tight text-[#757575]">Venta en {active.name} · stock descontado en 6 canales</span>
                  </span>
                </div>
              ) : (
                <div key="restock" className="lp-slide flex items-center gap-2.5">
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#15803d1f] text-[#15803d]">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M21 8 12 3 3 8v8l9 5 9-5zM3 8l9 5 9-5M12 13v8" />
                    </svg>
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12px] font-semibold leading-tight">Reposición recibida · +{OWN_SALES}</span>
                    <span className="block truncate text-[11px] leading-tight text-[#757575]">Orden de compra N° 318 · Bodega Centro</span>
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Canales: en columna al lado del producto en pantallas anchas */}
          <div className="flex flex-wrap justify-center gap-3 py-1 xl:flex-col xl:gap-4">
            {CHANNELS.map((ch) => (
              <ChannelDot key={ch.key} logo={logoOf(ch.key)} active={active?.key === ch.key} pulse={active ? step : 0} />
            ))}
          </div>
      </div>
      {/* Facturación y dropshipping se activan con cada venta; a la derecha, el contador del día */}
      <div className="relative mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-[10px] bg-white/80 px-3 py-2">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <ServiceDot icon={ICON.doc} label="Facturación" tone="#15803d" active={!!active} pulse={step} />
          <ServiceDot icon={ICON.truck} label="Dropshipping" tone="#7c3aed" active={drop} pulse={step} />
        </div>
        <span className="text-[13px]">Hoy: <span key={`v-${step}`} className="lp-pop font-semibold tabular-nums">{30 + step}</span> ventas</span>
      </div>
    </div>
  );
}
