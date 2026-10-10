"use client";

import { useEffect, useState, type ReactNode } from "react";

export type Feature = { t: string; b: string; icon: string; mock: ReactNode };

const STEP_MS = 4500;

/**
 * Funciones como pestañas en columnas (ícono arriba, título y una línea) y, debajo, el
 * ejemplo de la función elegida. Avanza sola hasta que el usuario elige una.
 */
export function Features({ items }: { items: Feature[] }) {
  const [idx, setIdx] = useState(0);
  const [auto, setAuto] = useState(true);

  useEffect(() => {
    if (!auto) return;
    if (typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = window.setInterval(() => setIdx((i) => (i + 1) % items.length), STEP_MS);
    return () => window.clearInterval(id);
  }, [auto, items.length]);

  const pick = (i: number) => { setIdx(i); setAuto(false); };
  const cur = items[idx];

  return (
    <div className="ui-reveal mt-8 lg:mt-10">
      {/* Funciones en columnas, con el ícono arriba */}
      <div role="tablist" aria-label="Funciones" className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
        {items.map((f, i) => {
          const on = i === idx;
          return (
            <button key={f.t} type="button" role="tab" aria-selected={on} onClick={() => pick(i)}
              className={`relative flex flex-col items-center gap-2 overflow-hidden rounded-xl px-3 pb-3 pt-4 text-center transition ${on ? "bg-[#02093a] text-white shadow-[0_8px_20px_rgba(2,9,58,0.25)]" : "bg-[#f6f5f4] hover:bg-[#eceae6]"}`}>
              <span className={`grid h-11 w-11 place-items-center rounded-xl ${on ? "bg-white/10 text-white" : "bg-white text-[#02093a]"}`}
                style={on ? undefined : { border: "1px solid rgba(0,0,0,0.06)" }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d={f.icon} />
                </svg>
              </span>
              <span className="text-[13px] font-semibold leading-tight">{f.t}</span>
              <span className={`hidden text-[12px] leading-snug sm:block ${on ? "text-white/65" : "text-[#757575]"}`}>{f.b}</span>
              {/* Avance del cambio automático */}
              {on && auto && <span key={idx} className="lp-progress absolute bottom-0 left-0 h-0.5 bg-[#62aef0]" style={{ animationDuration: `${STEP_MS}ms` }} />}
            </button>
          );
        })}
      </div>

      {/* Ejemplo de la función elegida */}
      <div className="relative mt-4 flex min-h-[300px] items-center justify-center overflow-hidden rounded-2xl p-5 sm:p-8"
        style={{ background: "linear-gradient(160deg, #02093a 0%, #0b1d5c 100%)" }}>
        <div className="pointer-events-none absolute inset-0" style={{ background: "radial-gradient(circle at 50% 45%, rgba(0,117,222,0.3), transparent 60%)" }} />
        <div key={idx} className="lp-slide relative w-full max-w-[460px]">
          <p className="mb-3 text-center text-[13px] text-white/70 sm:hidden">{cur.b}</p>
          <div className="lp-shot rounded-2xl bg-white p-4 text-black sm:p-5 [&>*:first-child]:mt-0" aria-hidden="true">
            {cur.mock}
          </div>
        </div>
      </div>
    </div>
  );
}
