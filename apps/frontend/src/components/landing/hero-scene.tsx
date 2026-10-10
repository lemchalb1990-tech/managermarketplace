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

const STEP_MS = 2600;

function PosLogo() {
  return (
    <svg viewBox="0 0 64 40" className="h-full w-full" aria-hidden="true">
      <rect width="64" height="40" rx="8" fill="#02093a" />
      <path d="M20 14h24l-2 6H22zM22 20v8h20v-8M29 28v-4h6v4" stroke="#fff" strokeWidth="2" strokeLinejoin="round" fill="none" />
    </svg>
  );
}

// Canales y servicios flotando alrededor del producto: posición (% del área),
// tamaño en px y ritmo propio, para que no se muevan todos al mismo tiempo.
const ORBIT: Record<string, { x: number; y: number; size: number; dur: number; delay: number }> = {
  mercadolibre: { x: 9, y: 16, size: 62, dur: 3.4, delay: 0 },
  falabella: { x: 6, y: 47, size: 46, dur: 4.1, delay: 0.6 },
  paris: { x: 11, y: 76, size: 54, dur: 3.7, delay: 1.2 },
  ripley: { x: 91, y: 13, size: 50, dur: 3.9, delay: 0.3 },
  walmart: { x: 96, y: 44, size: 58, dur: 3.2, delay: 0.9 },
  pos: { x: 90, y: 72, size: 44, dur: 4.4, delay: 1.5 },
  dropshipping: { x: 84, y: 86, size: 44, dur: 3.6, delay: 0.4 },
};

function Floating({ k, children }: { k: string; children: ReactNode }) {
  const o = ORBIT[k];
  return (
    <span className="absolute z-20" style={{ left: `${o.x}%`, top: `${o.y}%`, width: o.size, height: o.size, marginLeft: -o.size / 2, marginTop: -o.size / 2 }}>
      <span className="lp-float block h-full w-full max-sm:scale-[0.8]" style={{ animationDuration: `${o.dur}s`, ["--fd" as string]: `${o.delay}s` }}>
        {children}
      </span>
    </span>
  );
}

// Canal como círculo con su logo: sin precios ni stock, solo el movimiento de la venta.
function ChannelDot({ logo, active, pulse }: { logo: ReactNode; active: boolean; pulse: number }) {
  return (
    <span className="relative grid h-full w-full place-items-center">
      {active && <span key={pulse} className="absolute inset-0 animate-ping rounded-full bg-[#0075de]/35 motion-reduce:hidden" />}
      <span className={`relative grid h-full w-full place-items-center rounded-full bg-white transition-[box-shadow,transform] duration-300 ${active ? "scale-110 shadow-[0_0_0_3px_#0075de,0_8px_20px_rgba(0,117,222,0.25)]" : "shadow-[0_4px_12px_rgba(0,0,0,0.1)]"}`}
        style={{ border: LINE }}>
        <span className="h-[42%] w-[62%] overflow-hidden rounded-[5px] [&>*]:h-full [&>*]:w-full [&>img]:object-contain">{logo}</span>
      </span>
    </span>
  );
}

/** Servicio que se activa con la venta (facturación o dropshipping): círculo con su nombre debajo. */
function ServiceDot({ icon, logo, label, tone, active, pulse }: {
  icon: string; logo?: ReactNode; label: string; tone: string; active: boolean; pulse: number;
}) {
  return (
    <span className="relative grid h-full w-full place-items-center">
      {active && <span key={pulse} className="absolute inset-0 animate-ping rounded-full opacity-40 motion-reduce:hidden" style={{ background: tone }} />}
      {logo ? (
        <span className={`relative grid h-full w-full place-items-center overflow-hidden rounded-full bg-white transition-[box-shadow,transform] duration-300 ${active ? "scale-110" : ""}`}
          style={{ boxShadow: active ? `0 0 0 3px ${tone}, 0 6px 16px ${tone}55` : "0 4px 12px rgba(0,0,0,0.1)", border: active ? undefined : LINE }}>
          <span className="h-[42%] w-[62%] overflow-hidden rounded-[4px] [&>*]:h-full [&>*]:w-full [&>img]:object-contain">{logo}</span>
        </span>
      ) : (
        <span className={`relative grid h-full w-full place-items-center rounded-full transition-[box-shadow,transform,background-color,color] duration-300 ${active ? "scale-110 text-white" : "bg-white"}`}
          style={active ? { background: tone, boxShadow: `0 6px 16px ${tone}55` } : { color: tone, border: LINE, boxShadow: "0 4px 12px rgba(0,0,0,0.1)" }}>
          <Svg d={icon} />
        </span>
      )}
      <span className={`absolute left-1/2 top-full mt-1 -translate-x-1/2 whitespace-nowrap rounded-full bg-white/90 px-2 py-0.5 text-[11px] font-medium transition-colors ${active ? "text-black" : "text-[#615d59]"}`}>
        {label}
      </span>
    </span>
  );
}

/** Escena del inicio: una venta en cualquier canal descuenta el stock y lo publica en todos. */
export function HeroScene({ logos, billingLogo }: { logos: Record<string, ReactNode>; billingLogo?: ReactNode }) {
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
      {/* Área con el producto al centro y los círculos alrededor */}
      <div className="relative px-[19%] pb-[84px] pt-6 sm:pb-[92px] sm:pt-8">
            {/* Producto */}
            <div className="lp-shot relative z-10 mx-auto w-full max-w-[300px] rounded-[12px] bg-white p-3" style={{ border: LINE }}>
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
              <div className="relative mt-2.5 overflow-hidden rounded-[10px] bg-[#f6f5f4]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/landing/products/zapatillas-blancas-ancha.jpg" alt="" width={960} height={640}
                  className="aspect-[2/1] w-full object-cover" fetchPriority="high" />
                {/* Aviso de venta flotando sobre la foto (siempre dentro del recuadro) */}
                {active && (
                  <div key={`sale-${step}`} className="lp-slide absolute inset-x-2 top-2 sm:inset-x-2 sm:top-2">
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
              <div className="mt-2.5 flex items-end justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-[14px] font-semibold leading-tight">Zapatillas urbanas blancas</p>
                  <p className="mt-0.5 truncate text-[11px] text-[#757575]">SKU ZAP-URB-40 · en 6 canales</p>
                </div>
                <p key={stock} className="lp-pop shrink-0 text-[32px] font-semibold leading-none tracking-[-0.04em] tabular-nums">{stock}</p>
              </div>
              <div className="mt-2.5 min-h-[48px] rounded-[10px] bg-[#f6f5f4] p-2">
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

        {/* Facturación justo debajo del producto: la boleta baja desde la misma venta */}
        <span className="absolute bottom-[26px] left-1/2 z-20 h-11 w-11 -translate-x-1/2 sm:bottom-[30px] sm:h-12 sm:w-12">
          <span className={`pointer-events-none absolute bottom-full left-1/2 h-[14px] w-px -translate-x-1/2 ${active ? "bg-[#15803d]" : "bg-black/20"}`}>
            {active && <span key={step} className="lp-dot-down absolute -left-[3px] h-[7px] w-[7px] rounded-full bg-[#15803d]" />}
          </span>
          <ServiceDot icon={ICON.doc} logo={billingLogo} label="Facturación" tone="#15803d" active={!!active} pulse={step} />
        </span>

        {CHANNELS.map((ch) => (
          <Floating key={ch.key} k={ch.key}>
            <ChannelDot logo={logoOf(ch.key)} active={active?.key === ch.key} pulse={active ? step : 0} />
          </Floating>
        ))}
        <Floating k="dropshipping">
          <ServiceDot icon={ICON.truck} label="Dropshipping" tone="#7c3aed" active={drop} pulse={step} />
        </Floating>
      </div>

      {/* Contador del día */}
      <div className="relative flex flex-wrap items-center justify-between gap-2 rounded-[10px] bg-white/80 px-4 py-2 text-[13px]">
        <span>Hoy: <span key={`v-${step}`} className="lp-pop font-semibold tabular-nums">{30 + step}</span> ventas</span>
        <span className="text-[#615d59]"><span className="font-semibold text-black">0</span> quiebres de stock</span>
      </div>
    </div>
  );
}
