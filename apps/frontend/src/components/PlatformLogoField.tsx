'use client';

import { useState, type ReactNode } from 'react';
import { api, imgUrl } from '@/lib/api';
import { getToken } from '@/lib/auth';
import { btnSecondary } from '@/components/ui/Modal';
import { logoScaleStyle, viewScale } from '@/lib/platformLogos';
import PlatformLogoAdjustModal from '@/app/dashboard/ecommerce/components/PlatformLogoAdjustModal';

/**
 * Logo de una plataforma (e-commerce, facturación, proveedor), igual que el logo de la
 * empresa: se sube el archivo, se recorta/ajusta con vista previa y se puede quitar.
 * El cambio queda en el formulario; se guarda con el botón Guardar de quien lo usa.
 */
export function PlatformLogoField({ platform, name, logoUrl, logoScale, logoScales, fallback, onChange }: {
  platform: string;
  name: string;
  logoUrl: string;
  logoScale: number;
  logoScales?: Record<string, number> | null;
  fallback?: ReactNode;
  onChange: (v: { logoUrl: string; logoScale: number; logoScales: Record<string, number> | null }) => void;
}) {
  const [adjust, setAdjust] = useState<{ src: string; objectUrl: boolean } | null>(null);
  const [error, setError] = useState('');

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError('');
    if (!/^image\/(jpeg|png|webp|svg\+xml)$/.test(file.type)) { setError('Usa una imagen PNG, JPG, WebP o SVG.'); return; }
    if (file.size > 5 * 1024 * 1024) { setError('El archivo supera el límite de 5 MB.'); return; }
    setAdjust({ src: URL.createObjectURL(file), objectUrl: true });
  }

  function closeAdjust() {
    if (adjust?.objectUrl) URL.revokeObjectURL(adjust.src);
    setAdjust(null);
  }

  return (
    <div>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <div className="flex h-20 w-28 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-gray-200 bg-white">
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={imgUrl(logoUrl)} alt="Logo" className="h-full w-full object-contain" style={logoScaleStyle(viewScale({ logoScale, logoScales }, 'panel'))} />
          ) : fallback ? (
            <span className="h-14 w-20">{fallback}</span>
          ) : (
            <span className="px-2 text-center text-xs text-gray-300">Sin logo</span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className={`${btnSecondary} cursor-pointer`}>
            {logoUrl ? 'Cambiar logo' : 'Subir logo'}
            <input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" className="hidden" onChange={handleFile} />
          </label>
          {logoUrl && (
            <button type="button" onClick={() => setAdjust({ src: imgUrl(logoUrl), objectUrl: false })} className={btnSecondary}>
              Ajustar
            </button>
          )}
          {logoUrl && (
            <button type="button" onClick={() => onChange({ logoUrl: '', logoScale: 100, logoScales: null })}
              className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-red-600 hover:bg-red-50">
              Quitar logo
            </button>
          )}
          <span className="w-full text-xs text-gray-400">
            PNG, JPG, WebP o SVG, máx. 5 MB. Al elegirlo podrás recortarlo y ver cómo sale.
            {logoUrl && (logoScale !== 100 || logoScales) ? ' Tamaño ajustado por vista.' : ''}
          </span>
        </div>
      </div>
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}

      {adjust && (
        <PlatformLogoAdjustModal
          src={adjust.src}
          scale={logoScale}
          scales={logoScales}
          name={name}
          onClose={closeAdjust}
          onConfirm={async ({ file, scale, scales }) => {
            let url = logoUrl;
            if (file) {
              const res = await api.settings.platforms.uploadLogo(platform, file, getToken()!);
              url = imgUrl(res.url);
            } else if (adjust.objectUrl) {
              throw new Error('No se pudo procesar la imagen. Prueba con otro archivo.');
            }
            onChange({ logoUrl: url, logoScale: scale, logoScales: scales });
            closeAdjust();
          }}
        />
      )}
    </div>
  );
}
