/* Elementos visuales de la landing tomados del producto: avisos como los que
   muestra el panel y mini datos para las tarjetas de beneficios. */

import type { CSSProperties, ReactNode } from "react";

const LINE = "1px solid rgba(0,0,0,0.08)";

// Fotos reales de producto (Unsplash, licencia libre) guardadas en /public.
export const PRODUCT_IMG = {
  zapatillas: "/landing/products/zapatillas-blancas.jpg",
  zapatillasAncha: "/landing/products/zapatillas-blancas-ancha.jpg",
  polera: "/landing/products/polera-negra.jpg",
  mochila: "/landing/products/mochila-urbana.jpg",
  jockey: "/landing/products/jockey-blanco.jpg",
  poleron: "/landing/products/poleron-blanco.jpg",
} as const;

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

/* ── Dashboard y alertas ──────────────────────────────────────────────────── */

export const ALERTS: Array<{ t: string; m: string; tone: string; icon: ReactNode; when: string }> = [
  { t: "Nueva venta", m: "Mercado Libre · Zapatillas urbanas blancas · suena un aviso", tone: "#0075de", icon: TOAST_ICONS.sale, when: "ahora" },
  { t: "Nueva pregunta", m: "¿Tienen talla 40?", tone: "#e89d01", icon: svg("M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"), when: "hace 3 min" },
  { t: "Nuevo reclamo", m: "Responder antes del 14 oct · 23:59", tone: "#f64932", icon: svg("M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"), when: "hace 12 min" },
  { t: "Pedidos atrasados", m: "2 pedidos de Falabella pasaron la hora de corte", tone: "#e32d14", icon: svg("M12 6v6l4 2M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z"), when: "hace 20 min" },
  { t: "Alerta de seguridad", m: "5 intentos fallidos de inicio de sesión", tone: "#02093a", icon: svg("M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"), when: "hoy 09:14" },
];
