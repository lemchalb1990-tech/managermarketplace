'use client';

import { useEffect, useState } from 'react';
import { getToken, getUser } from '@/lib/auth';
import { api, imgUrl, type AiCreditsStatus, type PhotoCheckImage, type PhotoCheckResult } from '@/lib/api';

function creditsLine(c: AiCreditsStatus | null) {
  if (!c) return null;
  if (!c.ready?.PHOTO_CHECK) return 'La IA no está configurada en la plataforma: solo se hará el diagnóstico de Mercado Libre.';
  if (!c.plan) return 'La empresa no tiene un plan de IA: solo se hará el diagnóstico de Mercado Libre.';
  const part = (left: number | null, limit: number | null, label: string) =>
    limit == null ? `${label}: sin límite` : `${label}: ${left} de ${limit}`;
  return `Créditos IA (${c.plan.name}) — ${part(c.remainingToday, c.plan.dailyCredits, 'hoy')} · ${part(c.remainingMonth, c.plan.monthlyCredits, 'mes')}`;
}

// Fila con problemas: lo que dice ML o la IA (o ambos).
function hasProblems(r: PhotoCheckImage) {
  return (r.ml?.issues.length ?? 0) > 0 || r.ai?.matches === false || (r.ai?.problems.length ?? 0) > 0;
}

// Revisión de fotos para Mercado Libre: diagnóstico oficial de ML (fondo, tamaño, textos,
// marcas de agua) + IA de visión que confirma que la foto coincide con el título. Permite
// corregir la foto real con IA o usar como principal una foto que sí coincide.
export default function MlPhotoCheck({ productId, connectionId, companyId, highlight, onImagesChanged }: {
  productId: string;
  connectionId: string;
  companyId?: string;
  /** Mercado Libre rechazó por fotos: se destaca la sección. */
  highlight?: boolean;
  onImagesChanged: () => Promise<unknown> | void;
}) {
  const [credits, setCredits] = useState<AiCreditsStatus | null>(null);
  const [result, setResult] = useState<PhotoCheckResult | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState('');
  // Sugerencias de corrección pendientes de aprobar, por foto.
  const [fixes, setFixes] = useState<Record<string, string>>({});
  const [copied, setCopied] = useState('');
  // El Super Admin usa la IA aunque la empresa no tenga plan (su uso igual se registra).
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const aiEnabled = (isSuperAdmin || !!credits?.plan) && credits?.ready?.PHOTO_CHECK !== false;
  const fixEnabled = (isSuperAdmin || !!credits?.plan) && !!credits?.ready?.PHOTO_FIX;

  useEffect(() => {
    setIsSuperAdmin(getUser()?.role === 'SUPER_ADMIN');
    const token = getToken();
    if (token) api.ai.credits(token, companyId).then(setCredits).catch(() => {});
  }, [companyId]);

  async function runCheck() {
    setChecking(true);
    setError('');
    try {
      const r = await api.marketplace.photoCheck(productId, connectionId, getToken()!, { useAi: aiEnabled || credits === null });
      setResult(r);
      if (r.credits) setCredits(r.credits);
    } catch (e: any) {
      setError(e.message || 'No se pudieron revisar las fotos.');
    } finally {
      setChecking(false);
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
          {creditsLine(credits) && <p className="text-[11px] text-gray-400 mt-0.5">{creditsLine(credits)}</p>}
        </div>
        <button type="button" onClick={runCheck} disabled={checking || !!busyId}
          className={`shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-50 ${highlight ? 'bg-red-600 hover:bg-red-700 text-white' : 'border border-gray-300 text-gray-700 hover:bg-gray-50'}`}>
          {checking ? 'Revisando...' : result ? 'Volver a revisar' : 'Revisar fotos'}
        </button>
      </div>
      {!result && credits?.plan && (
        <p className="text-[11px] text-gray-400">La IA descuenta {checkCost} crédito{checkCost === 1 ? '' : 's'} por foto.</p>
      )}

      {result && (
        <>
          <p className={`text-xs font-medium ${withProblems ? 'text-red-600' : 'text-green-600'}`}>
            {withProblems ? `${withProblems} de ${result.images.length} fotos con observaciones` : '✓ Todas las fotos están bien'}
          </p>
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

          <ul className="space-y-2">
            {result.images.map((row) => {
              const fixUrl = fixes[row.imageId];
              const busy = busyId === row.imageId;
              const canFix = hasProblems(row) && row.ai?.matches !== false;
              const canBePrimary = !row.isPrimary && row.ai?.matches === true && primaryMismatch;
              return (
                <li key={row.imageId} className="border border-gray-200 rounded-lg p-2">
                  <div className="flex gap-2.5">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={imgUrl(row.url)} alt="" className="w-14 h-14 rounded object-contain bg-gray-50 border border-gray-100 shrink-0" />
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex flex-wrap gap-1">
                        {row.isPrimary && <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-800 text-white">Principal</span>}
                        {row.ml && (row.ml.available
                          ? <span className={`text-[10px] px-1.5 py-0.5 rounded ${row.ml.ok ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                              ML: {row.ml.ok ? 'OK' : row.ml.issues.join(', ')}
                            </span>
                          : <span title={row.ml.error} className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">ML: sin diagnóstico</span>)}
                        {row.ai && (
                          <span className={`text-[10px] px-1.5 py-0.5 rounded ${row.ai.matches ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                            IA: {row.ai.matches ? 'Coincide con el título' : 'No coincide con el título'}
                          </span>
                        )}
                      </div>
                      {row.ai && (
                        <p className="text-[11px] text-gray-600">
                          Se ve: {row.ai.shows}
                          {row.ai.problems.length > 0 && <span className="text-red-600"> · {row.ai.problems.join(' · ')}</span>}
                        </p>
                      )}
                      {row.ai?.suggestion && hasProblems(row) && <p className="text-[11px] text-gray-500">→ {row.ai.suggestion}</p>}
                      {row.aiError && <p className="text-[11px] text-amber-600">{row.aiError}</p>}
                      {row.ai?.matches === false && !canBePrimary && (
                        <p className="text-[11px] text-red-600">Esta foto no corresponde al título: reemplázala por una del producto real o quítala.</p>
                      )}
                      <div className="flex flex-wrap gap-1.5 pt-0.5">
                        {canBePrimary && (
                          <button type="button" onClick={() => makePrimary(row)} disabled={busy}
                            className="px-2 py-1 rounded border border-gray-300 text-[11px] text-gray-700 hover:bg-gray-50 disabled:opacity-50">
                            Usar como principal
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
                        <img src={imgUrl(row.url)} alt="Antes" className="w-24 h-24 rounded object-contain bg-gray-50 border border-gray-200" />
                        <span className="text-gray-400">→</span>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={imgUrl(fixUrl)} alt="Después" className="w-24 h-24 rounded object-contain bg-white border border-gray-200" />
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
    </div>
  );
}
