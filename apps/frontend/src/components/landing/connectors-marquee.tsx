"use client";

import type { ReactNode } from "react";
import { Logos } from "@/app/dashboard/ecommerce/components/logos";
import { BillingLogos } from "@/app/dashboard/billing/components/logos";
import { CourierLogos } from "@/app/dashboard/couriers/logos";
import { logoScaleStyle, usePlatformLogos, viewScale } from "@/lib/platformLogos";

// Todos los conectores del sistema: marketplaces y tiendas, facturación y couriers. Se arman
// desde los logos de cada integración, así que un conector nuevo aparece aquí solo.
const BUILT_IN: Record<string, ReactNode> = { ...Logos, ...BillingLogos, ...CourierLogos };

function Chip({ node }: { node: ReactNode }) {
  return (
    <span className="group/logo flex h-24 shrink-0 items-center justify-center px-2">
      <span className="h-16 w-28 overflow-hidden rounded-xl bg-white opacity-80 grayscale-[0.4] shadow-[0_2px_8px_rgba(0,0,0,0.06)] transition duration-300 group-hover/logo:opacity-100 group-hover/logo:grayscale-0 sm:h-[72px] sm:w-32 [&>*]:h-full [&>*]:w-full [&>img]:object-cover"
        style={{ border: "1px solid rgba(0,0,0,0.06)" }}>
        {node}
      </span>
    </span>
  );
}

/** Cinta con todos los conectores disponibles (incluye los que el Super Admin registre con logo). */
export function ConnectorsMarquee() {
  const map = usePlatformLogos();
  // Integraciones del sistema + plataformas registradas en el panel con logo propio (p. ej. proveedores).
  const keys = Array.from(new Set([
    ...Object.keys(BUILT_IN),
    ...Object.keys(map).filter((k) => map[k]?.logoUrl),
  ]));
  const node = (k: string) => {
    const s = map[k];
    // eslint-disable-next-line @next/next/no-img-element
    return s?.logoUrl ? <img src={s.logoUrl} alt="" className="h-full w-full object-contain" style={logoScaleStyle(viewScale(s, "strip"))} /> : BUILT_IN[k];
  };
  const loop = [...keys, ...keys];
  return (
    <div className="marquee-mask group overflow-hidden">
      {/* La velocidad se mantiene pareja aunque se agreguen conectores (unos 3,5 s por logo). */}
      <div className="flex w-max gap-7 py-1 animate-marquee group-hover:[animation-play-state:paused]" style={{ animationDuration: `${Math.max(32, keys.length * 3.5)}s` }}>
        {loop.map((k, i) => <Chip key={`${k}-${i}`} node={node(k)} />)}
      </div>
    </div>
  );
}
