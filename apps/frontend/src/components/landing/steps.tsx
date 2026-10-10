"use client";

import type { ReactNode } from "react";
import { ExecutiveButton } from "./contact";

const STEPS = [
  { t: "Agenda con un ejecutivo", b: "Revisamos tus canales y te recomendamos un plan.",
    icon: "M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM9 15l2 2 4-4" },
  { t: "Conectamos tus canales", b: "Marketplaces, tienda y facturador, en un solo panel.",
    icon: "M9 2v6M15 2v6M6 8h12v3a6 6 0 0 1-12 0zM12 17v5" },
  { t: "Vendes desde un solo lugar", b: "Stock, pedidos y boletas al día desde el primer día.",
    icon: "M3 3h18v14H3zM8 21h8M12 17v4M7 13l3-3 3 3 4-5" },
];

/** "Empieza en 3 pasos": cómo se parte, con los logos de los canales en el paso 2. */
export function Steps({ logos }: { logos: ReactNode[] }) {
  return (
    <div className="ui-reveal mt-10">
      <ol className="relative grid gap-8 md:grid-cols-3 md:gap-6">
        {/* Línea que une los pasos, con un punto que avanza */}
        <span className="pointer-events-none absolute left-[16.6%] right-[16.6%] top-7 hidden h-px bg-[#02093a]/15 md:block" aria-hidden="true">
          <span className="lp-step-dot absolute -top-[3px] h-[7px] w-[7px] rounded-full bg-[#0075de]" />
        </span>
        {STEPS.map((s, i) => (
          <li key={s.t} className="relative flex flex-col items-center text-center">
            <span className="relative grid h-14 w-14 place-items-center rounded-2xl bg-[#02093a] text-white shadow-[0_8px_20px_rgba(2,9,58,0.2)]">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d={s.icon} />
              </svg>
              <span className="absolute -right-2 -top-2 grid h-6 w-6 place-items-center rounded-full bg-[#0075de] text-[12px] font-bold">{i + 1}</span>
            </span>
            <p className="mt-4 text-[18px] font-bold tracking-[-0.015em]">{s.t}</p>
            <p className="mt-1 max-w-[30ch] text-[14px] leading-[1.5] text-[#615d59]">{s.b}</p>
            {i === 1 && (
              <div className="mt-3 flex -space-x-2">
                {logos.map((node, j) => (
                  <span key={j} className="relative h-9 w-9 overflow-hidden rounded-full bg-white ring-2 ring-[#f6f5f4]" style={{ border: "1px solid rgba(0,0,0,0.06)" }}>
                    <span className="absolute inset-0 overflow-hidden rounded-full [&>*]:h-full [&>*]:w-full [&>img]:rounded-full [&>img]:object-cover [&>svg]:scale-[1.7]">{node}</span>
                  </span>
                ))}
              </div>
            )}
          </li>
        ))}
      </ol>
      <div className="mt-10 flex justify-center">
        <ExecutiveButton label="Agenda con un ejecutivo" className="lp-btn--primary lp-btn--lg" />
      </div>
    </div>
  );
}
