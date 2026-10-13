'use client';

// Muestra el HTML de un correo aislado del panel: sin scripts ni acceso a la página (sandbox).
export function EmailPreview({ html, height = 520 }: { html: string; height?: number }) {
  return (
    <iframe title="Vista previa del correo" sandbox="" srcDoc={html}
      className="w-full rounded-lg border border-gray-200 bg-[#f6f5f4]" style={{ height }} />
  );
}
