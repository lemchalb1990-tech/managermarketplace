"use client";

import { useEffect, useState } from "react";

const ITEMS = [
  { k: "Stock", before: "Lo bajas a mano en cada canal", after: "Se descuenta solo en todos",
    icon: "M21 8 12 3 3 8v8l9 5 9-5zM3 8l9 5 9-5M12 13v8" },
  { k: "Pedidos", before: "Repartidos en 4 Seller Center", after: "Una lista por hora de corte",
    icon: "M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4ZM3 6h18M16 10a4 4 0 0 1-8 0" },
  { k: "Boletas", before: "Copias cada venta a otro sistema", after: "Salen solas al vender",
    icon: "M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5M9 13h6M9 17h4" },
  { k: "Ganancia", before: "No sabes cuánto te quedó", after: "Neto y ganancia por venta",
    icon: "M3 17l6-6 4 4 8-8M14 7h7v7" },
];
// Desorden leve en "Hoy" (cada tarjeta un poco girada).
const TILT = ["-2.5deg", "1.8deg", "-1.2deg", "2.2deg"];

/** Interruptor "Hoy / Con Domium": las tarjetas pasan del caos al orden, solas o al elegir. */
export function BeforeAfter() {
  const [after, setAfter] = useState(false);
  // Cambia solo entre «Hoy» y «Con Domium»; se detiene mientras el mouse está encima.
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (paused) return;
    const id = window.setTimeout(() => setAfter((v) => !v), after ? 4200 : 3200);
    return () => window.clearTimeout(id);
  }, [after, paused]);
  return (
    <div className="ui-reveal mt-6" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
      <div className="flex justify-center">
        <div role="tablist" aria-label="Comparar" className="inline-flex rounded-full bg-[#f4f8fb] p-1 text-[14px] font-semibold" style={{ border: "1px solid rgba(0,0,0,0.06)" }}>
          {[false, true].map((v) => (
            <button key={String(v)} type="button" role="tab" aria-selected={after === v} onClick={() => setAfter(v)}
              className={`rounded-full px-4 py-2 transition-colors duration-300 ${after === v ? (v ? "ba-on" : "bg-white text-black shadow-sm") : "text-[#6b7f93] hover:text-black"}`}>
              {v ? "Con Domium" : "Hoy"}
            </button>
          ))}
        </div>
      </div>
      <div className="ba-progress" aria-hidden="true">{!paused && <i key={String(after)} className={after ? "is-after" : ""} />}</div>

      <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {ITEMS.map((it, i) => (
          <div key={it.k}
            className={`rounded-[14px] p-5 transition-all duration-500 ${after ? "bg-white shadow-[0_8px_24px_rgba(1,31,61,0.08)]" : "bg-[#eaf0f5]"}`}
            style={{
              border: after ? "1px solid rgba(1,31,61,0.08)" : "1px dashed rgba(0,0,0,0.15)",
              transform: after ? "none" : `rotate(${TILT[i]})`,
              transitionDelay: `${i * 70}ms`,
            }}>
            <div className="flex items-center gap-2.5">
              <span className={`grid h-10 w-10 place-items-center rounded-xl transition-colors duration-500 ${after ? "ba-chip-on" : "bg-white text-[#b45309]"}`}>
                {after ? (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5" /></svg>
                ) : (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={it.icon} /></svg>
                )}
              </span>
              <span className="text-[13px] font-semibold uppercase tracking-[0.04em] text-[#8a9cae]">{it.k}</span>
            </div>
            <p key={String(after)} className={`lp-slide mt-4 text-[18px] font-semibold leading-snug ${after ? "text-black" : "text-[#3d5368]"}`}>
              {after ? it.after : it.before}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
