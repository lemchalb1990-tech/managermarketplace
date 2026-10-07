// Esqueletos de carga: imitan la forma del contenido (tabla, tarjetas, lista, formulario)
// mientras llegan los datos, en vez de un texto "Cargando…".
import { CSSProperties } from 'react';

const WIDTHS = ['72%', '55%', '84%', '64%', '48%', '78%', '60%', '90%'];

export function Skeleton({ className = '', style }: { className?: string; style?: CSSProperties }) {
  return <div className={`ui-skeleton ${className}`} style={style} aria-hidden="true" />;
}

// Filas de esqueleto para el <tbody> de una tabla existente.
export function SkeletonRows({ rows = 6, cols }: { rows?: number; cols: number }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, r) => (
        <tr key={r} className="border-t border-[var(--border-soft)]" aria-hidden="true">
          {Array.from({ length: cols }).map((_, c) => (
            <td key={c} className="px-4 py-3">
              <Skeleton className="h-3.5" style={{ width: WIDTHS[(r + c) % WIDTHS.length] }} />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

// Tabla completa (encabezado + filas) para zonas donde la tabla aún no existe.
export function SkeletonTable({ rows = 6, cols = 5, className = '' }: { rows?: number; cols?: number; className?: string }) {
  return (
    <div className={`overflow-hidden ${className}`} role="status" aria-label="Cargando">
      <div className="flex gap-4 px-4 py-3 bg-[var(--surface-soft)]">
        {Array.from({ length: cols }).map((_, c) => <Skeleton key={c} className="h-3 flex-1" style={{ maxWidth: c === 0 ? 140 : 110 }} />)}
      </div>
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex gap-4 px-4 py-3.5 border-t border-[var(--border-soft)]">
          {Array.from({ length: cols }).map((_, c) => (
            <div key={c} className="flex-1"><Skeleton className="h-3.5" style={{ width: WIDTHS[(r + c) % WIDTHS.length] }} /></div>
          ))}
        </div>
      ))}
    </div>
  );
}

// Grilla de tarjetas (indicadores, conexiones, productos).
export function SkeletonCards({ count = 4, className = 'grid grid-cols-2 lg:grid-cols-4 gap-3', height = 96 }: { count?: number; className?: string; height?: number }) {
  return (
    <div className={className} role="status" aria-label="Cargando">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="ui-card p-4 space-y-3" style={{ minHeight: height }}>
          <Skeleton className="h-3 w-1/2" />
          <Skeleton className="h-6 w-2/3" />
          <Skeleton className="h-2.5 w-1/3" />
        </div>
      ))}
    </div>
  );
}

// Lista de elementos (preguntas, reclamos, rutas, órdenes en bodega).
export function SkeletonList({ count = 5, className = 'space-y-3', avatar = false }: { count?: number; className?: string; avatar?: boolean }) {
  return (
    <div className={className} role="status" aria-label="Cargando">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="ui-card p-4 flex gap-3 items-start">
          {avatar && <Skeleton className="h-12 w-12 shrink-0 rounded-lg" />}
          <div className="flex-1 space-y-2.5">
            <Skeleton className="h-3.5" style={{ width: WIDTHS[i % WIDTHS.length] }} />
            <Skeleton className="h-3" style={{ width: WIDTHS[(i + 3) % WIDTHS.length] }} />
            <Skeleton className="h-3 w-1/4" />
          </div>
        </div>
      ))}
    </div>
  );
}

// Formulario (configuración, perfil, datos de un documento).
export function SkeletonForm({ fields = 6, columns = 2, className = '' }: { fields?: number; columns?: 1 | 2 | 3; className?: string }) {
  const grid = columns === 1 ? '' : columns === 2 ? 'sm:grid-cols-2' : 'sm:grid-cols-3';
  return (
    <div className={`grid grid-cols-1 ${grid} gap-4 ${className}`} role="status" aria-label="Cargando">
      {Array.from({ length: fields }).map((_, i) => (
        <div key={i} className="space-y-2">
          <Skeleton className="h-3 w-1/3" />
          <Skeleton className="h-9 w-full rounded-lg" />
        </div>
      ))}
    </div>
  );
}

// Vista de detalle: título, tarjetas de datos y un bloque grande.
export function SkeletonDetail({ className = '' }: { className?: string }) {
  return (
    <div className={`space-y-4 ${className}`} role="status" aria-label="Cargando">
      <div className="space-y-2">
        <Skeleton className="h-6 w-64" />
        <Skeleton className="h-3.5 w-40" />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {[0, 1, 2].map((i) => (
          <div key={i} className="ui-card p-5 space-y-3">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-3 w-5/6" />
            <Skeleton className="h-3 w-2/3" />
            <Skeleton className="h-3 w-3/4" />
          </div>
        ))}
      </div>
      <div className="ui-card"><SkeletonTable rows={4} cols={4} /></div>
    </div>
  );
}

// Página genérica: encabezado, barra de filtros y tabla (transición entre vistas).
export function SkeletonPage() {
  return (
    <div className="space-y-4" role="status" aria-label="Cargando">
      <div className="space-y-2">
        <Skeleton className="h-3 w-32" />
        <Skeleton className="h-7 w-56" />
      </div>
      <div className="ui-card p-5 flex flex-wrap gap-3">
        {[160, 130, 130, 200].map((w, i) => <Skeleton key={i} className="h-9 rounded-lg" style={{ width: w }} />)}
      </div>
      <div className="ui-card"><SkeletonTable rows={8} cols={5} /></div>
    </div>
  );
}
