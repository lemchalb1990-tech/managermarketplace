'use client';

import { useEffect, useRef, useState } from 'react';

// Lector de códigos con la cámara del celular (cámara trasera). Usa el lector nativo del
// navegador si existe (BarcodeDetector, rápido: Chrome en Android) y si no ZXing (iPhone y
// demás), que se descarga solo al abrir la cámara. Lee Code 128 (tickets y etiquetas de envío),
// QR y EAN. Al leer un código vibra, se cierra y lo entrega.

type Detector = { detect: (src: HTMLVideoElement) => Promise<Array<{ rawValue: string }>> };
type DetectorCtor = { new (o: { formats: string[] }): Detector; getSupportedFormats?: () => Promise<string[]> };
const WANTED = ['code_128', 'qr_code', 'ean_13', 'ean_8', 'code_39', 'upc_a'];

// ¿Es un celular o tablet? (pantalla táctil sin mouse)
export function isTouchDevice() {
  return typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches;
}

export function CameraScanner({ onDetected, onClose }: { onDetected: (code: string) => void; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const done = useRef(false);
  const [error, setError] = useState('');
  const [starting, setStarting] = useState(true);
  const [torch, setTorch] = useState<null | boolean>(null); // null = la cámara no tiene linterna
  const trackRef = useRef<MediaStreamTrack | null>(null);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let stopZxing: (() => void) | null = null;
    let raf = 0;
    let alive = true;

    const finish = (code: string) => {
      if (done.current) return;
      done.current = true;
      try { navigator.vibrate?.(120); } catch { /* sin vibración */ }
      onDetected(code.trim());
    };

    async function start() {
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
        setError('La cámara solo funciona con conexión segura (https). Usa la pistola o la entrada manual.');
        setStarting(false);
        return;
      }
      const Native = (window as unknown as { BarcodeDetector?: DetectorCtor }).BarcodeDetector;
      let formats: string[] = [];
      try { formats = Native ? ((await Native.getSupportedFormats?.()) ?? []).filter((f) => WANTED.includes(f)) : []; } catch { formats = []; }

      try {
        if (Native && formats.includes('code_128')) {
          stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
          if (!alive) return;
          const video = videoRef.current!;
          video.srcObject = stream;
          await video.play();
          const detector = new Native({ formats });
          const loop = async () => {
            if (!alive || done.current) return;
            try {
              const found = await detector.detect(video);
              if (found[0]?.rawValue) return finish(found[0].rawValue);
            } catch { /* cuadro sin código */ }
            raf = requestAnimationFrame(loop);
          };
          raf = requestAnimationFrame(loop);
        } else {
          const { BrowserMultiFormatReader } = await import('@zxing/browser');
          if (!alive) return;
          const reader = new BrowserMultiFormatReader();
          const controls = await reader.decodeFromConstraints(
            { video: { facingMode: { ideal: 'environment' } }, audio: false }, videoRef.current!,
            (result) => { if (result) finish(result.getText()); },
          );
          stopZxing = () => controls.stop();
          stream = (videoRef.current?.srcObject as MediaStream) || null;
        }
        const track = stream?.getVideoTracks()[0] || null;
        trackRef.current = track;
        const caps = (track?.getCapabilities?.() ?? {}) as { torch?: boolean };
        if (caps.torch) setTorch(false);
      } catch (e) {
        const name = (e as { name?: string }).name;
        setError(name === 'NotAllowedError'
          ? 'No diste permiso para usar la cámara. Actívalo en la configuración del navegador (ícono del candado junto a la dirección) y vuelve a intentar.'
          : name === 'NotFoundError' ? 'No se encontró una cámara en este dispositivo.' : 'No se pudo abrir la cámara. Usa la pistola o la entrada manual.');
      } finally {
        if (alive) setStarting(false);
      }
    }
    start();
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      stopZxing?.();
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [onDetected]);

  async function toggleTorch() {
    const t = trackRef.current;
    if (!t || torch === null) return;
    try {
      await t.applyConstraints({ advanced: [{ torch: !torch } as MediaTrackConstraintSet] });
      setTorch(!torch);
    } catch { setTorch(null); }
  }

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-black text-white">
      <div className="flex items-center justify-between px-4 py-3">
        <span className="text-sm font-medium">Apunta al código de barras</span>
        <div className="flex items-center gap-2">
          {torch !== null && (
            <button type="button" onClick={toggleTorch} className="rounded-full bg-white/15 px-3 py-1.5 text-xs font-medium">
              {torch ? '🔦 Apagar luz' : '🔦 Luz'}
            </button>
          )}
          <button type="button" onClick={onClose} className="rounded-full bg-white/15 px-3 py-1.5 text-xs font-medium">Cerrar</button>
        </div>
      </div>
      <div className="relative flex-1 overflow-hidden">
        <video ref={videoRef} playsInline muted className="absolute inset-0 h-full w-full object-cover" />
        {/* Marco guía */}
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="h-40 w-[80%] max-w-sm rounded-2xl border-4 border-white/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]" />
        </div>
        {starting && <p className="absolute inset-x-0 bottom-8 text-center text-sm text-white/80">Abriendo la cámara…</p>}
        {error && (
          <div className="absolute inset-x-4 bottom-8 rounded-xl bg-white p-4 text-sm text-gray-800">
            <p>{error}</p>
            <button type="button" onClick={onClose} className="mt-3 w-full rounded-lg bg-blue-600 py-2 font-semibold text-white">Volver</button>
          </div>
        )}
      </div>
      <p className="px-4 py-3 text-center text-xs text-white/60">Ticket del Punto de venta o etiqueta de envío. Mantén el código dentro del marco.</p>
    </div>
  );
}
