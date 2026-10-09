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

/* ── Objetos de "Todo desde el panel" ─────────────────────────────────────── */

const Box = ({ children }: { children: ReactNode }) => (
  <div className="mt-5 rounded-[10px] bg-[#f9f8f7] p-3.5 text-[12px]" style={{ border: LINE }}>{children}</div>
);
const Btn = ({ children }: { children: ReactNode }) => (
  <span className="mt-3 block rounded-md bg-[#0075de] py-1.5 text-center text-[12px] font-medium text-white">{children}</span>
);

export function PublishMini() {
  const ch: Array<[string, boolean]> = [["Mercado Libre", true], ["Falabella", true], ["Paris", true], ["Ripley", false]];
  return (
    <Box>
      <p className="font-semibold">Mesa de bar Circle</p>
      <div className="mt-2 space-y-1">
        {ch.map(([c, on]) => (
          <div key={c} className="flex items-center justify-between rounded-md bg-white px-2 py-1" style={{ border: LINE }}>
            <span>{c}</span>
            <span className={`relative h-3.5 w-6 rounded-full ${on ? "bg-[#0075de]" : "bg-black/15"}`}>
              <span className={`absolute top-0.5 h-2.5 w-2.5 rounded-full bg-white ${on ? "right-0.5" : "left-0.5"}`} />
            </span>
          </div>
        ))}
      </div>
      <Btn>Publicar en 3 canales</Btn>
    </Box>
  );
}

export function DirectSaleMini() {
  return (
    <Box>
      {[["Polera oversize negra ×2", "$25.980"], ["Gorro lana", "$8.990"]].map(([a, b]) => (
        <div key={a} className="flex justify-between gap-2 py-0.5"><span className="truncate">{a}</span><span className="font-mono">{b}</span></div>
      ))}
      <div className="mt-1.5 flex justify-between border-t border-black/[0.08] pt-1.5 text-[13px] font-semibold">
        <span>Total</span><span className="font-mono">$34.970</span>
      </div>
      <div className="mt-2 flex flex-wrap gap-1">
        {["Efectivo", "Débito", "Transferencia"].map((m, i) => (
          <span key={m} className={`rounded-full px-2 py-0.5 ${i === 1 ? "bg-[#e6f3fe] text-[#0075de]" : "bg-white text-[#615d59]"}`} style={{ border: LINE }}>{m}</span>
        ))}
      </div>
      <Btn>Cobrar y emitir boleta</Btn>
    </Box>
  );
}

export function QuoteMini() {
  const docs: Array<[string, string, string, string]> = [
    ["Presupuesto N° 1042", "Constructora Andes", "Vigente", "#0075de"],
    ["Orden de compra N° 318", "Proveedor Textil Sur", "Enviada", "#e89d01"],
    ["Presupuesto N° 1041", "Café Central", "Aceptado", "#15803d"],
  ];
  return (
    <Box>
      <div className="space-y-1.5">
        {docs.map(([n, c, st, col]) => (
          <div key={n} className="flex items-center gap-2 rounded-md bg-white px-2 py-1.5" style={{ border: LINE }}>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-semibold">{n}</span>
              <span className="block truncate text-[#757575]">{c}</span>
            </span>
            <span className="shrink-0 rounded-full px-2 py-0.5 font-medium" style={{ background: `${col}1a`, color: col }}>{st}</span>
          </div>
        ))}
      </div>
    </Box>
  );
}

export function InvoiceMini() {
  return (
    <Box>
      <div className="rounded-md bg-white p-2.5" style={{ border: LINE }}>
        <div className="flex items-start justify-between gap-2">
          <span className="min-w-0">
            <span className="block font-semibold">Factura electrónica</span>
            <span className="block truncate text-[#757575]">N° 8.214 · RUT 76.123.456-7</span>
          </span>
          <span className="shrink-0 rounded-full bg-[#15803d1a] px-2 py-0.5 font-medium text-[#15803d]">Aceptada SII</span>
        </div>
        <div className="mt-2 space-y-0.5 text-[#615d59]">
          <div className="flex justify-between"><span>Neto</span><span className="font-mono">$42.017</span></div>
          <div className="flex justify-between"><span>IVA 19%</span><span className="font-mono">$7.983</span></div>
          <div className="flex justify-between font-semibold text-black"><span>Total</span><span className="font-mono">$50.000</span></div>
        </div>
      </div>
      <p className="mt-2 text-[#757575]">Enviada por correo al cliente</p>
    </Box>
  );
}

export function LabelMini() {
  const bars = [2, 1, 3, 1, 1, 2, 1, 3, 2, 1, 1, 2, 3, 1, 2, 1, 1, 3, 1, 2, 2, 1, 3, 1, 1, 2];
  return (
    <Box>
      <div className="rounded-md bg-white p-2.5" style={{ border: LINE }}>
        <div className="flex items-center justify-between gap-2">
          <span className="truncate font-semibold">Mercado Envíos · Flex</span>
          <span className="font-mono text-[#757575]">#40213</span>
        </div>
        <div className="mt-2 flex h-9 items-stretch gap-[2px] overflow-hidden" aria-hidden="true">
          {bars.map((w, i) => <span key={i} className="shrink-0 bg-black" style={{ width: w * 1.6 }} />)}
        </div>
        <p className="mt-1.5 truncate text-[#615d59]">Los Leones 455, Providencia</p>
      </div>
      <Btn>Imprimir 21 etiquetas</Btn>
    </Box>
  );
}

export function QuestionsMini() {
  return (
    <Box>
      <div className="rounded-md bg-white p-2.5" style={{ border: LINE }}>
        <p className="text-[#757575]">Pregunta · hace 3 min</p>
        <p className="mt-0.5 font-medium">¿Tienen la mesa en color blanco?</p>
      </div>
      <div className="mt-1.5 rounded-md bg-[#e6f3fe] p-2.5 text-[#02093a]">
        Sí, la tenemos en blanco con despacho en 24 horas.
      </div>
      <Btn>Responder</Btn>
    </Box>
  );
}
