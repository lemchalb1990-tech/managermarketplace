'use client';

import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { api } from './api';

export type PlatformLogoSetting = {
  platform: string;
  displayName: string | null;
  description: string | null;
  logoUrl: string | null;
  logoScale?: number;
  logoScales?: Record<string, number> | null;
};

// Vistas donde se muestra un logo; cada una puede tener su propio tamaño.
export type LogoView = 'panel' | 'circle' | 'strip' | 'login' | 'icon';

// Tamaño del logo para una vista: el propio de esa vista o, si no tiene, el general.
export function viewScale(s: { logoScale?: number | null; logoScales?: Record<string, number> | null } | undefined, view: LogoView): number {
  return s?.logoScales?.[view] ?? s?.logoScale ?? 100;
}

type LogoMap = Record<string, PlatformLogoSetting>;

// Caché a nivel de módulo: el logo/nombre personalizado de cada plataforma (Mercado
// Libre, Shopify, OpenFactura, etc.) es el mismo para toda la instalación, así que no
// hace falta pedirlo de nuevo en cada página — se comparte entre landing, login y panel.
let cache: LogoMap | null = null;
let inflight: Promise<LogoMap> | null = null;

function fetchMap(): Promise<LogoMap> {
  if (cache) return Promise.resolve(cache);
  if (inflight) return inflight;
  inflight = api.public.platformLogos()
    .then((rows) => {
      const map: LogoMap = {};
      rows.forEach((r) => { map[r.platform] = r; });
      cache = map;
      return map;
    })
    .catch(() => ({} as LogoMap))
    .finally(() => { inflight = null; });
  return inflight;
}

// Se llama después de guardar un logo/nombre nuevo, para que el resto de las páginas
// ya montadas dejen de mostrar el valor viejo en cache.
export function invalidatePlatformLogosCache() {
  cache = null;
}

export function usePlatformLogos(): LogoMap {
  const [map, setMap] = useState<LogoMap>(cache || {});
  useEffect(() => {
    let mounted = true;
    fetchMap().then((m) => { if (mounted) setMap(m); });
    return () => { mounted = false; };
  }, []);
  return map;
}

// key: id en minúscula (mercadolibre, shopify, openfactura, ...) — mismo formato que ya
// se usa para guardar en PATCH /settings/platforms/:platform.
export function resolvePlatformLogo(map: LogoMap, key: string, fallback: ReactNode, alt: string, view: LogoView = 'panel'): ReactNode {
  const url = map[key]?.logoUrl;
  if (!url) return fallback;
  return <img src={url} alt={alt} className="w-full h-full object-contain" style={logoScaleStyle(viewScale(map[key], view))} />;
}

// Tamaño configurado del logo (100 = normal), aplicado sin cambiar la caja que lo contiene.
export function logoScaleStyle(scale?: number | null): CSSProperties | undefined {
  return scale && scale !== 100 ? { transform: `scale(${scale / 100})` } : undefined;
}

export function resolvePlatformName(map: LogoMap, key: string, fallback: string): string {
  return map[key]?.displayName || fallback;
}

export function resolvePlatformDescription(map: LogoMap, key: string, fallback: string): string {
  return map[key]?.description || fallback;
}
