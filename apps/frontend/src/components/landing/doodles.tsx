/* Ilustraciones de la landing dibujadas a mano en SVG: personajes en círculo,
   destellos, garabatos, flechas y flores. Trazo negro grueso, rellenos planos y
   la paleta de acentos (amarillo, coral, celeste). Sin imágenes externas. */

import type { CSSProperties, ReactNode } from "react";

const INK = "#000";
const SKIN = ["#f6d5b8", "#e8b48f", "#c98e64", "#f3c9a4"];
const S = { stroke: INK, strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

/* ── Personajes ───────────────────────────────────────────────────────────── */

function Face({ skin, children, back, shirt }: { skin: string; children?: ReactNode; back?: ReactNode; shirt: string }) {
  return (
    <svg viewBox="0 0 48 48" width="100%" height="100%" aria-hidden="true">
      {back}
      <path d="M9 48c1.5-8.5 7.5-13 15-13s13.5 4.5 15 13" fill={shirt} {...S} />
      <circle cx="24" cy="21" r="9" fill={skin} {...S} />
      <circle cx="20.6" cy="21.4" r="1.15" fill={INK} />
      <circle cx="27.4" cy="21.4" r="1.15" fill={INK} />
      <path d="M21.2 25.4c1.7 1.5 3.9 1.5 5.6 0" fill="none" {...S} />
      {children}
    </svg>
  );
}

export const CHARACTERS: Array<{ key: string; label: string; ring: string; node: ReactNode }> = [
  {
    key: "vendedora", label: "Vendedora", ring: "#097fe8",
    node: (
      <Face skin={SKIN[0]} shirt="#62aef0"
        back={<path d="M14.6 31V21a9.4 9.4 0 0 1 18.8 0v10z" fill={INK} />}>
        <path d="M15.2 19.6c1.8-5 5.4-7.6 8.8-7.6s7.4 2.6 8.8 7.2c-4.2 0-7.8-1.6-9.8-4.2-1.6 2.6-4.4 4.6-7.8 4.6z" fill={INK} />
        <rect x="30" y="36" width="6" height="9" rx="1.4" fill="#fff" {...S} />
      </Face>
    ),
  },
  {
    key: "bodeguero", label: "Bodega", ring: "#f64932",
    node: (
      <Face skin={SKIN[2]} shirt="#ffb110">
        <path d="M15 19.5a9 9 0 0 1 18 0z" fill="#f64932" {...S} />
        <path d="M30 19.5h6" {...S} strokeWidth={2.4} />
        <rect x="16" y="37" width="16" height="11" rx="1" fill="#e8b48f" {...S} />
        <path d="M24 37v4" {...S} />
      </Face>
    ),
  },
  {
    key: "repartidor", label: "Repartidor", ring: "#ffb110",
    node: (
      <Face skin={SKIN[1]} shirt="#f64932">
        <path d="M13.8 22a10.2 10.2 0 0 1 20.4 0v1.4H13.8z" fill="#ffb110" {...S} />
        <path d="M18 17.5c1.6-2 3.6-3 6-3" fill="none" stroke="#fff" strokeWidth={1.6} strokeLinecap="round" />
      </Face>
    ),
  },
  {
    key: "cajera", label: "Punto de venta", ring: "#62aef0",
    node: (
      <Face skin={SKIN[3]} shirt="#fff">
        <circle cx="24" cy="10.5" r="3.6" fill="#b18164" {...S} />
        <path d="M15.2 20c.6-5.2 4.2-8.4 8.8-8.4s8.2 3.2 8.8 8.4c-3-1.6-5.4-3.8-6.4-5.8-2 2.6-6 4.8-11.2 5.8z" fill="#b18164" {...S} />
        <path d="M18 36.5 20 48M30 36.5 28 48" {...S} stroke="#f64932" strokeWidth={2.2} />
      </Face>
    ),
  },
  {
    key: "contadora", label: "Facturación", ring: "#097fe8",
    node: (
      <Face skin={SKIN[0]} shirt="#02093a">
        <path d="M15 21c0-6 4-9.6 9-9.6s9 3.6 9 9.6c-1.4-2.6-3.4-4.6-6-5.6-2.6 2-7.2 3.6-12 5.6z" fill="#f64932" {...S} />
        <circle cx="20.6" cy="21.4" r="3" fill="none" {...S} strokeWidth={1.4} />
        <circle cx="27.4" cy="21.4" r="3" fill="none" {...S} strokeWidth={1.4} />
        <path d="M23.6 21.2h.8" {...S} strokeWidth={1.4} />
      </Face>
    ),
  },
  {
    key: "duenio", label: "Dueño", ring: "#f64932",
    node: (
      <Face skin={SKIN[1]} shirt="#62aef0">
        <path d="M15.4 18.6c.8-4.4 4.4-7 8.6-7s7.8 2.6 8.6 7c-2.8-1.4-6-2-8.6-2s-5.8.6-8.6 2z" fill={INK} {...S} />
        <path d="M18.4 26.4c1.2 3 3.2 4.4 5.6 4.4s4.4-1.4 5.6-4.4" fill="none" {...S} />
        <rect x="31" y="37" width="7" height="8" rx="1.6" fill="#fff" {...S} />
        <path d="M38 39.4c2 0 2 3.4 0 3.4" fill="none" {...S} />
      </Face>
    ),
  },
  {
    key: "cliente", label: "Cliente", ring: "#ffb110",
    node: (
      <Face skin={SKIN[2]} shirt="#ffb110"
        back={<g fill={INK}>{[[16, 15], [20, 11.5], [24.5, 10.5], [29, 12], [32.4, 15.6], [15, 20], [33, 20.4]].map(([x, y]) => <circle key={`${x}-${y}`} cx={x} cy={y} r="4" />)}</g>}>
        <rect x="14" y="38" width="12" height="10" rx="1" fill="#e8b48f" {...S} />
        <path d="M14 42h12M20 38v10" {...S} strokeWidth={1.2} />
      </Face>
    ),
  },
];

/* Fila de personajes que flotan con desfase (equivale a un GIF, pero en CSS). */
export function CharacterRow({ className = "" }: { className?: string }) {
  return (
    <div className={`flex flex-wrap justify-center gap-2.5 ${className}`} aria-hidden="true">
      {CHARACTERS.map((c, i) => (
        <span key={c.key} className="lp-float" style={{ ["--fd" as string]: `${i * 0.35}s` } as CSSProperties}>
          <span className="lp-mark" title={c.label} style={{ color: c.ring }}>
            <span className="h-11 w-11 overflow-hidden rounded-full">{c.node}</span>
          </span>
        </span>
      ))}
    </div>
  );
}

/* ── Marcas decorativas ───────────────────────────────────────────────────── */

type MarkProps = { className?: string; color?: string; style?: CSSProperties };

export function Sparkle({ className = "", color = "#ffb110", style }: MarkProps) {
  return (
    <svg viewBox="0 0 24 24" className={`lp-twinkle ${className}`} style={style} aria-hidden="true">
      <path d="M12 1.5c.9 5.4 4.6 9.6 10.5 10.5-5.9.9-9.6 5.1-10.5 10.5C11.1 17.1 7.4 12.9 1.5 12 7.4 11.1 11.1 6.9 12 1.5z"
        fill={color} stroke={INK} strokeWidth="1.4" strokeLinejoin="round" />
    </svg>
  );
}

export function Squiggle({ className = "", color = INK, style }: MarkProps) {
  return (
    <svg viewBox="0 0 64 16" fill="none" className={className} style={style} aria-hidden="true">
      <path className="lp-draw" d="M3 10c5-9 9 9 14 0s9 9 14 0 9 9 14 0 9 9 14 0" stroke={color} strokeWidth="2.6" strokeLinecap="round" />
    </svg>
  );
}

export function CurlyArrow({ className = "", color = INK, style }: MarkProps) {
  return (
    <svg viewBox="0 0 80 60" fill="none" className={className} style={style} aria-hidden="true">
      <path className="lp-draw" d="M4 8c18-6 34 2 30 16-3 10-16 8-13-2 3-9 22-10 34 2 7 7 11 15 12 26"
        stroke={color} strokeWidth="2.4" strokeLinecap="round" />
      <path d="M59 42l8 9 6-11" stroke={color} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Flower({ className = "", color = "#f64932", style }: MarkProps) {
  return (
    <svg viewBox="0 0 40 40" className={`lp-spin ${className}`} style={style} aria-hidden="true">
      {[0, 72, 144, 216, 288].map((a) => (
        <ellipse key={a} cx="20" cy="10.5" rx="6" ry="8.5" fill={color} stroke={INK} strokeWidth="1.6" transform={`rotate(${a} 20 20)`} />
      ))}
      <circle cx="20" cy="20" r="5" fill="#ffb110" stroke={INK} strokeWidth="1.6" />
    </svg>
  );
}

export function Burst({ className = "", color = "#62aef0", style }: MarkProps) {
  return (
    <svg viewBox="0 0 40 40" fill="none" className={className} style={style} aria-hidden="true">
      {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => (
        <path key={a} d="M20 3v8" stroke={color === INK ? INK : color} strokeWidth="2.6" strokeLinecap="round" transform={`rotate(${a} 20 20)`} />
      ))}
    </svg>
  );
}

/* ── Escena del repartidor (sección móvil) ────────────────────────────────── */

export function RiderScene({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 220 150" className={className} aria-hidden="true">
      {/* camino */}
      <path d="M6 132h208" stroke={INK} strokeWidth="2" strokeLinecap="round" strokeDasharray="2 9" />
      {/* líneas de velocidad */}
      <g stroke={INK} strokeWidth="2.2" strokeLinecap="round" className="lp-speed">
        <path d="M10 92h26M4 104h22M14 116h18" />
      </g>
      <g className="lp-ride">
        {/* caja de reparto */}
        <rect x="46" y="62" width="40" height="34" rx="4" fill="#ffb110" stroke={INK} strokeWidth="2" />
        <path d="M46 74h40" stroke={INK} strokeWidth="2" />
        {/* moto */}
        <path d="M58 112h70l14-26h18" fill="none" stroke={INK} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M54 100h48l10 12H58z" fill="#f64932" stroke={INK} strokeWidth="2" strokeLinejoin="round" />
        <circle cx="66" cy="120" r="13" fill="#fff" stroke={INK} strokeWidth="2.4" />
        <circle cx="66" cy="120" r="3.5" fill={INK} />
        <circle cx="156" cy="120" r="13" fill="#fff" stroke={INK} strokeWidth="2.4" />
        <circle cx="156" cy="120" r="3.5" fill={INK} />
        <path d="M142 86l14 34" stroke={INK} strokeWidth="2.4" strokeLinecap="round" />
        {/* repartidor */}
        <path d="M96 100c2-18 10-28 22-28 8 0 14 6 16 14l-12 4" fill="#62aef0" stroke={INK} strokeWidth="2" strokeLinejoin="round" />
        <path d="M100 100l16 0 6 12" fill="none" stroke={INK} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="120" cy="56" r="12" fill="#e8b48f" stroke={INK} strokeWidth="2" />
        <path d="M107 55a13 13 0 0 1 26 0v2h-26z" fill="#ffb110" stroke={INK} strokeWidth="2" strokeLinejoin="round" />
        <circle cx="125" cy="60" r="1.5" fill={INK} />
      </g>
      {/* pin de destino */}
      <g className="lp-bob">
        <path d="M196 30c-8 0-13 6-13 12 0 9 13 22 13 22s13-13 13-22c0-6-5-12-13-12z" fill="#f64932" stroke={INK} strokeWidth="2" />
        <circle cx="196" cy="42" r="4.5" fill="#fff" stroke={INK} strokeWidth="1.8" />
      </g>
    </svg>
  );
}
