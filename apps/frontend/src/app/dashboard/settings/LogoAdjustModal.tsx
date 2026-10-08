'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Cropper, { type Area } from 'react-easy-crop';
import { Modal, btnPrimary, btnSecondary, labelCls, FormError } from '@/components/ui/Modal';
import { logoStyle, LOGO_SIZE_LABEL, type LogoSize, type PrintFormat } from '@/app/imprimir/printLayout';

// Lado mayor del PNG que se sube: liviano para imprimir y de sobra para 100 px de alto.
const MAX_SIDE = 800;

const ASPECTS: { key: string; label: string; value: number | null }[] = [
  { key: 'orig', label: 'Original', value: null },
  { key: '1', label: 'Cuadrado', value: 1 },
  { key: '2', label: 'Horizontal 2:1', value: 2 },
  { key: '3', label: 'Horizontal 3:1', value: 3 },
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

// Recorta el borde que es transparente o casi blanco alrededor del logo.
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
      const a = data[i + 3];
      const nearWhite = data[i] > 245 && data[i + 1] > 245 && data[i + 2] > 245;
      if (a > 16 && !nearWhite) {
        if (x < left) left = x;
        if (x > right) right = x;
        if (y < top) top = y;
        if (y > bottom) bottom = y;
      }
    }
  }
  if (right < 0) return null; // imagen vacía o toda blanca
  const pad = 2;
  left = Math.max(0, left - pad); top = Math.max(0, top - pad);
  right = Math.min(w - 1, right + pad); bottom = Math.min(h - 1, bottom + pad);
  const out = document.createElement('canvas');
  out.width = right - left + 1;
  out.height = bottom - top + 1;
  out.getContext('2d')!.drawImage(canvas, left, top, out.width, out.height, 0, 0, out.width, out.height);
  return out.toDataURL('image/png');
}

// Dibuja el área elegida (puede salirse de la imagen si se alejó el zoom: queda transparente).
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

function PreviewLine({ w }: { w: string }) {
  return <div className="h-1.5 rounded bg-gray-200 mx-auto" style={{ width: w }} />;
}

// Vista previa de cómo sale el logo en cada formato, a escala real de pantalla.
function Previews({ src, size, bw, companyName }: { src: string | null; size: LogoSize; bw: boolean; companyName: string }) {
  const filter = bw ? 'grayscale(1) contrast(1.8)' : undefined;
  const ticket = (format: PrintFormat, width: number, label: string) => (
    <div className="flex flex-col items-center gap-1">
      <span className="text-[10px] text-gray-400">{label}</span>
      <div className="bg-white border border-gray-200 shadow-sm px-2 py-3 space-y-1.5" style={{ width }}>
        {src && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt="" style={{ ...logoStyle(format, size), display: 'block', margin: '0 auto', filter }} />
        )}
        <p className="text-center font-mono font-bold text-[11px] truncate">{companyName || 'Tu empresa'}</p>
        <PreviewLine w="60%" />
        <PreviewLine w="45%" />
      </div>
    </div>
  );
  return (
    <div className="flex flex-wrap items-start justify-center gap-4 bg-gray-50 border border-gray-200 rounded-xl p-4">
      {ticket('TICKET_58', 181, 'Ticket 58 mm')}
      {ticket('TICKET', 272, 'Ticket 80 mm')}
      <div className="flex flex-col items-center gap-1 w-full">
        <span className="text-[10px] text-gray-400">Hoja carta</span>
        <div className="bg-white border border-gray-200 shadow-sm p-3 w-full max-w-md flex gap-3 items-start">
          {src && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={src} alt="" style={{ ...logoStyle('CARTA', size), filter }} />
          )}
          <div className="flex-1 min-w-0 space-y-1.5 pt-1">
            <p className="font-bold text-sm truncate">{companyName || 'Tu empresa'}</p>
            <div className="h-1.5 rounded bg-gray-200 w-2/3" />
            <div className="h-1.5 rounded bg-gray-200 w-1/2" />
          </div>
        </div>
      </div>
    </div>
  );
}

// Ajuste del logo antes de guardarlo: recorte/zoom, quitar bordes, tamaño en los documentos
// y vista previa en ticket y carta (también en blanco y negro, como imprime una térmica).
export default function LogoAdjustModal({ src: initialSrc, size: initialSize, companyName, onClose, onConfirm }: {
  src: string;
  size: LogoSize;
  companyName: string;
  onClose: () => void;
  onConfirm: (result: { file: File; size: LogoSize }) => Promise<void>;
}) {
  const [src, setSrc] = useState(initialSrc);
  const [aspect, setAspect] = useState<number | null>(null);
  const [naturalAspect, setNaturalAspect] = useState(1);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [area, setArea] = useState<Area | null>(null);
  const [size, setSize] = useState<LogoSize>(initialSize);
  const [bw, setBw] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const previewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    loadImage(src)
      .then((img) => { const { w, h } = naturalSize(img); setNaturalAspect(w / h); })
      .catch(() => setError('No se pudo cargar la imagen. Si es el logo actual, vuelve a subir el archivo.'));
  }, [src]);

  const onCropComplete = useCallback((_: Area, pixels: Area) => {
    setArea(pixels);
    if (previewTimer.current) clearTimeout(previewTimer.current);
    previewTimer.current = setTimeout(() => {
      renderArea(src, pixels).then((c) => setPreview(c.toDataURL('image/png'))).catch(() => {});
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
    } catch {
      setError('No se pudieron quitar los bordes de esta imagen.');
    } finally {
      setBusy(false);
    }
  }

  async function handleConfirm(e: React.FormEvent) {
    e.preventDefault();
    // Los eventos de React cruzan el portal: sin esto también se enviaría Datos de la empresa.
    e.stopPropagation();
    if (!area) return;
    setError('');
    setBusy(true);
    try {
      const canvas = await renderArea(src, area);
      const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
      if (!blob) throw new Error('No se pudo generar la imagen.');
      await onConfirm({ file: new File([blob], 'logo.png', { type: 'image/png' }), size });
    } catch (err: any) {
      setError(err.message || 'No se pudo guardar el logo.');
      setBusy(false);
    }
  }

  // Portal al body: se abre desde dentro del formulario de Datos de la empresa y un <form>
  // anidado enviaría el de afuera.
  return createPortal(
    <Modal
      title="Ajustar logo"
      subtitle="Recorta, quita los bordes y elige el tamaño con que sale en los documentos."
      size="xl"
      busy={busy}
      onClose={onClose}
      onSubmit={handleConfirm}
      footer={(
        <>
          <button type="button" onClick={onClose} disabled={busy} className={btnSecondary}>Cancelar</button>
          <button type="submit" disabled={busy || !area} className={btnPrimary}>{busy ? 'Guardando...' : 'Usar este logo'}</button>
        </>
      )}
    >
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="space-y-3">
          <div className="relative h-64 rounded-xl overflow-hidden border border-gray-200"
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
              onCropChange={setCrop}
              onZoomChange={setZoom}
              onCropComplete={onCropComplete}
              style={{ containerStyle: { background: 'transparent' } }}
            />
          </div>

          <div>
            <label className={labelCls}>Zoom</label>
            <input type="range" min={0.5} max={4} step={0.05} value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))} className="w-full accent-blue-600" />
            <p className="text-[11px] text-gray-400">Bajo 1× agrega margen alrededor del logo.</p>
          </div>

          <div>
            <label className={labelCls}>Forma del recorte</label>
            <div className="flex flex-wrap gap-1.5">
              {ASPECTS.map((a) => (
                <button key={a.key} type="button" onClick={() => setAspect(a.value)}
                  className={`px-3 py-1.5 rounded-lg text-xs border ${aspect === a.value ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-300 text-gray-600 hover:bg-gray-50'}`}>
                  {a.label}
                </button>
              ))}
            </div>
          </div>

          <button type="button" onClick={handleTrim} disabled={busy} className={btnSecondary}>
            ✂ Quitar bordes en blanco
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <label className={labelCls}>Tamaño en los documentos</label>
            <div className="flex gap-1.5">
              {(Object.keys(LOGO_SIZE_LABEL) as LogoSize[]).map((s) => (
                <button key={s} type="button" onClick={() => setSize(s)}
                  className={`flex-1 px-3 py-1.5 rounded-lg text-xs border ${size === s ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-300 text-gray-600 hover:bg-gray-50'}`}>
                  {LOGO_SIZE_LABEL[s]}
                </button>
              ))}
            </div>
          </div>

          <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer">
            <input type="checkbox" checked={bw} onChange={(e) => setBw(e.target.checked)} className="accent-blue-600" />
            Ver en blanco y negro (como imprime una impresora térmica)
          </label>

          <Previews src={preview} size={size} bw={bw} companyName={companyName} />
        </div>
      </div>
      <div className="mt-3"><FormError message={error} /></div>
    </Modal>,
    document.body,
  );
}
