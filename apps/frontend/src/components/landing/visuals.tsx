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
      <p className="font-semibold">Zapatillas urbanas blancas</p>
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
        <p className="mt-0.5 font-medium">¿Tienen talla 40?</p>
      </div>
      <div className="mt-1.5 rounded-md bg-[#e6f3fe] p-2.5 text-[#02093a]">
        Sí, tenemos talla 40 con despacho en 24 horas.
      </div>
      <Btn>Responder</Btn>
    </Box>
  );
}

/* ── Dashboard y alertas ──────────────────────────────────────────────────── */

export function DashboardMock() {
  const kpis: Array<[string, string, string]> = [
    ["Ventas totales", "$8.420.300", "+12%"],
    ["Total neto", "$7.075.882", "+9%"],
    ["Órdenes", "312", "+18%"],
    ["Ticket prom.", "$26.988", "−3%"],
  ];
  const days = [38, 52, 44, 61, 58, 72, 49, 66, 80, 71, 90, 76, 84, 95];
  const channels: Array<[string, number, string]> = [
    ["Mercado Libre", 46, "#ffb110"], ["Falabella", 22, "#62aef0"], ["Paris", 14, "#f64932"],
    ["Punto de venta", 11, "#0075de"], ["Ripley", 7, "#b18164"],
  ];
  return (
    <div className="lp-shot rounded-[12px] bg-white p-4 text-black sm:p-5" style={{ border: LINE }}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-[14px] font-semibold">Inicio</p>
        <span className="rounded-md bg-[#f6f5f4] px-2 py-1 text-[11px] text-[#615d59]">Últimos 14 días</span>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {kpis.map(([k, v, d]) => (
          <div key={k} className="min-w-0 rounded-[8px] bg-[#f9f8f7] p-2.5" style={{ border: LINE }}>
            <p className="truncate text-[11px] text-[#757575]">{k}</p>
            <p className="mt-0.5 truncate font-mono text-[14px] font-semibold">{v}</p>
            <p className={`text-[11px] font-medium ${d.startsWith("−") ? "text-[#e32d14]" : "text-[#15803d]"}`}>{d}</p>
          </div>
        ))}
      </div>
      <div className="mt-3 grid gap-3 md:grid-cols-[1.4fr_1fr]">
        <div className="rounded-[8px] p-3" style={{ border: LINE }}>
          <p className="text-[11px] font-medium text-[#615d59]">Historial de ventas</p>
          <div className="mt-2 flex h-24 items-end gap-1">
            {days.map((h, i) => (
              <span key={i} className="flex-1 rounded-t-[3px]" style={{ height: `${h}%`, background: i === days.length - 1 ? "#0075de" : "#cfe5fb" }} />
            ))}
          </div>
        </div>
        <div className="rounded-[8px] p-3" style={{ border: LINE }}>
          <p className="text-[11px] font-medium text-[#615d59]">Ventas por canal</p>
          <div className="mt-2 space-y-1.5">
            {channels.map(([c, v, col]) => (
              <div key={c} className="flex items-center gap-2 text-[11px]">
                <span className="w-[86px] shrink-0 truncate">{c}</span>
                <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-black/[0.06]">
                  <span className="block h-full rounded-full" style={{ width: `${v * 2}%`, background: col }} />
                </span>
                <span className="w-7 text-right font-mono text-[#615d59]">{v}%</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export const ALERTS: Array<{ t: string; m: string; tone: string; icon: ReactNode; when: string }> = [
  { t: "Nueva venta", m: "Mercado Libre · Zapatillas urbanas blancas · suena un aviso", tone: "#0075de", icon: TOAST_ICONS.sale, when: "ahora" },
  { t: "Nueva pregunta", m: "¿Tienen talla 40?", tone: "#e89d01", icon: svg("M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"), when: "hace 3 min" },
  { t: "Nuevo reclamo", m: "Responder antes del 14 oct · 23:59", tone: "#f64932", icon: svg("M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"), when: "hace 12 min" },
  { t: "Pedidos atrasados", m: "2 pedidos de Falabella pasaron la hora de corte", tone: "#e32d14", icon: svg("M12 6v6l4 2M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z"), when: "hace 20 min" },
  { t: "Alerta de seguridad", m: "5 intentos fallidos de inicio de sesión", tone: "#02093a", icon: svg("M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"), when: "hoy 09:14" },
];
