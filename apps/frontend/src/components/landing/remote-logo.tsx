"use client";

import type { ReactNode } from "react";
import { logoScaleStyle, usePlatformLogos, viewScale, type LogoView } from "@/lib/platformLogos";

type Initial = { logoUrl: string | null; logoScale?: number; logoScales?: Record<string, number> | null };

/**
 * Logo registrado en el panel para la plataforma, con el tamaño configurado para esta vista.
 * El servidor lo trae cuando puede; si no, el navegador lo pide (una sola vez por página).
 */
export function RemoteLogo({ platform, initial, view, fallback }: {
  platform: string; initial?: Initial; view: LogoView; fallback: ReactNode;
}) {
  const map = usePlatformLogos();
  const s = map[platform] || initial;
  const url = s?.logoUrl;
  // eslint-disable-next-line @next/next/no-img-element
  return url ? <img src={url} alt={platform} className="h-full w-full object-contain" style={logoScaleStyle(viewScale(s, view))} /> : <>{fallback}</>;
}
