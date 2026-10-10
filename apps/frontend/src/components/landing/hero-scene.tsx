"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

const LINE = "1px solid rgba(0,0,0,0.08)";
const BLUE = "#0075de";
const GREEN = "#15803d";
const PURPLE = "#7c3aed";

type Channel = { key: string; name: string };

const CHANNELS: Channel[] = [
  { key: "mercadolibre", name: "Mercado Libre" },
  { key: "falabella", name: "Falabella" },
  { key: "paris", name: "Paris" },
  { key: "ripley", name: "Ripley" },
  { key: "walmart", name: "Walmart" },
  { key: "pos", name: "Tienda física" },
  { key: "shopify", name: "Shopify" },
  { key: "direct", name: "Venta directa" },
];

// Productos que van rotando en la tarjeta. El de dropshipping es del proveedor:
// se le envía el pedido y no tiene stock propio.
type Product = { name: string; img: string; sku: string; price: string; start: number; drop?: boolean };
const PRODUCTS: Product[] = [
  { name: "Zapatillas urbanas blancas", img: "/landing/products/zapatillas-blancas-ancha.jpg", sku: "ZAP-URB-40", price: "$49.990", start: 24 },
  { name: "Polera oversize negra", img: "/landing/products/polera-negra.jpg", sku: "POL-OVS-M", price: "$12.990", start: 58 },
  { name: "Mochila urbana 25 L", img: "/landing/products/mochila-urbana.jpg", sku: "MOC-URB-25", price: "$34.990", start: 0, drop: true },
  { name: "Jockey blanco", img: "/landing/products/jockey-blanco.jpg", sku: "JOC-BLA-U", price: "$8.990", start: 40 },
  { name: "Polerón blanco", img: "/landing/products/poleron-blanco.jpg", sku: "POL-BLA-L", price: "$24.990", start: 31 },
];

// Secuencia de ventas: canal (índice en CHANNELS) y producto (índice en PRODUCTS).
const SALES: Array<{ ch: number; p: number }> = [
  { ch: 0, p: 0 }, { ch: 1, p: 1 }, { ch: 4, p: 2 }, { ch: 0, p: 3 },
  { ch: 6, p: 0 }, { ch: 7, p: 4 }, { ch: 3, p: 2 }, { ch: 2, p: 1 }, { ch: 5, p: 3 },
];
const STEP_MS = 2600;

const ICON = {
  doc: "M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5M9 13h6M9 17h4",
  truck: "M3 16V7a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v9M16 10h3l2 3v3h-5M7.5 19.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Zm10 0a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z",
  box: "M21 8 12 3 3 8v8l9 5 9-5zM3 8l9 5 9-5M12 13v8",
  cash: "M2 6h20v12H2zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 10v4M18 10v4",
  bag: "M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4ZM3 6h18M16 10a4 4 0 0 1-8 0",
};
const Svg = ({ d, size = 15 }: { d: string; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={d} />
  </svg>
);

function PosLogo() {
  return (
    <svg viewBox="0 0 64 40" className="h-full w-full" aria-hidden="true">
      <rect width="64" height="40" rx="8" fill="#02093a" />
      <path d="M20 14h24l-2 6H22zM22 20v8h20v-8M29 28v-4h6v4" stroke="#fff" strokeWidth="2" strokeLinejoin="round" fill="none" />
    </svg>
  );
}

// Canales y dropshipping flotando alrededor del producto: posición (% del área),
// tamaño en px y ritmo propio, para que no se muevan todos al mismo tiempo.
// "ty" fija la posición vertical en px desde arriba (para el círculo que va sobre el producto).
const ORBIT: Record<string, { x: number; y: number; ty?: number; size: number; dur: number; delay: number }> = {
  direct: { x: 50, y: 0, ty: 6, size: 68, dur: 3.5, delay: 0.7 },
  mercadolibre: { x: 10, y: 15, size: 94, dur: 3.4, delay: 0 },
  falabella: { x: 8, y: 47, size: 70, dur: 4.1, delay: 0.6 },
  paris: { x: 11, y: 76, size: 82, dur: 3.7, delay: 1.2 },
  ripley: { x: 90, y: 13, size: 78, dur: 3.9, delay: 0.3 },
  walmart: { x: 91, y: 44, size: 88, dur: 3.2, delay: 0.9 },
  pos: { x: 89, y: 70, size: 68, dur: 4.4, delay: 1.5 },
  shopify: { x: 19, y: 90, size: 74, dur: 3.8, delay: 1.1 },
  dropshipping: { x: 81, y: 89, size: 64, dur: 3.6, delay: 0.4 },
};

function Floating({ k, children }: { k: string; children: ReactNode }) {
  const o = ORBIT[k];
  return (
    <span className="absolute z-20" style={{ left: `${o.x}%`, top: o.ty != null ? o.ty : `${o.y}%`, width: o.size, height: o.size, marginLeft: -o.size / 2, marginTop: o.ty != null ? 0 : -o.size / 2 }}>
      <span className="lp-float block h-full w-full max-sm:scale-[0.62]" style={{ animationDuration: `${o.dur}s`, ["--fd" as string]: `${o.delay}s` }}>
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
          <Svg d={icon} size={20} />
        </span>
      )}
      <span className={`absolute left-1/2 top-full mt-1 -translate-x-1/2 whitespace-nowrap rounded-full bg-white/90 px-2 py-0.5 text-[11px] font-medium transition-colors ${active ? "text-black" : "text-[#615d59]"}`}>
        {label}
      </span>
    </span>
  );
}

/** Punto que recorre una conexión (de un círculo al producto o al revés). */
function Traveler({ from, to, tone, delay = 0 }: { from: [number, number]; to: [number, number]; tone: string; delay?: number }) {
  return (
    <span className="lp-travel pointer-events-none absolute left-0 top-0 z-10 h-2 w-2 -translate-x-1 -translate-y-1 rounded-full"
      style={{ background: tone, boxShadow: `0 0 0 3px ${tone}33`, offsetPath: `path('M${from[0]} ${from[1]} L${to[0]} ${to[1]}')`, animationDelay: `${delay}s` }} />
  );
}

/** Escena del inicio: una venta en cualquier canal descuenta el stock y lo publica en todos. */
export function HeroScene({ logos, billingLogo }: { logos: Record<string, ReactNode>; billingLogo?: ReactNode }) {
  const [step, setStep] = useState(0);
  const areaRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  // Medidas reales del área y del producto, para dibujar las conexiones en píxeles.
  const [geo, setGeo] = useState<{ w: number; h: number; cx: number; cy: number } | null>(null);

  useEffect(() => {
    if (typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = window.setInterval(() => setStep((s) => (s + 1) % (SALES.length + 1)), STEP_MS);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    const area = areaRef.current;
    const card = cardRef.current;
    if (!area || !card) return;
    const ro = new ResizeObserver(() => setGeo({
      w: area.clientWidth, h: area.clientHeight,
      cx: card.offsetLeft + card.offsetWidth / 2, cy: card.offsetTop + card.offsetHeight / 2,
    }));
    ro.observe(area);
    ro.observe(card);
    return () => ro.disconnect();
  }, []);

  // step 0: recién repuesto; step n: n ventas hechas.
  const sale = step > 0 ? SALES[step - 1] : null;
  const active = sale ? CHANNELS[sale.ch] : null;
  const product = PRODUCTS[sale ? sale.p : 0];
  const drop = !!product.drop && !!sale;
  const stock = product.start - SALES.slice(0, step).filter((x) => x.p === (sale ? sale.p : 0)).length;
  const logoOf = (k: string) => (k === "pos" ? <PosLogo /> : logos[k]);

  const at = (k: string): [number, number] => {
    const o = ORBIT[k];
    if (!geo) return [0, 0];
    return [(o.x / 100) * geo.w, o.ty != null ? o.ty + o.size / 2 : (o.y / 100) * geo.h];
  };
  const center: [number, number] = geo ? [geo.cx, geo.cy] : [0, 0];
  const nodes = [...CHANNELS.map((c) => c.key), "dropshipping"];

  return (
    <div className="relative overflow-hidden rounded-[12px] bg-[#ffb110] p-3 sm:p-5">
      <div className="lp-dotgrid absolute inset-0 opacity-50" style={{ WebkitMaskImage: "none", maskImage: "none" }} />
      {/* Área con el producto al centro y los círculos alrededor */}
      <div ref={areaRef} className="relative px-[21%] pb-[104px] pt-[92px] sm:pb-[112px] sm:pt-[104px]">
        {/* Conexiones de cada círculo con el producto */}
        {geo && (
          <svg className="pointer-events-none absolute inset-0 z-0 h-full w-full" viewBox={`0 0 ${geo.w} ${geo.h}`} aria-hidden="true">
            {nodes.map((k) => {
              const [x, y] = at(k);
              const on = k === "dropshipping" ? drop : active?.key === k;
              const tone = k === "dropshipping" ? PURPLE : BLUE;
              return (
                <line key={k} x1={x} y1={y} x2={center[0]} y2={center[1]}
                  stroke={on ? tone : "rgba(2,9,58,0.22)"} strokeWidth={on ? 2.5 : 1.5} strokeDasharray={on ? undefined : "4 5"}
                  className="transition-[stroke] duration-300" />
              );
            })}
          </svg>
        )}

        {/* Puntos que viajan: del canal que vendió al producto; luego al resto (stock) o al proveedor (dropshipping) */}
        {geo && active && (
          <span key={step} aria-hidden="true">
            <Traveler from={at(active.key)} to={center} tone={BLUE} />
            {drop
              ? <Traveler from={center} to={at("dropshipping")} tone={PURPLE} delay={0.6} />
              : CHANNELS.filter((c) => c.key !== active.key).map((c) => (
                <Traveler key={c.key} from={center} to={at(c.key)} tone={BLUE} delay={0.6} />
              ))}
          </span>
        )}

        {/* Producto (va cambiando con cada venta) */}
        <div ref={cardRef} className="lp-shot relative z-10 mx-auto w-full max-w-[300px] rounded-[12px] bg-white p-3" style={{ border: LINE }}>
          <div className="flex items-center justify-between gap-2 text-[11px]">
            <span className="rounded-full bg-[#f6f5f4] px-2 py-0.5 font-medium text-[#615d59]">{drop ? "Proveedor" : "Bodega Centro"}</span>
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
            <img key={product.img} src={product.img} alt="" width={960} height={480}
              className="lp-fade aspect-[2/1] w-full object-cover" />
            {/* Aviso de venta flotando sobre la foto (siempre dentro del recuadro) */}
            {active && (
              <div key={`sale-${step}`} className="lp-slide absolute inset-x-2 top-2">
                <div className="lp-float flex w-full items-center gap-2.5 rounded-[10px] bg-white/95 px-3 py-2 shadow-[0_6px_18px_rgba(0,0,0,0.18)]">
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#0075de1f] text-[#0075de]">
                    <Svg d={ICON.bag} />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-[12px] font-semibold leading-tight">¡Nueva venta! · {active.name}</span>
                    <span className="block truncate text-[11px] leading-tight text-[#757575]">{product.name} · {product.price}{drop ? " · dropshipping" : ""}</span>
                  </span>
                </div>
              </div>
            )}
          </div>
          {/* Nombre y stock en una sola fila */}
          <div className="mt-2.5 flex items-end justify-between gap-3">
            <div className="min-w-0">
              <p key={product.name} className="lp-fade truncate text-[14px] font-semibold leading-tight">{product.name}</p>
              <p className="mt-0.5 truncate text-[11px] text-[#757575]">SKU {product.sku} · {drop ? "despacha el proveedor" : "en 8 canales"}</p>
            </div>
            {drop ? (
              <span className="shrink-0 rounded-full bg-[#7c3aed1a] px-2 py-1 text-[11px] font-semibold text-[#7c3aed]">Sin stock propio</span>
            ) : (
              <p key={`${product.sku}-${stock}`} className="lp-pop shrink-0 text-[32px] font-semibold leading-none tracking-[-0.04em] tabular-nums">{stock}</p>
            )}
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
                  <Svg d={ICON.doc} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12px] font-semibold leading-tight">Boleta N° {4520 + step} emitida</span>
                  <span className="block truncate text-[11px] leading-tight text-[#757575]">Venta en {active.name} · stock descontado en 8 canales</span>
                </span>
              </div>
            ) : (
              <div key="restock" className="lp-slide flex items-center gap-2.5">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#15803d1f] text-[#15803d]">
                  <Svg d={ICON.box} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12px] font-semibold leading-tight">Reposición recibida</span>
                  <span className="block truncate text-[11px] leading-tight text-[#757575]">Orden de compra N° 318 · Bodega Centro</span>
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Facturación justo debajo del producto: la boleta baja desde la misma venta */}
        <span className="absolute bottom-6 left-1/2 z-20 h-14 w-14 -translate-x-1/2 sm:h-[60px] sm:w-[60px]">
          <span className={`pointer-events-none absolute bottom-full left-1/2 h-6 w-[2px] -translate-x-1/2 sm:h-7 ${active ? "bg-[#15803d]" : "bg-[#02093a]/20"}`}>
            {active && <span key={step} className="lp-dot-down absolute -left-[3px] h-2 w-2 rounded-full bg-[#15803d]" />}
          </span>
          <ServiceDot icon={ICON.doc} logo={billingLogo} label="Facturación" tone={GREEN} active={!!active} pulse={step} />
        </span>

        {CHANNELS.map((ch) => (
          <Floating key={ch.key} k={ch.key}>
            {ch.key === "direct"
              ? <ServiceDot icon={ICON.cash} label="Venta directa" tone={BLUE} active={active?.key === ch.key} pulse={active ? step : 0} />
              : <ChannelDot logo={logoOf(ch.key)} active={active?.key === ch.key} pulse={active ? step : 0} />}
          </Floating>
        ))}
        <Floating k="dropshipping">
          <ServiceDot icon={ICON.truck} label="Dropshipping" tone={PURPLE} active={drop} pulse={step} />
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
