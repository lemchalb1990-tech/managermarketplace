'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import Cropper, { type Area } from 'react-easy-crop';
import { Modal, btnPrimary, btnSecondary, labelCls, FormError } from '@/components/ui/Modal';
import { logoScaleStyle } from '@/lib/platformLogos';

// Lado mayor del PNG que se sube: de sobra para los tamaños en que se muestra un logo.
const MAX_SIDE = 600;

const ASPECTS: { key: string; label: string; value: number | null }[] = [
  { key: 'orig', label: 'Original', value: null },
  { key: '1', label: 'Cuadrado', value: 1 },
  { key: '16', label: 'Rectángulo 16:10', value: 1.6 },
  { key: '2', label: 'Horizontal 2:1', value: 2 },
];

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('No se pudo leer la imagen.'));
    img.src = src;
  });
}

function naturalSize(img: HTMLImageElement) {
  // Los SVG sin width/height pueden reportar 0: se les da un tamaño razonable.
  return { w: img.naturalWidth || 600, h: img.naturalHeight || 600 };
}

// Recorta el borde transparente o casi blanco alrededor del logo.
async function trimBorders(src: string): Promise<string | null> {
  const img = await loadImage(src);
  const { w, h } = naturalSize(img);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, 0, 0, w, h);
  const { data } = ctx.getImageData(0, 0, w, h);
  let top = h, left = w, right = -1, bottom = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const nearWhite = data[i] > 245 && data[i + 1] > 245 && data[i + 2] > 245;
      if (data[i + 3] > 16 && !nearWhite) {
        if (x < left) left = x;
        if (x > right) right = x;
        if (y < top) top = y;
        if (y > bottom) bottom = y;
      }
    }
  }
  if (right < 0) return null;
  const pad = 2;
  left = Math.max(0, left - pad); top = Math.max(0, top - pad);
  right = Math.min(w - 1, right + pad); bottom = Math.min(h - 1, bottom + pad);
  const out = document.createElement('canvas');
  out.width = right - left + 1;
  out.height = bottom - top + 1;
  out.getContext('2d')!.drawImage(canvas, left, top, out.width, out.height, 0, 0, out.width, out.height);
  return out.toDataURL('image/png');
}

// Dibuja el área elegida (si se alejó el zoom, lo que queda fuera de la imagen es transparente).
async function renderArea(src: string, area: Area): Promise<HTMLCanvasElement> {
  const img = await loadImage(src);
  const { w, h } = naturalSize(img);
  const scale = Math.min(1, MAX_SIDE / Math.max(area.width, area.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(area.width * scale));
  canvas.height = Math.max(1, Math.round(area.height * scale));
  canvas.getContext('2d')!.drawImage(img, -area.x * scale, -area.y * scale, w * scale, h * scale);
  return canvas;
}

// Vista previa del logo en cada lugar donde se muestra, a escala real de pantalla.
function Previews({ src, scale, name }: { src: string | null; scale: number; name: string }) {
  const logo = src
    // eslint-disable-next-line @next/next/no-img-element
    ? <img src={src} alt="" className="h-full w-full object-contain" style={logoScaleStyle(scale)} />
    : <span className="grid h-full w-full place-items-center text-[10px] text-gray-400">Sin logo</span>;
  const item = (label: string, node: ReactNode) => (
    <div className="flex flex-col items-center gap-1.5">
      <span className="text-[10px] text-gray-400">{label}</span>
      {node}
    </div>
  );
  return (
    <div className="grid grid-cols-2 gap-4 rounded-xl border border-gray-200 bg-gray-50 p-4 sm:grid-cols-3">
      {item('Panel · tarjeta', (
        <div className="rounded-xl border border-gray-200 bg-white p-3 text-center">
          <div className="mx-auto h-16 w-24 overflow-hidden rounded-lg">{logo}</div>
          <p className="mt-1.5 max-w-[96px] truncate text-[11px] font-semibold">{name}</p>
        </div>
      ))}
      {item('Inicio · círculo', (
        <div className="relative h-20 w-20 overflow-hidden rounded-full border border-gray-200 bg-white shadow-sm">
          <span className="absolute inset-0 overflow-hidden rounded-full [&>img]:object-cover [&>img]:rounded-full">{logo}</span>
        </div>
      ))}
      {item('Inicio · cinta de logos', (
        <div className="h-[72px] w-32 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm [&>img]:object-cover">
          {logo}
        </div>
      ))}
      {item('Login', (
        <div className="relative h-12 w-12 overflow-hidden rounded-full border-2 border-amber-400 bg-white">
          <span className="absolute inset-0 overflow-hidden rounded-full [&>img]:object-cover [&>img]:rounded-full">{logo}</span>
        </div>
      ))}
      {item('Ícono pequeño', (
        <div className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-2 py-1.5">
          <span className="h-6 w-9 overflow-hidden rounded">{logo}</span>
          <span className="text-[11px] font-medium">{name}</span>
        </div>
      ))}
      {item('Fondo oscuro', (
        <div className="grid h-16 w-24 place-items-center rounded-lg bg-[#02093a] p-2">
          <span className="h-full w-full overflow-hidden rounded bg-white">{logo}</span>
        </div>
      ))}
    </div>
  );
}

/**
 * Ajuste del logo de una plataforma (igual que "Ajustar logo" de la empresa): recorte y zoom,
 * quitar bordes, tamaño, y vista previa en el panel, la página de inicio y el login.
 */
export default function PlatformLogoAdjustModal({ src: initialSrc, scale: initialScale, name, onClose, onConfirm }: {
  src: string;
  scale: number;
  name: string;
  onClose: () => void;
  // file: imagen recortada para subir (null si no se tocó el recorte); scale: tamaño en %.
  onConfirm: (result: { file: File | null; scale: number }) => Promise<void>;
}) {
  const [src, setSrc] = useState(initialSrc);
  const [aspect, setAspect] = useState<number | null>(null);
  const [naturalAspect, setNaturalAspect] = useState(1);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [area, setArea] = useState<Area | null>(null);
  const [scale, setScale] = useState(initialScale || 100);
  const [preview, setPreview] = useState<string | null>(initialSrc);
  // Si la imagen viene de otro sitio que no permite leerla, solo se puede ajustar el tamaño.
  const [cropBlocked, setCropBlocked] = useState(false);
  const [edited, setEdited] = useState(initialSrc.startsWith('data:') || initialSrc.startsWith('blob:'));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const previewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    loadImage(src)
      .then((img) => { const { w, h } = naturalSize(img); setNaturalAspect(w / h); })
      .catch(() => setCropBlocked(true));
  }, [src]);

  const onCropComplete = useCallback((_: Area, pixels: Area) => {
    setArea(pixels);
    if (previewTimer.current) clearTimeout(previewTimer.current);
    previewTimer.current = setTimeout(() => {
      renderArea(src, pixels)
        .then((c) => setPreview(c.toDataURL('image/png')))
        .catch(() => { setCropBlocked(true); setPreview(src); });
    }, 150);
  }, [src]);

  useEffect(() => () => { if (previewTimer.current) clearTimeout(previewTimer.current); }, []);

  async function handleTrim() {
    setError('');
    setBusy(true);
    try {
      const trimmed = await trimBorders(src);
      if (!trimmed) { setError('No se encontraron bordes que quitar.'); return; }
      setSrc(trimmed);
      setAspect(null);
      setZoom(1);
      setCrop({ x: 0, y: 0 });
      setEdited(true);
    } catch {
      setCropBlocked(true);
      setError('Esta imagen está en otro sitio que no permite editarla. Descárgala y súbela como archivo para recortarla.');
    } finally {
      setBusy(false);
    }
  }

  async function handleConfirm(e: React.FormEvent) {
    e.preventDefault();
    e.stopPropagation();
    setError('');
    setBusy(true);
    try {
      let file: File | null = null;
      if (edited && area && !cropBlocked) {
        const canvas = await renderArea(src, area);
        const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
        if (!blob) throw new Error('No se pudo generar la imagen.');
        file = new File([blob], 'logo.png', { type: 'image/png' });
      }
      await onConfirm({ file, scale });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar el logo.');
      setBusy(false);
    }
  }

  return createPortal(
    <Modal
      title="Ajustar logo"
      subtitle="Recorta, quita los bordes y elige el tamaño. Abajo ves cómo queda en cada vista."
      size="xl"
      busy={busy}
      onClose={onClose}
      onSubmit={handleConfirm}
      footer={(
        <>
          <button type="button" onClick={onClose} disabled={busy} className={btnSecondary}>Cancelar</button>
          <button type="submit" disabled={busy} className={btnPrimary}>{busy ? 'Guardando...' : 'Usar este logo'}</button>
        </>
      )}
    >
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <div className="space-y-3">
          <div className="relative h-64 overflow-hidden rounded-xl border border-gray-200"
            style={{ backgroundImage: 'repeating-conic-gradient(#f1f5f9 0% 25%, #ffffff 0% 50%)', backgroundSize: '16px 16px' }}>
            <Cropper
              image={src}
              crop={crop}
              zoom={zoom}
              minZoom={0.5}
              maxZoom={4}
              zoomSpeed={0.2}
              aspect={aspect ?? naturalAspect}
              objectFit="contain"
              restrictPosition={zoom >= 1}
              onCropChange={(c) => { setCrop(c); if (c.x !== 0 || c.y !== 0) setEdited(true); }}
              onZoomChange={(z) => { setZoom(z); setEdited(true); }}
              onCropComplete={onCropComplete}
              style={{ containerStyle: { background: 'transparent' } }}
            />
          </div>

          {cropBlocked && (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
              El logo está en otro sitio que no permite recortarlo. Puedes ajustar el tamaño igual; para recortarlo, súbelo como archivo.
            </p>
          )}

          <div>
            <label className={labelCls}>Zoom del recorte</label>
            <input type="range" min={0.5} max={4} step={0.05} value={zoom} disabled={cropBlocked}
              onChange={(e) => { setZoom(Number(e.target.value)); setEdited(true); }} className="w-full accent-blue-600" />
            <p className="text-[11px] text-gray-400">Bajo 1× agrega margen alrededor del logo.</p>
          </div>

          <div>
            <label className={labelCls}>Forma del recorte</label>
            <div className="flex flex-wrap gap-1.5">
              {ASPECTS.map((a) => (
                <button key={a.key} type="button" disabled={cropBlocked} onClick={() => { setAspect(a.value); setEdited(true); }}
                  className={`rounded-lg border px-3 py-1.5 text-xs ${aspect === a.value ? 'border-blue-600 bg-blue-600 text-white' : 'border-gray-300 text-gray-600 hover:bg-gray-50'} disabled:opacity-50`}>
                  {a.label}
                </button>
              ))}
            </div>
          </div>

          <button type="button" onClick={handleTrim} disabled={busy || cropBlocked} className={btnSecondary}>
            ✂ Quitar bordes en blanco
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <label className={`${labelCls} flex items-center justify-between`}>
              <span>Tamaño del logo</span>
              <span className="font-mono text-gray-500">{scale}%</span>
            </label>
            <input type="range" min={30} max={250} step={5} value={scale}
              onChange={(e) => setScale(Number(e.target.value))} className="w-full accent-blue-600" />
            <div className="flex items-center justify-between">
              <p className="text-[11px] text-gray-400">Agranda o achica el logo dentro de su espacio, en todas las vistas.</p>
              {scale !== 100 && (
                <button type="button" onClick={() => setScale(100)} className="shrink-0 text-[11px] font-medium text-blue-600 hover:underline">
                  Restablecer
                </button>
              )}
            </div>
          </div>

          <Previews src={preview} scale={scale} name={name} />
        </div>
      </div>
      <div className="mt-3"><FormError message={error} /></div>
    </Modal>,
    document.body,
  );
}
