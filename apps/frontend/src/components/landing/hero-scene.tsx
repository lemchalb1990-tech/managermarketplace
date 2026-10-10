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

// Orden de las ventas de la animación (índices de CHANNELS) y stock inicial.
const SALES = [0, 1, 0, 2, 5, 3, 4];
const START = 24;
const STEP_MS = 2600;

function PosLogo() {
  return (
    <svg viewBox="0 0 64 40" className="h-full w-full" aria-hidden="true">
      <rect width="64" height="40" rx="8" fill="#02093a" />
      <path d="M20 14h24l-2 6H22zM22 20v8h20v-8M29 28v-4h6v4" stroke="#fff" strokeWidth="2" strokeLinejoin="round" fill="none" />
    </svg>
  );
}

function ChannelCard({ ch, logo, stock, active, pulse }: {
  ch: Channel; logo: ReactNode; stock: number; active: boolean; pulse: number;
}) {
  return (
    <div className={`relative flex items-center gap-2 rounded-[10px] bg-white px-2 py-1.5 transition-[box-shadow,transform] duration-300 ${active ? "-translate-y-0.5 shadow-[0_0_0_2px_#0075de,0_8px_20px_rgba(0,117,222,0.18)]" : "shadow-[0_2px_8px_rgba(0,0,0,0.06)]"}`}
      style={{ border: LINE }}>
      <span className="h-7 w-10 shrink-0 overflow-hidden rounded-[6px] [&>*]:h-full [&>*]:w-full">{logo}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[12px] font-semibold leading-tight">{ch.name}</span>
        <span className="block text-[11px] leading-tight text-[#757575]">{ch.price}</span>
      </span>
      <span className="text-right">
        <span key={stock} className="lp-pop block font-mono text-[14px] font-semibold leading-tight tabular-nums">{stock}</span>
        <span className="block text-[10px] leading-tight text-[#757575]">stock</span>
      </span>
      {active && (
        <span className="lp-pop absolute -top-2.5 right-2 rounded-full bg-[#0075de] px-2 py-0.5 text-[10px] font-semibold text-white">
          Vendido −1
        </span>
      )}
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

  // step 0: recién repuesto; step n: n ventas hechas.
  const stock = START - step;
  const activeIdx = step > 0 ? SALES[step - 1] : -1;
  const active = activeIdx >= 0 ? CHANNELS[activeIdx] : null;
  const logoOf = (k: string) => (k === "pos" ? <PosLogo /> : logos[k]);

  return (
    <div className="relative overflow-hidden rounded-[12px] bg-[#ffb110] p-3 sm:p-6">
      <div className="lp-dotgrid absolute inset-0 opacity-50" style={{ WebkitMaskImage: "none", maskImage: "none" }} />
      <div className="relative grid gap-3 xl:grid-cols-[minmax(0,1fr)_188px] xl:items-center xl:gap-5">
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
                className="aspect-[16/10] w-full object-cover" fetchPriority="high" />
              {/* Aviso de venta flotando sobre la foto (siempre dentro del recuadro) */}
              {active && (
                <div key={`sale-${step}`} className="lp-slide absolute inset-x-2 top-2 sm:inset-x-auto sm:left-3 sm:top-3 sm:max-w-[85%]">
                  <div className="lp-float flex w-full items-center gap-2.5 rounded-[10px] bg-white/95 px-3 py-2 shadow-[0_6px_18px_rgba(0,0,0,0.18)]">
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#0075de1f] text-[#0075de]">
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4ZM3 6h18M16 10a4 4 0 0 1-8 0" />
                      </svg>
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-[12px] font-semibold leading-tight">¡Nueva venta! · {active.name}</span>
                      <span className="block truncate text-[11px] leading-tight text-[#757575]">Zapatillas urbanas blancas · {active.price}</span>
                    </span>
                  </div>
                </div>
              )}
            </div>
            <div className="mt-3 min-w-0">
              <p className="truncate text-[15px] font-semibold leading-tight">Zapatillas urbanas blancas</p>
              <p className="mt-0.5 text-[12px] text-[#757575]">SKU ZAP-URB-40 · Talla 40</p>
            </div>
            <div className="mt-4 flex items-end justify-between gap-3">
              <div>
                <p className="text-[12px] text-[#757575]">Stock en todos los canales</p>
                <p key={stock} className="lp-pop text-[48px] font-semibold leading-none tracking-[-0.04em] tabular-nums">{stock}</p>
              </div>
              <div className="pb-1 text-right text-[11px] leading-snug text-[#615d59]">
                <p><span className="font-semibold text-black">6</span> canales</p>
                <p>actualizados solos</p>
              </div>
            </div>
            <div className="mt-4 min-h-[52px] rounded-[10px] bg-[#f6f5f4] p-2.5">
              {active ? (
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
                    <span className="block truncate text-[12px] font-semibold leading-tight">Reposición recibida · +{SALES.length}</span>
                    <span className="block truncate text-[11px] leading-tight text-[#757575]">Orden de compra N° 318 · Bodega Centro</span>
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Canales: en columna al lado del producto en pantallas anchas */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-1">
            {CHANNELS.map((ch) => (
              <ChannelCard key={ch.key} ch={ch} logo={logoOf(ch.key)} stock={stock} active={active?.key === ch.key} pulse={active ? step : 0} />
            ))}
          </div>
      </div>
      {/* Contador del día */}
      <div className="relative mt-3 flex flex-wrap items-center justify-between gap-2 rounded-[10px] bg-white/80 px-4 py-2.5 text-[13px]">
        <span>Hoy: <span key={`v-${step}`} className="lp-pop font-semibold tabular-nums">{30 + step}</span> ventas</span>
        <span className="text-[#615d59]"><span className="font-semibold text-black">0</span> quiebres de stock</span>
      </div>
    </div>
  );
}
