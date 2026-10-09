'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { getToken, getUser } from '@/lib/auth';
import { api, imgUrl, type AiCreditsStatus, type PhotoCheckImage, type PhotoCheckResult, type PlanFeature } from '@/lib/api';

// Fila con problemas: lo que dice ML o la IA (o ambos).
function hasProblems(r: PhotoCheckImage) {
  return (r.ml?.issues.length ?? 0) > 0 || r.ai?.matches === false || (r.ai?.problems.length ?? 0) > 0;
}

// Revisión de fotos para Mercado Libre: diagnóstico oficial de ML (fondo, tamaño, textos,
// marcas de agua) + IA de visión que confirma que la foto coincide con el título. Permite
// corregir la foto real con IA o usar como principal una foto que sí coincide.
// Foto ampliada para ver el detalle (clic fuera o ✕ para cerrar).
function Lightbox({ src, onClose }: { src: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);
  return createPortal(
    <div className="fixed inset-0 z-[70] bg-black/80 flex items-center justify-center p-4" onClick={onClose}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt="" className="max-w-full max-h-[90vh] object-contain rounded-lg bg-white" onClick={(e) => e.stopPropagation()} />
      <button type="button" onClick={onClose} aria-label="Cerrar"
        className="absolute top-4 right-4 w-9 h-9 rounded-full bg-white/90 text-gray-700 text-xl leading-none">×</button>
    </div>,
    document.body,
  );
}

// Avance de la revisión: se revisa foto por foto y el porcentaje sube con cada una.
function ProgressModal({ done, total, useAi }: { done: number; total: number; useAi: boolean }) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  return createPortal(
    <div className="fixed inset-0 z-[65] bg-black/40 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 text-center">
        <div className="mx-auto w-10 h-10 rounded-full border-4 border-blue-100 border-t-blue-600 animate-spin" />
        <p className="mt-4 text-sm font-semibold text-gray-800">{useAi ? 'Revisando fotos con IA…' : 'Verificando fotos…'}</p>
        <p className="mt-1 text-xs text-gray-500">Foto {Math.min(done + 1, total)} de {total}</p>
        <div className="mt-4 h-2 bg-gray-100 rounded-full overflow-hidden">
          <div className="h-full bg-blue-600 rounded-full transition-all duration-300" style={{ width: `${pct}%` }} />
        </div>
        <p className="mt-2 text-2xl font-bold text-blue-600">{pct}%</p>
      </div>
    </div>,
    document.body,
  );
}

export default function MlPhotoCheck({ productId, connectionId, companyId, hasCategory, imageIds, highlight, onImagesChanged, onSelectionChange }: {
  productId: string;
  connectionId: string;
  companyId?: string;
  /** El producto tiene categoría ML: sin ella no se hace el diagnóstico de Mercado Libre. */
  hasCategory: boolean;
  /** Fotos del producto en orden (la principal primero): se revisan de a una para mostrar el avance. */
  imageIds: string[];
  /** Mercado Libre rechazó por fotos: se destaca la sección. */
  highlight?: boolean;
  onImagesChanged: () => Promise<unknown> | void;
  /** Fotos elegidas para subir a la publicación (null = todas, sin revisión). */
  onSelectionChange?: (imageIds: string[] | null) => void;
}) {
  const [credits, setCredits] = useState<AiCreditsStatus | null>(null);
  const [result, setResult] = useState<PhotoCheckResult | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState('');
  // Sugerencias de corrección pendientes de aprobar, por foto.
  const [fixes, setFixes] = useState<Record<string, string>>({});
  const [copied, setCopied] = useState('');
  // El Super Admin tiene todo aunque la empresa no tenga plan (su uso igual se registra).
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  // Imagen de referencia creada, pendiente de agregar o descartar.
  const [generated, setGenerated] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [notice, setNotice] = useState('');
  const [zoom, setZoom] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number; useAi: boolean } | null>(null);
  // Fotos que se subirán a la publicación: las que están bien vienen marcadas.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // Lo que incluye el plan de la empresa.
  const has = (f: PlanFeature) => isSuperAdmin || !!credits?.plan?.features.includes(f);
  const noPlan = !!credits && !credits.plan && !isSuperAdmin;
  // Sin categoría ML no se revisa, corrige ni genera nada.
  const mlOn = has('ML_DIAGNOSTIC') && hasCategory;
  const aiEnabled = has('AI_CHECK') && !!credits?.ready?.PHOTO_CHECK && hasCategory;
  const fixEnabled = has('AI_FIX') && !!credits?.ready?.PHOTO_FIX && hasCategory;
  const generateEnabled = has('AI_GENERATE') && !!credits?.ready?.PHOTO_GENERATE && hasCategory;
  const canCheck = mlOn || aiEnabled;

  useEffect(() => {
    onSelectionChange?.(result && result.images.length ? [...selected] : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result, selected]);

  const [creditsLoaded, setCreditsLoaded] = useState(false);
  const [autoRan, setAutoRan] = useState(false);

  useEffect(() => {
    setIsSuperAdmin(getUser()?.role === 'SUPER_ADMIN');
    const token = getToken();
    if (token) api.ai.credits(token, companyId).then(setCredits).catch(() => {}).finally(() => setCreditsLoaded(true));
  }, [companyId]);

  // El diagnóstico de Mercado Libre no usa créditos: corre solo al abrir la verificación.
  // La revisión con IA (descuenta créditos) queda a pedido.
  useEffect(() => {
    if (!creditsLoaded || autoRan || !mlOn) return;
    setAutoRan(true);
    runCheck(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [creditsLoaded, mlOn, autoRan]);

  async function runCheck(useAi: boolean) {
    setChecking(true);
    setError('');
    const token = getToken()!;
    try {
      let r: PhotoCheckResult;
      if (imageIds.length > 1) {
        // Foto por foto, para que el porcentaje del modal sea real.
        setProgress({ done: 0, total: imageIds.length, useAi });
        const rows: PhotoCheckResult['images'] = [];
        let last: PhotoCheckResult | null = null;
        let aiBlocked: string | null = null;
        for (let k = 0; k < imageIds.length; k++) {
          last = await api.marketplace.photoCheck(productId, connectionId, token, { useAi, imageIds: [imageIds[k]] });
          rows.push(...last.images);
          aiBlocked = aiBlocked || last.aiBlocked;
          setProgress({ done: k + 1, total: imageIds.length, useAi });
        }
        r = { ...last!, images: rows, aiBlocked };
      } else {
        setProgress({ done: 0, total: 1, useAi });
        r = await api.marketplace.photoCheck(productId, connectionId, token, { useAi });
        setProgress({ done: 1, total: 1, useAi });
      }
      setResult(r);
      setSelected(new Set(r.images.filter((i) => !hasProblems(i)).map((i) => i.imageId)));
      if (r.credits) setCredits(r.credits);
    } catch (e: any) {
      setError(e.message || 'No se pudieron revisar las fotos.');
    } finally {
      setChecking(false);
      setProgress(null);
    }
  }

  async function generate() {
    setGenerating(true);
    setError('');
    setNotice('');
    try {
      const r = await api.marketplace.photoGenerate(productId, getToken()!, { connectionId });
      setGenerated(r.url);
      setCredits(r.credits);
    } catch (e: any) {
      setError(e.message || 'No se pudo crear la imagen.');
    } finally {
      setGenerating(false);
    }
  }

  async function addGenerated() {
    if (!generated) return;
    setGenerating(true);
    try {
      await api.marketplace.photoGenerateAdd(productId, generated, getToken()!);
      setGenerated(null);
      setNotice('Imagen agregada al producto como última foto.');
      setResult(null);
      await onImagesChanged();
    } catch (e: any) {
      setError(e.message || 'No se pudo agregar la imagen.');
    } finally {
      setGenerating(false);
    }
  }

  function patchRow(imageId: string, patch: Partial<PhotoCheckImage>) {
    setResult((r) => r ? { ...r, images: r.images.map((i) => i.imageId === imageId ? { ...i, ...patch } : i) } : r);
  }

  async function fix(row: PhotoCheckImage) {
    setBusyId(row.imageId);
    setError('');
    try {
      const r = await api.marketplace.photoFix(productId, row.imageId, getToken()!, result?.title);
      setFixes((f) => ({ ...f, [row.imageId]: r.url }));
      setCredits(r.credits);
    } catch (e: any) {
      setError(e.message || 'No se pudo corregir la foto.');
    } finally {
      setBusyId('');
    }
  }

  async function applyFix(row: PhotoCheckImage) {
    const url = fixes[row.imageId];
    setBusyId(row.imageId);
    try {
      await api.marketplace.photoFixApply(productId, row.imageId, url, getToken()!);
      // La foto cambió: se marca como corregida y se debe volver a revisar.
      patchRow(row.imageId, { url, ml: undefined, ai: undefined, aiError: 'Foto corregida. Vuelve a revisar para confirmar.' });
      setFixes(({ [row.imageId]: _omit, ...rest }) => rest);
      await onImagesChanged();
    } catch (e: any) {
      setError(e.message || 'No se pudo reemplazar la foto.');
    } finally {
      setBusyId('');
    }
  }

  async function makePrimary(row: PhotoCheckImage) {
    setBusyId(row.imageId);
    try {
      await api.catalog.setPrimaryImage(productId, row.imageId, getToken()!);
      // La principal siempre se sube a la publicación.
      setSelected((prev) => new Set(prev).add(row.imageId));
      setResult((r) => r ? {
        ...r,
        images: r.images
          .map((i) => ({ ...i, isPrimary: i.imageId === row.imageId }))
          .sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary)),
      } : r);
      await onImagesChanged();
    } catch (e: any) {
      setError(e.message || 'No se pudo cambiar la foto principal.');
    } finally {
      setBusyId('');
    }
  }

  function copy(text: string) {
    navigator.clipboard.writeText(text).then(() => { setCopied(text); setTimeout(() => setCopied(''), 2000); });
  }

  const primary = result?.images.find((i) => i.isPrimary);
  const primaryMismatch = primary?.ai?.matches === false;
  const withProblems = result?.images.filter(hasProblems).length ?? 0;
  // Hubo alguna revisión (ML o IA) en este resultado.
  const checked = !!result && (result.features?.ML_DIAGNOSTIC || result.images.some((i) => i.ai));
  const fixCost = credits?.costs.PHOTO_FIX ?? 5;
  const checkCost = credits?.costs.PHOTO_CHECK ?? 1;
  const suggestedTitle = result?.images.find((i) => i.ai?.suggestedTitle)?.ai?.suggestedTitle;

  return (
    <div className={`pt-3 mt-3 border-t ${highlight ? 'border-red-200' : 'border-gray-100'} space-y-2.5`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-gray-700">Fotos</p>
          <p className="text-[11px] text-gray-500">
            {highlight
              ? 'Mercado Libre suele rechazar cuando las fotos no coinciden con el título. Revísalas aquí.'
              : 'Revisa que cada foto coincida con el título antes de publicar.'}
          </p>
        </div>
        {(canCheck || fixEnabled) && (
          <div className="flex flex-col items-end gap-1 shrink-0">
            {aiEnabled && (
              <button type="button" onClick={() => runCheck(true)} disabled={checking || !!busyId}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-50 ${highlight ? 'bg-red-600 hover:bg-red-700 text-white' : 'bg-blue-600 hover:bg-blue-700 text-white'}`}>
                {checking ? 'Revisando...' : 'Revisar con IA'}
              </button>
            )}
            {(mlOn || !aiEnabled) && (
              <button type="button" onClick={() => runCheck(false)} disabled={checking || !!busyId}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50">
                {checking && !aiEnabled ? 'Revisando...' : mlOn ? (result ? 'Volver a revisar' : 'Revisar fotos') : 'Ver fotos para corregir'}
              </button>
            )}
          </div>
        )}
      </div>
      {noPlan && <p className="text-[11px] text-gray-500">Tu empresa no tiene un plan para revisar fotos.</p>}
      {!noPlan && !hasCategory && (
        <p className="text-[11px] text-gray-500">Asigna la categoría ML del producto para revisar, corregir o generar fotos.</p>
      )}
      {result?.mlSkipped && hasCategory && <p className="text-[11px] text-gray-500">{result.mlSkipped}</p>}

      {generateEnabled && (
        <div className="border border-dashed border-gray-300 rounded-lg p-2.5 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] text-gray-600">¿No tienes una foto adecuada? Crea una imagen de referencia desde el título.</p>
            {!generated && (
              <button type="button" onClick={generate} disabled={generating}
                className="shrink-0 px-2.5 py-1 rounded bg-blue-600 hover:bg-blue-700 text-white text-[11px] font-semibold disabled:opacity-50">
                {generating ? 'Creando... (puede tardar un minuto)' : `Crear imagen (${credits?.costs.PHOTO_GENERATE ?? 5} créditos)`}
              </button>
            )}
          </div>
          {generated && (
            <div className="flex gap-3 items-start">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={imgUrl(generated)} alt="Imagen de referencia" title="Ver en grande" onClick={() => setZoom(imgUrl(generated))}
                className="w-28 h-28 rounded object-contain bg-white border border-gray-200 shrink-0 cursor-zoom-in" />
              <div className="space-y-1.5">
                <p className="text-[11px] text-amber-700">Es una imagen creada por IA: revisa que represente bien tu producto antes de usarla.</p>
                <div className="flex gap-1.5">
                  <button type="button" onClick={addGenerated} disabled={generating}
                    className="px-2.5 py-1 rounded bg-green-600 hover:bg-green-700 text-white text-[11px] font-semibold disabled:opacity-50">
                    Agregar al catálogo
                  </button>
                  <button type="button" onClick={() => setGenerated(null)} disabled={generating}
                    className="px-2.5 py-1 rounded border border-gray-300 text-gray-600 text-[11px] hover:bg-gray-50 disabled:opacity-50">
                    Descartar
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
      {notice && <p className="text-[11px] text-green-600">{notice}</p>}
      {!result && aiEnabled && credits?.plan && (
        <p className="text-[11px] text-gray-400">La revisión con IA descuenta {checkCost} crédito{checkCost === 1 ? '' : 's'} por foto.</p>
      )}

      {result && (
        <>
          {result.images.length === 0 ? (
            <p className="text-xs text-gray-500">El producto no tiene fotos.</p>
          ) : checked && (
            <p className={`text-xs font-medium ${withProblems ? 'text-red-600' : 'text-green-600'}`}>
              {withProblems ? `${withProblems} de ${result.images.length} fotos con observaciones` : '✓ Todas las fotos están bien'}
            </p>
          )}
          {result.aiBlocked && <p className="text-[11px] text-amber-600">{result.aiBlocked}</p>}
          {primaryMismatch && (
            <p className="text-[11px] text-red-700 bg-red-50 border border-red-200 rounded-lg px-2.5 py-1.5">
              La foto principal no coincide con el título. Usa como principal una que sí coincida o reemplázala.
            </p>
          )}
          {suggestedTitle && (
            <div className="text-[11px] bg-blue-50 border border-blue-200 rounded-lg px-2.5 py-1.5 flex items-center gap-2">
              <span className="min-w-0 flex-1">Si las fotos están bien, el título podría ser: <strong>{suggestedTitle}</strong></span>
              <button type="button" onClick={() => copy(suggestedTitle)} className="text-blue-700 hover:underline shrink-0">
                {copied === suggestedTitle ? '✓ Copiado' : 'Copiar'}
              </button>
            </div>
          )}

          {result.images.length > 0 && (
            <p className={`text-[11px] ${selected.size ? 'text-gray-500' : 'text-red-600 font-medium'}`}>
              {selected.size
                ? `Se subirán ${selected.size} de ${result.images.length} fotos a la publicación (marca o desmarca cada una).`
                : 'Marca al menos una foto para subirla a la publicación.'}
            </p>
          )}
          {/* En computador, 3 columnas; en celular, una. */}
          <ul className="grid grid-cols-1 lg:grid-cols-3 gap-2">
            {result.images.map((row) => {
              const fixUrl = fixes[row.imageId];
              const busy = busyId === row.imageId;
              // Sin revisiones (plan solo de corrección) se puede corregir cualquier foto.
              const canFix = checked ? hasProblems(row) && row.ai?.matches !== false : true;
              // Cualquier foto se puede dejar como principal; se destaca cuando la IA lo sugiere.
              const canBePrimary = !row.isPrimary;
              const suggestPrimary = canBePrimary && row.ai?.matches === true && primaryMismatch;
              return (
                <li key={row.imageId} className="border border-gray-200 rounded-lg p-2">
                  <div className="flex gap-2.5">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <label className="flex items-start pt-1 shrink-0 cursor-pointer" title="Subir esta foto a la publicación">
                      <input type="checkbox" checked={selected.has(row.imageId)} className="accent-blue-600"
                        onChange={(e) => setSelected((prev) => {
                          const next = new Set(prev);
                          if (e.target.checked) next.add(row.imageId); else next.delete(row.imageId);
                          return next;
                        })} />
                    </label>
                    <img src={imgUrl(row.url)} alt="" title="Ver en grande" onClick={() => setZoom(imgUrl(row.url))}
                      className={`w-14 h-14 rounded object-contain bg-gray-50 border border-gray-100 shrink-0 cursor-zoom-in ${selected.has(row.imageId) ? '' : 'opacity-40'}`} />
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex flex-wrap gap-1">
                        {row.isPrimary && <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-800 text-white">Principal</span>}
                        {row.ml && (row.ml.available
                          ? <span className={`text-[10px] px-1.5 py-0.5 rounded ${row.ml.ok ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                              ML: {row.ml.ok ? 'OK' : row.ml.issues.join(', ')}
                            </span>
                          : <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">ML: sin diagnóstico</span>)}
                        {row.ai && (
                          <span className={`text-[10px] px-1.5 py-0.5 rounded ${row.ai.matches ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                            IA: {row.ai.matches ? 'Coincide con el título' : 'No coincide con el título'}
                          </span>
                        )}
                      </div>
                      {row.ml && !row.ml.available && row.ml.error && (
                        <p className="text-[11px] text-gray-500">Mercado Libre no entregó diagnóstico: {row.ml.error}</p>
                      )}
                      {row.ai && (
                        <p className="text-[11px] text-gray-600">
                          Se ve: {row.ai.shows}
                          {row.ai.problems.length > 0 && <span className="text-red-600"> · {row.ai.problems.join(' · ')}</span>}
                        </p>
                      )}
                      {row.ai?.suggestion && hasProblems(row) && <p className="text-[11px] text-gray-500">→ {row.ai.suggestion}</p>}
                      {row.aiError && <p className="text-[11px] text-amber-600">{row.aiError}</p>}
                      {row.ai?.matches === false && (
                        <p className="text-[11px] text-red-600">Esta foto no corresponde al título: reemplázala por una del producto real o quítala.</p>
                      )}
                      <div className="flex flex-wrap gap-1.5 pt-0.5">
                        {canBePrimary && (
                          <button type="button" onClick={() => makePrimary(row)} disabled={busy || !!busyId}
                            className={`px-2 py-1 rounded text-[11px] disabled:opacity-50 ${suggestPrimary ? 'bg-green-600 hover:bg-green-700 text-white font-semibold' : 'border border-gray-300 text-gray-700 hover:bg-gray-50'}`}>
                            {busy ? 'Cambiando...' : 'Usar como principal'}
                          </button>
                        )}
                        {canFix && !fixUrl && fixEnabled && (
                          <button type="button" onClick={() => fix(row)} disabled={busy}
                            className="px-2 py-1 rounded bg-blue-600 hover:bg-blue-700 text-white text-[11px] disabled:opacity-50">
                            {busy ? 'Corrigiendo... (puede tardar un minuto)' : `Corregir con IA (${fixCost} créditos)`}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>

                  {fixUrl && (
                    <div className="mt-2 pt-2 border-t border-gray-100">
                      <p className="text-[11px] text-gray-500 mb-1.5">Revisa que sea el mismo producto antes de usarla:</p>
                      <div className="flex gap-2 items-center">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={imgUrl(row.url)} alt="Antes" onClick={() => setZoom(imgUrl(row.url))} className="w-24 h-24 rounded object-contain bg-gray-50 border border-gray-200 cursor-zoom-in" />
                        <span className="text-gray-400">→</span>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={imgUrl(fixUrl)} alt="Después" onClick={() => setZoom(imgUrl(fixUrl))} className="w-24 h-24 rounded object-contain bg-white border border-gray-200 cursor-zoom-in" />
                      </div>
                      <div className="flex gap-1.5 mt-2">
                        <button type="button" onClick={() => applyFix(row)} disabled={busy}
                          className="px-2.5 py-1 rounded bg-green-600 hover:bg-green-700 text-white text-[11px] font-semibold disabled:opacity-50">
                          Usar esta foto
                        </button>
                        <button type="button" onClick={() => setFixes(({ [row.imageId]: _omit, ...rest }) => rest)} disabled={busy}
                          className="px-2.5 py-1 rounded border border-gray-300 text-gray-600 text-[11px] hover:bg-gray-50 disabled:opacity-50">
                          Descartar
                        </button>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}

      {error && <p className="text-[11px] text-red-600">{error}</p>}
      {zoom && <Lightbox src={zoom} onClose={() => setZoom(null)} />}
      {progress && <ProgressModal done={progress.done} total={progress.total} useAi={progress.useAi} />}
    </div>
  );
}
