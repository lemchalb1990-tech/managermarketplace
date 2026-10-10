"use client";

import { useEffect, useState, type ReactNode } from "react";

export type Feature = { t: string; b: string; icon: string; mock: ReactNode };

const STEP_MS = 4500;

/**
 * Funciones como pestañas: a la izquierda la lista (título y una línea), a la derecha
 * el ejemplo de la función elegida. Avanza sola hasta que el usuario elige una.
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
    <div className="ui-reveal mt-8 grid gap-4 lg:mt-10 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:gap-6">
      {/* Lista (en el celular, fila de pestañas con scroll) */}
      <div role="tablist" aria-label="Funciones"
        className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 lg:mx-0 lg:flex-col lg:gap-1 lg:overflow-visible lg:px-0 lg:pb-0">
        {items.map((f, i) => {
          const on = i === idx;
          return (
            <button key={f.t} type="button" role="tab" aria-selected={on} onClick={() => pick(i)}
              className={`group relative flex shrink-0 items-center gap-3 overflow-hidden rounded-xl px-3 py-2.5 text-left transition lg:w-full ${on ? "bg-[#02093a] text-white" : "bg-[#f6f5f4] hover:bg-[#eceae6] lg:bg-transparent"}`}>
              <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${on ? "bg-white/10 text-white" : "bg-white text-[#02093a]"}`}
                style={on ? undefined : { border: "1px solid rgba(0,0,0,0.06)" }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d={f.icon} />
                </svg>
              </span>
              <span className="min-w-0">
                <span className="block whitespace-nowrap text-[14px] font-semibold leading-tight lg:whitespace-normal">{f.t}</span>
                <span className={`hidden text-[13px] leading-snug lg:block ${on ? "text-white/65" : "text-[#757575]"}`}>{f.b}</span>
              </span>
              {/* Avance del cambio automático */}
              {on && auto && <span key={idx} className="lp-progress absolute bottom-0 left-0 h-0.5 bg-[#62aef0]" style={{ animationDuration: `${STEP_MS}ms` }} />}
            </button>
          );
        })}
      </div>

      {/* Ejemplo de la función elegida */}
      <div className="relative flex min-h-[340px] items-center justify-center overflow-hidden rounded-2xl p-5 sm:p-8"
        style={{ background: "linear-gradient(160deg, #02093a 0%, #0b1d5c 100%)" }}>
        <div className="pointer-events-none absolute inset-0" style={{ background: "radial-gradient(circle at 50% 45%, rgba(0,117,222,0.3), transparent 60%)" }} />
        <div key={idx} className="lp-slide relative w-full max-w-[420px]">
          <p className="mb-3 text-center text-[13px] text-white/70 lg:hidden">{cur.b}</p>
          <div className="lp-shot rounded-2xl bg-white p-4 text-black sm:p-5 [&>*:first-child]:mt-0" aria-hidden="true">
            {cur.mock}
          </div>
        </div>
      </div>
    </div>
  );
}
