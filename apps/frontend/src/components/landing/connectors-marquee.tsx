"use client";

import type { ReactNode } from "react";
import { logoScaleStyle, usePlatformLogos, viewScale } from "@/lib/platformLogos";
import { CONNECTORS, CONNECTOR_BY_KEY, connectorStatus } from "@/lib/connectors";

function Chip({ node, soon }: { node: ReactNode; soon: boolean }) {
  return (
    <span className="group/logo relative flex h-24 shrink-0 items-center justify-center px-2">
      <span className="h-16 w-28 overflow-hidden rounded-xl bg-white opacity-80 grayscale-[0.4] shadow-[0_2px_8px_rgba(0,0,0,0.06)] transition duration-300 group-hover/logo:opacity-100 group-hover/logo:grayscale-0 sm:h-[72px] sm:w-32 [&>*]:h-full [&>*]:w-full [&>img]:object-cover"
        style={{ border: "1px solid rgba(0,0,0,0.06)" }}>
        {node}
      </span>
      {soon && (
        <span className="absolute bottom-1.5 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-[#02093a] px-2 py-0.5 text-[10px] font-semibold text-white">
          Próximamente
        </span>
      )}
    </span>
  );
}

/**
 * Cinta con los conectores: todos los del sistema (registro de sincronizadores) más las
 * plataformas que el Super Admin registre con logo. Los desactivados no aparecen y los
 * "próximamente" llevan su etiqueta. Un conector nuevo se suma solo.
 */
export function ConnectorsMarquee() {
  const map = usePlatformLogos();
  const keys = Array.from(new Set([
    ...CONNECTORS.map((c) => c.key),
    ...Object.keys(map).filter((k) => map[k]?.logoUrl),
  ])).filter((k) => connectorStatus(map, k) !== "DISABLED");
  const node = (k: string) => {
    const s = map[k];
    // eslint-disable-next-line @next/next/no-img-element
    return s?.logoUrl ? <img src={s.logoUrl} alt="" className="h-full w-full object-contain" style={logoScaleStyle(viewScale(s, "strip"))} /> : CONNECTOR_BY_KEY[k]?.logo;
  };
  const loop = [...keys, ...keys];
  return (
    <div className="marquee-mask group overflow-hidden">
      {/* La velocidad se mantiene pareja aunque se agreguen conectores (unos 3,5 s por logo). */}
      <div className="flex w-max gap-7 py-1 animate-marquee group-hover:[animation-play-state:paused]" style={{ animationDuration: `${Math.max(32, keys.length * 3.5)}s` }}>
        {loop.map((k, i) => <Chip key={`${k}-${i}`} node={node(k)} soon={connectorStatus(map, k) === "SOON"} />)}
      </div>
    </div>
  );
}
