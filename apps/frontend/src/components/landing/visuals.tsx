/* Elementos visuales de la landing tomados del producto: avisos como los que
   muestra el panel y mini datos para las tarjetas de beneficios. */

import type { CSSProperties, ReactNode } from "react";

const LINE = "1px solid rgba(0,0,0,0.08)";

/* Aviso flotante (venta nueva, boleta emitida, etc.). */
export function Toast({ icon, tone, title, meta, className = "", style }: {
  icon: ReactNode; tone: string; title: string; meta: string; className?: string; style?: CSSProperties;
}) {
  return (
    <div className={`lp-shot lp-float flex items-center gap-3 rounded-[10px] bg-white px-3.5 py-2.5 text-left ${className}`}
      style={{ border: LINE, ...style }}>
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full" style={{ background: `${tone}1f`, color: tone }}>
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-[13px] font-semibold leading-tight">{title}</span>
        <span className="block truncate text-[12px] leading-tight text-[#757575]">{meta}</span>
      </span>
    </div>
  );
}

const svg = (d: string) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={d} />
  </svg>
);
export const TOAST_ICONS = {
  sale: svg("M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4ZM3 6h18M16 10a4 4 0 0 1-8 0"),
  doc: svg("M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5M9 13h6M9 17h4"),
  sync: svg("M21 12a9 9 0 0 1-15.5 6.2L3 16M3 12a9 9 0 0 1 15.5-6.2L21 8M21 3v5h-5M3 21v-5h5"),
  truck: svg("M3 16V7a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v9M16 10h3l2 3v3h-5M7.5 19.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Zm10 0a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z"),
  check: svg("M20 6 9 17l-5-5"),
};

/* ── Mini datos para las tarjetas de beneficios ───────────────────────────── */

export function StockMini() {
  const ch = ["Mercado Libre", "Falabella", "Paris", "Ripley"];
  return (
    <div className="mt-6 rounded-[10px] bg-white/90 p-4 text-black" style={{ border: LINE }}>
      <div className="flex items-baseline justify-between text-[12px] text-[#757575]">
        <span>Polera oversize negra</span><span>SKU PO-NEG-M</span>
      </div>
      <div className="mt-2 flex items-center gap-3">
        <span className="font-mono text-[22px] font-semibold text-black/35 line-through">32</span>
        <span className="font-mono text-[22px] font-semibold">31</span>
        <span className="text-[12px] text-[#615d59]">Venta Falabella #88213</span>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-1.5 sm:grid-cols-4">
        {ch.map((c) => (
          <span key={c} className="flex items-center gap-1.5 rounded-md bg-[#f6f5f4] px-2 py-1.5 text-[12px]">
            <span className="h-1.5 w-1.5 rounded-full bg-[#15803d]" />{c}
          </span>
        ))}
      </div>
    </div>
  );
}

export function ProfitMini() {
  const rows: Array<[string, number, string]> = [
    ["Comisión", 14, "#f64932"], ["Envío", 6, "#ffb110"], ["Costo", 23, "#615d59"], ["Ganancia", 57, "#15803d"],
  ];
  return (
    <div className="mt-6 rounded-[10px] bg-white/90 p-4 text-black" style={{ border: LINE }}>
      <div className="flex h-2.5 overflow-hidden rounded-full">
        {rows.map(([k, v, c]) => <span key={k} style={{ width: `${v}%`, background: c }} />)}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-[12px]">
        {rows.map(([k, v, c]) => (
          <span key={k} className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-sm" style={{ background: c }} />{k}
            <span className="ml-auto font-mono text-[#615d59]">{v}%</span>
          </span>
        ))}
      </div>
    </div>
  );
}

export function ClaimMini() {
  return (
    <div className="mt-6 rounded-[10px] bg-white/10 p-4 text-white" style={{ border: "1px solid rgba(255,255,255,0.14)" }}>
      <div className="flex items-center justify-between text-[12px] text-white/60">
        <span>Reclamo N° 5284019</span><span>Abierto</span>
      </div>
      <p className="mt-1.5 text-[14px] font-medium">El producto llegó con daños</p>
      <div className="mt-3 flex items-center gap-2 rounded-md bg-[#ffb110] px-2.5 py-1.5 text-[12px] font-semibold text-black">
        Responder antes del 14 oct · 23:59
      </div>
    </div>
  );
}
