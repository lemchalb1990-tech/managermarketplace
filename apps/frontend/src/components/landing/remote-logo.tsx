"use client";

import type { ReactNode } from "react";
import { logoScaleStyle, usePlatformLogos } from "@/lib/platformLogos";

/**
 * Logo registrado en el panel para la plataforma, con su tamaño configurado. El servidor
 * lo trae cuando puede; si no, el navegador lo pide (una sola vez para toda la página).
 */
export function RemoteLogo({ platform, initialUrl, initialScale, fallback }: {
  platform: string; initialUrl?: string | null; initialScale?: number | null; fallback: ReactNode;
}) {
  const map = usePlatformLogos();
  const url = map[platform]?.logoUrl || initialUrl;
  const scale = map[platform]?.logoScale ?? initialScale;
  // eslint-disable-next-line @next/next/no-img-element
  return url ? <img src={url} alt={platform} className="h-full w-full object-contain" style={logoScaleStyle(scale)} /> : <>{fallback}</>;
}
