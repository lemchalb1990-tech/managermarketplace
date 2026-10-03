'use client';

import { useEffect, useState } from 'react';

// Visor a pantalla completa para las fotos de un producto o del pedido: flechas (teclado o
// botones) para recorrerlas, Esc o clic fuera para cerrar. Pensado también para celular:
// botones grandes y la imagen ajustada al alto disponible.
export default function ImageViewer({ images, startIndex = 0, title, onClose }: {
  images: string[];
  startIndex?: number;
  title?: string;
  onClose: () => void;
}) {
  const [index, setIndex] = useState(Math.min(Math.max(0, startIndex), images.length - 1));
  const many = images.length > 1;
  const prev = () => setIndex((i) => (i - 1 + images.length) % images.length);
  const next = () => setIndex((i) => (i + 1) % images.length);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft' && many) prev();
      else if (e.key === 'ArrowRight' && many) next();
    }
    window.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [many, onClose]);

  if (!images.length) return null;

  return (
    <div className="fixed inset-0 z-[60] bg-black/90 flex flex-col" onClick={onClose} role="dialog" aria-modal="true" aria-label={title || 'Imagen'}>
      <div className="flex items-center gap-3 px-4 py-3 text-white" onClick={(e) => e.stopPropagation()}>
        <p className="flex-1 min-w-0 text-sm font-medium truncate">{title}</p>
        {many && <span className="text-xs text-white/70 shrink-0">{index + 1} / {images.length}</span>}
        <button onClick={onClose} aria-label="Cerrar"
          className="shrink-0 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 text-2xl leading-none flex items-center justify-center">
          ×
        </button>
      </div>

      <div className="relative flex-1 min-h-0 flex items-center justify-center px-2 sm:px-14">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={images[index]} alt={title || 'Imagen'} onClick={(e) => e.stopPropagation()}
          className="max-w-full max-h-full object-contain rounded-lg bg-white" />
        {many && (
          <>
            <button onClick={(e) => { e.stopPropagation(); prev(); }} aria-label="Imagen anterior"
              className="absolute left-2 sm:left-3 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-black/50 hover:bg-black/70 text-white text-2xl flex items-center justify-center">
              ‹
            </button>
            <button onClick={(e) => { e.stopPropagation(); next(); }} aria-label="Imagen siguiente"
              className="absolute right-2 sm:right-3 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-black/50 hover:bg-black/70 text-white text-2xl flex items-center justify-center">
              ›
            </button>
          </>
        )}
      </div>

      {many && (
        <div className="flex gap-2 overflow-x-auto px-4 py-3 justify-start sm:justify-center" onClick={(e) => e.stopPropagation()}>
          {images.map((src, i) => (
            <button key={src + i} onClick={() => setIndex(i)} aria-label={`Ver imagen ${i + 1}`}
              className={`shrink-0 w-14 h-14 rounded-lg overflow-hidden border-2 bg-white ${i === index ? 'border-white' : 'border-transparent opacity-60 hover:opacity-100'}`}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={src} alt="" className="w-full h-full object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
