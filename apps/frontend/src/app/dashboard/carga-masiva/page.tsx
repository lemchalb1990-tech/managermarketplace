'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getToken, getUser } from '@/lib/auth';
import { api, type BulkLoadAction, type BulkLoadFields, type BulkLoadJob, type BulkLoadMode, type BulkLoadPreview } from '@/lib/api';
import { useAdminCompany } from '../AdminCompanyContext';
import { confirmDialog } from '../ConfirmDialog';

const PAGE_SIZE = 25;

const ACTION_BADGE: Record<BulkLoadAction, { label: string; cls: string }> = {
  CREATE: { label: 'Nuevo', cls: 'ui-badge ui-badge--ok' },
  UPDATE: { label: 'Actualiza', cls: 'ui-badge ui-badge--info' },
  UNCHANGED: { label: 'Sin cambios', cls: 'ui-badge ui-badge--neutral' },
  ERROR: { label: 'Error', cls: 'ui-badge ui-badge--danger' },
};

const MODES: { value: BulkLoadMode; label: string; help: string }[] = [
  { value: 'both', label: 'Crear y actualizar', help: 'SKU nuevo se crea; SKU existente se actualiza.' },
  { value: 'create', label: 'Solo crear', help: 'Los SKU que ya existen se omiten.' },
  { value: 'update', label: 'Solo actualizar', help: 'Los SKU que no existen se omiten.' },
];

const fmt = (v: string | number | null) =>
  v === null || v === '' ? '—' : typeof v === 'number' ? v.toLocaleString('es-CL') : v;

/**
 * Carga masiva de productos (solo Super Admin): elige los campos, descarga la plantilla, súbela
 * y revisa la vista previa antes de guardar. Se aplica a la empresa que se está gestionando.
 */
export default function CargaMasivaPage() {
  const router = useRouter();
  const { selectedCompanyId, companies } = useAdminCompany();
  const [allowed, setAllowed] = useState(false);
  const [fields, setFields] = useState<BulkLoadFields | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set(['name', 'price']));
  const [withProducts, setWithProducts] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [uploadPct, setUploadPct] = useState<number | null>(null);
  const [preview, setPreview] = useState<BulkLoadPreview | null>(null);
  const [mode, setMode] = useState<BulkLoadMode>('both');
  const [filter, setFilter] = useState<BulkLoadAction | 'ALL'>('ALL');
  const [page, setPage] = useState(0);
  const [job, setJob] = useState<BulkLoadJob | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const companyName = companies.find((c) => c.id === selectedCompanyId)?.name ?? '';

  useEffect(() => {
    const id = requestAnimationFrame(() => {
      if (getUser()?.role !== 'SUPER_ADMIN') { router.replace('/dashboard'); return; }
      setAllowed(true);
    });
    return () => cancelAnimationFrame(id);
  }, [router]);

  // Al cambiar de empresa se parte de cero (las bodegas son otras).
  useEffect(() => {
    if (!allowed || !selectedCompanyId) return;
    const id = requestAnimationFrame(() => {
      setFields(null);
      setPreview(null);
      setJob(null);
      setJobId(null);
      setError('');
      setSelected((s) => new Set([...s].filter((k) => !k.startsWith('stock:'))));
      api.catalog.bulkLoad.fields(getToken()!, selectedCompanyId)
        .then(setFields)
        .catch((e) => setError((e as Error).message));
    });
    return () => cancelAnimationFrame(id);
  }, [allowed, selectedCompanyId]);

  // Avance de la carga en curso.
  useEffect(() => {
    if (!jobId) return;
    let stop = false;
    const tick = async () => {
      try {
        const j = await api.catalog.bulkLoad.job(jobId, getToken()!);
        if (stop) return;
        setJob(j);
        if (j.status === 'RUNNING') setTimeout(tick, 1500);
      } catch (e) {
        if (!stop) setError((e as Error).message);
      }
    };
    tick();
    return () => { stop = true; };
  }, [jobId]);

  const counts = preview?.counts;
  const toApply = !counts ? 0 : (mode !== 'update' ? counts.create : 0) + (mode !== 'create' ? counts.update : 0);
  const rows = useMemo(
    () => (preview?.rows ?? []).filter((r) => filter === 'ALL' || r.action === filter),
    [preview, filter],
  );
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const pageRows = rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  function toggle(key: string) {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(key)) n.delete(key); else n.add(key);
      return n;
    });
  }

  function toggleGroup(keys: string[], on: boolean) {
    setSelected((s) => {
      const n = new Set(s);
      for (const k of keys) if (on) n.add(k); else n.delete(k);
      return n;
    });
  }

  async function download() {
    setDownloading(true);
    setError('');
    try {
      await api.catalog.bulkLoad.downloadTemplate(getToken()!, selectedCompanyId, [...selected], withProducts);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setDownloading(false);
    }
  }

  async function upload(file: File) {
    setError('');
    setPreview(null);
    setJob(null);
    setJobId(null);
    setUploadPct(0);
    try {
      const p = await api.catalog.bulkLoad.preview(file, getToken()!, selectedCompanyId, setUploadPct);
      setPreview(p);
      setFilter(p.counts.error ? 'ERROR' : 'ALL');
      setPage(0);
      setMode('both');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUploadPct(null);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function confirm() {
    if (!preview || !toApply) return;
    const parts = [
      mode !== 'update' && counts!.create ? `crear ${counts!.create.toLocaleString('es-CL')} producto(s)` : '',
      mode !== 'create' && counts!.update ? `actualizar ${counts!.update.toLocaleString('es-CL')} producto(s)` : '',
    ].filter(Boolean).join(' y ');
    const ok = await confirmDialog(
      <>
        <p>Vas a <strong>{parts}</strong> en <strong>{companyName || 'la empresa seleccionada'}</strong>.</p>
        {counts!.error > 0 && <p className="mt-2 text-sm text-gray-600">Las {counts!.error.toLocaleString('es-CL')} fila(s) con error no se cargan.</p>}
        <p className="mt-2 text-sm text-gray-600">Se guarda todo junto: si algo falla, no queda nada a medias.</p>
      </>,
      { title: 'Confirmar carga masiva', confirmLabel: 'Guardar' },
    );
    if (!ok) return;
    setError('');
    try {
      const r = await api.catalog.bulkLoad.confirm(preview.previewId, mode, getToken()!);
      setJob({ status: 'RUNNING', total: r.total, done: 0, result: null, error: null });
      setJobId(r.jobId);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  function reset() {
    setPreview(null);
    setJob(null);
    setJobId(null);
    setError('');
  }

  if (!allowed) return null;
  const running = job?.status === 'RUNNING';
  const selectedCount = selected.size + 1;

  return (
    <div className="max-w-6xl">
      <h1 className="ui-page-title mb-1">Carga masiva de productos</h1>
      <p className="ui-page-subtitle mb-5">
        Crea o actualiza productos de <strong>{companyName || 'la empresa seleccionada'}</strong> desde un Excel. El SKU identifica cada producto y nada se guarda hasta que confirmes.
      </p>
      {error && <p className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}

      {/* Paso 1: campos y plantilla */}
      <section className="ui-card mb-5 p-5">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="ui-section-title">1. Elige los campos de la plantilla</h2>
          <span className="text-xs text-gray-500">{selectedCount} columna(s) · SKU siempre va incluido</span>
        </div>
        {!fields ? (
          <p className="text-sm text-gray-500">Cargando campos…</p>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {fields.groups.map((g) => {
                const keys = g.fields.filter((f) => !f.required).map((f) => f.key);
                const allOn = keys.length > 0 && keys.every((k) => selected.has(k));
                return (
                  <div key={g.name} className="rounded-xl border border-gray-200 p-3">
                    <div className="mb-2 flex items-center justify-between">
                      <h3 className="text-sm font-semibold text-gray-800">{g.name}</h3>
                      {keys.length > 1 && (
                        <button type="button" onClick={() => toggleGroup(keys, !allOn)} className="text-xs font-medium text-[var(--brand)] hover:underline">
                          {allOn ? 'Quitar todos' : 'Marcar todos'}
                        </button>
                      )}
                    </div>
                    <ul className="space-y-1.5">
                      {g.fields.map((f) => (
                        <li key={f.key}>
                          <label className="flex cursor-pointer items-start gap-2 text-sm" title={f.help}>
                            <input
                              type="checkbox"
                              className="mt-0.5"
                              checked={f.required || selected.has(f.key)}
                              disabled={f.required}
                              onChange={() => toggle(f.key)}
                            />
                            <span className={f.required ? 'text-gray-500' : 'text-gray-800'}>
                              {f.label}
                              {(f.required || f.requiredOnCreate) && <span className="ml-1 text-[11px] text-gray-400">{f.required ? '(obligatorio)' : '(obligatorio al crear)'}</span>}
                            </span>
                          </label>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-700">
                <input type="checkbox" checked={withProducts} onChange={(e) => setWithProducts(e.target.checked)} />
                Incluir los productos actuales ({fields.productCount.toLocaleString('es-CL')} activos) para editarlos
              </label>
              <button type="button" className="ui-btn-brand" onClick={download} disabled={downloading || selected.size === 0}>
                {downloading ? 'Generando…' : 'Descargar plantilla'}
              </button>
            </div>
            {withProducts && fields.productCount > fields.maxRows && (
              <p className="mt-2 text-xs text-amber-700">La plantilla incluye los primeros {fields.maxRows.toLocaleString('es-CL')} productos (máximo por archivo).</p>
            )}
          </>
        )}
      </section>

      {/* Paso 2: subir */}
      <section className="ui-card mb-5 p-5">
        <h2 className="ui-section-title mb-1">2. Sube la plantilla completada</h2>
        <p className="mb-3 text-xs text-gray-500">
          Excel (.xlsx), hasta {(fields?.maxRows ?? 5000).toLocaleString('es-CL')} filas. Celda vacía = no cambia. El stock por bodega es la cantidad final en esa bodega.
        </p>
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f && !running) upload(f); }}
          className="flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-gray-300 px-4 py-8 text-center"
        >
          <p className="text-sm text-gray-600">Arrastra el archivo aquí o</p>
          <button type="button" className="ui-btn-secondary" disabled={uploadPct !== null || running} onClick={() => fileRef.current?.click()}>
            {uploadPct !== null ? (uploadPct < 100 ? `Subiendo… ${Math.round(uploadPct)}%` : 'Revisando filas…') : 'Elegir archivo'}
          </button>
          <input ref={fileRef} type="file" accept=".xlsx" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); }} />
        </div>
      </section>

      {/* Paso 3: vista previa */}
      {preview && counts && (
        <section className="ui-card mb-5 p-5">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="ui-section-title">3. Revisa antes de guardar</h2>
            <span className="text-xs text-gray-500">{preview.fileName} · {preview.rows.length.toLocaleString('es-CL')} fila(s)</span>
          </div>

          {preview.ignoredColumns.length > 0 && (
            <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
              Columnas no reconocidas (se ignoran): {preview.ignoredColumns.join(', ')}
            </p>
          )}
          {preview.planWarning && mode !== 'update' && (
            <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{preview.planWarning}</p>
          )}

          <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {([['CREATE', counts.create], ['UPDATE', counts.update], ['UNCHANGED', counts.unchanged], ['ERROR', counts.error]] as [BulkLoadAction, number][]).map(([a, n]) => (
              <button
                key={a}
                type="button"
                onClick={() => { setFilter(filter === a ? 'ALL' : a); setPage(0); }}
                className={`rounded-xl border px-3 py-2 text-left transition-colors ${filter === a ? 'border-[var(--brand)] bg-[var(--brand)]/5' : 'border-gray-200 hover:bg-gray-50'}`}
              >
                <span className={ACTION_BADGE[a].cls}>{ACTION_BADGE[a].label}</span>
                <p className="mt-1 text-xl font-semibold text-gray-900">{n.toLocaleString('es-CL')}</p>
              </button>
            ))}
          </div>

          <div className="overflow-x-auto rounded-xl border border-gray-200">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs text-gray-500">
                <tr>
                  <th className="px-3 py-2 font-medium">Fila</th>
                  <th className="px-3 py-2 font-medium">SKU</th>
                  <th className="px-3 py-2 font-medium">Nombre</th>
                  <th className="px-3 py-2 font-medium">Resultado</th>
                  <th className="px-3 py-2 font-medium">Detalle</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((r) => (
                  <tr key={r.row} className="border-t border-gray-100 align-top">
                    <td className="px-3 py-2 text-gray-500">{r.row}</td>
                    <td className="px-3 py-2 font-mono text-xs">{r.sku || '—'}</td>
                    <td className="px-3 py-2">{r.name || '—'}</td>
                    <td className="px-3 py-2 whitespace-nowrap"><span className={ACTION_BADGE[r.action].cls}>{ACTION_BADGE[r.action].label}</span></td>
                    <td className="px-3 py-2 text-xs">
                      {r.errors.map((e) => <p key={e} className="text-red-700">{e}</p>)}
                      {r.changes.map((c) => (
                        <p key={c.field} className="text-gray-700">
                          <span className="text-gray-500">{c.field}:</span>{' '}
                          {r.action === 'CREATE' ? fmt(c.to) : <>{fmt(c.from)} → <strong>{fmt(c.to)}</strong></>}
                        </p>
                      ))}
                      {r.warnings.map((w) => <p key={w} className="text-amber-700">{w}</p>)}
                    </td>
                  </tr>
                ))}
                {!pageRows.length && (
                  <tr><td colSpan={5} className="px-3 py-6 text-center text-gray-500">Sin filas en este filtro</td></tr>
                )}
              </tbody>
            </table>
          </div>
          {rows.length > PAGE_SIZE && (
            <div className="mt-2 flex flex-wrap items-center justify-end gap-1 text-xs">
              <span className="mr-2 text-gray-500">
                {(page * PAGE_SIZE + 1).toLocaleString('es-CL')}–{Math.min(rows.length, (page + 1) * PAGE_SIZE).toLocaleString('es-CL')} de {rows.length.toLocaleString('es-CL')} filas
              </span>
              <button type="button" className="ui-btn-secondary" disabled={page === 0} onClick={() => setPage(0)}>Primera</button>
              <button type="button" className="ui-btn-secondary" disabled={page === 0} onClick={() => setPage(page - 1)}>Anterior</button>
              <button type="button" className="ui-btn-secondary" disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>Siguiente</button>
              <button type="button" className="ui-btn-secondary" disabled={page >= pages - 1} onClick={() => setPage(pages - 1)}>Última</button>
            </div>
          )}

          {!job && (
            <div className="mt-5 border-t border-gray-100 pt-4">
              <p className="mb-2 text-sm font-medium text-gray-800">Qué hacer con las filas válidas</p>
              <div role="radiogroup" className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
                {MODES.map((m) => (
                  <label key={m.value} className={`flex cursor-pointer items-start gap-2 rounded-xl border p-3 text-sm ${mode === m.value ? 'border-[var(--brand)] bg-[var(--brand)]/5' : 'border-gray-200'}`}>
                    <input type="radio" name="mode" className="mt-0.5" checked={mode === m.value} onChange={() => setMode(m.value)} />
                    <span>
                      <span className="font-medium text-gray-900">{m.label}</span>
                      <span className="block text-xs text-gray-500">{m.help}</span>
                    </span>
                  </label>
                ))}
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap gap-2">
                  {counts.error > 0 && (
                    <button type="button" className="ui-btn-secondary" onClick={() => api.catalog.bulkLoad.downloadErrors(preview.previewId, getToken()!).catch((e) => setError((e as Error).message))}>
                      Descargar filas con error
                    </button>
                  )}
                  <button type="button" className="ui-btn-secondary" onClick={reset}>Descartar</button>
                </div>
                <button type="button" className="ui-btn-brand" disabled={!toApply || (!!preview.planWarning && mode !== 'update')} onClick={confirm}>
                  {toApply ? `Guardar ${toApply.toLocaleString('es-CL')} producto(s)` : 'Nada que guardar'}
                </button>
              </div>
            </div>
          )}

          {job && (
            <div className="mt-5 border-t border-gray-100 pt-4">
              {job.status === 'RUNNING' && (
                <>
                  <p className="mb-2 text-sm text-gray-700">Guardando… {job.done.toLocaleString('es-CL')} de {job.total.toLocaleString('es-CL')}</p>
                  <div className="h-2 overflow-hidden rounded-full bg-gray-100">
                    <div className="h-full bg-[var(--brand)] transition-all" style={{ width: `${job.total ? (job.done / job.total) * 100 : 0}%` }} />
                  </div>
                  <p className="mt-2 text-xs text-gray-500">Puedes quedarte en esta página; el avance se actualiza solo.</p>
                </>
              )}
              {job.status === 'DONE' && job.result && (
                <div className="rounded-lg bg-green-50 px-4 py-3 text-sm text-green-800">
                  <p className="font-medium">Carga terminada</p>
                  <p>
                    {job.result.created.toLocaleString('es-CL')} creado(s) · {job.result.updated.toLocaleString('es-CL')} actualizado(s) · {job.result.skipped.toLocaleString('es-CL')} sin cargar (sin cambios, con error u omitidos)
                  </p>
                  <p className="mt-1 text-xs text-green-700">El stock y los precios nuevos se envían a las publicaciones en segundo plano.</p>
                </div>
              )}
              {job.status === 'FAILED' && (
                <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
                  <p className="font-medium">No se guardó nada</p>
                  <p>{job.error}</p>
                </div>
              )}
              {job.status !== 'RUNNING' && (
                <div className="mt-3 flex gap-2">
                  {job.status === 'FAILED' && <button type="button" className="ui-btn-secondary" onClick={() => { setJob(null); setJobId(null); }}>Volver a la vista previa</button>}
                  <button type="button" className="ui-btn-brand" onClick={reset}>Nueva carga</button>
                </div>
              )}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
