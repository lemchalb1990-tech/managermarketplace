'use client';

import { useEffect } from 'react';

export type LightboxImage = { url: string; alt: string } | null;

// Miniatura de producto: si hay foto, se puede hacer clic para agrandarla (ver PhotoLightbox).
export function ProductThumb({
  url,
  alt,
  onClick,
}: {
  url?: string;
  alt: string;
  onClick: () => void;
}) {
  return (
    <span
      onClick={(e) => { if (!url) return; e.stopPropagation(); onClick(); }}
      className={`w-9 h-9 rounded-lg bg-white border border-[var(--border)] flex items-center justify-center overflow-hidden shrink-0 ${url ? 'cursor-zoom-in hover:border-blue-300' : ''}`}
    >
      {url ? (
        <img src={url} alt={alt} className="w-full h-full object-cover" />
      ) : (
        <span className="text-[var(--text-muted)] text-xs">—</span>
      )}
    </span>
  );
}

export function PhotoLightbox({ image, onClose }: { image: LightboxImage; onClose: () => void }) {
  useEffect(() => {
    if (!image) return;
    const onKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [image, onClose]);

  if (!image) return null;
  return (
    <div onClick={onClose} className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-6">
      <button
        onClick={onClose}
        className="absolute top-4 right-4 w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 text-white text-xl leading-none flex items-center justify-center"
        aria-label="Cerrar"
      >
        ×
      </button>
      <img
        src={image.url}
        alt={image.alt}
        onClick={(e) => e.stopPropagation()}
        className="max-w-full max-h-full rounded-xl shadow-2xl object-contain"
      />
    </div>
  );
}
