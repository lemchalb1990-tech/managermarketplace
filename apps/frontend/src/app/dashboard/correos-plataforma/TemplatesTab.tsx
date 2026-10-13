'use client';

import { useEffect, useRef, useState } from 'react';
import { getToken, getUser } from '@/lib/auth';
import { api, type PlatformEmailTemplate, type PlatformEmailText } from '@/lib/api';
import { btnPrimary, btnSecondary } from '@/components/ui/Modal';
import { confirmDialog } from '../ConfirmDialog';
import { EmailPreview } from './EmailPreview';

type Field = 'subject' | 'title' | 'body' | 'buttonLabel';
const inputCls = 'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm';
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const same = (a: PlatformEmailText, b: PlatformEmailText) =>
  a.subject === b.subject && a.title === b.title && a.body === b.body && (a.buttonLabel ?? '') === (b.buttonLabel ?? '');

export function TemplatesTab() {
  const [templates, setTemplates] = useState<PlatformEmailTemplate[] | null>(null);
  const [key, setKey] = useState('');
  const [draft, setDraft] = useState<PlatformEmailText | null>(null);
  const [preview, setPreview] = useState<{ subject: string; html: string } | null>(null);
  const [previewError, setPreviewError] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [testTo, setTestTo] = useState('');
  const lastField = useRef<Field>('body');
  const refs = useRef<Partial<Record<Field, HTMLInputElement | HTMLTextAreaElement | null>>>({});

  useEffect(() => {
    api.platformMail.templates(getToken()!)
      .then((t) => { setTemplates(t); setTestTo(getUser()?.email || ''); if (t[0]) select(t[0]); })
      .catch((e) => setNotice({ ok: false, text: msg(e) }));
  }, []);

  const current = templates?.find((t) => t.key === key) ?? null;
  const dirty = !!(current && draft && !same(current.current, draft));

  function select(t: PlatformEmailTemplate) {
    setKey(t.key);
    setDraft({ ...t.current });
    setNotice(null);
  }

  async function choose(t: PlatformEmailTemplate) {
    if (dirty && !(await confirmDialog('Hay cambios sin guardar en este correo. ¿Descartarlos?', { confirmLabel: 'Descartar', danger: true }))) return;
    select(t);
  }

  // Vista previa en vivo, medio segundo después del último cambio.
  useEffect(() => {
    if (!key || !draft) return;
    const id = setTimeout(() => {
      api.platformMail.preview(key, draft, getToken()!)
        .then((p) => { setPreview(p); setPreviewError(''); })
        .catch((e) => setPreviewError(msg(e)));
    }, 500);
    return () => clearTimeout(id);
  }, [key, draft]);

  const set = (field: Field, value: string) => setDraft((d) => (d ? { ...d, [field]: value } : d));

  // Inserta la variable donde estaba el cursor del último campo usado.
  function insertVar(name: string) {
    const field = lastField.current === 'buttonLabel' && !current?.hasButton ? 'body' : lastField.current;
    const el = refs.current[field];
    const token = `{{${name}}}`;
    const value = String(draft?.[field] ?? '');
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? value.length;
    set(field, value.slice(0, start) + token + value.slice(end));
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + token.length, start + token.length);
    });
  }

  function replaceTemplate(t: PlatformEmailTemplate) {
    setTemplates((list) => list?.map((x) => (x.key === t.key ? t : x)) ?? null);
    setDraft({ ...t.current });
  }

  async function save() {
    if (!draft) return;
    setBusy(true);
    try {
      replaceTemplate(await api.platformMail.saveTemplate(key, draft, getToken()!));
      setNotice({ ok: true, text: 'Correo guardado. Los próximos envíos usan este texto.' });
    } catch (e) {
      setNotice({ ok: false, text: msg(e) });
    } finally {
      setBusy(false);
    }
  }

  async function reset() {
    if (!(await confirmDialog('Este correo vuelve al texto original de la plataforma.', { title: 'Restaurar texto original', confirmLabel: 'Restaurar' }))) return;
    setBusy(true);
    try {
      replaceTemplate(await api.platformMail.resetTemplate(key, getToken()!));
      setNotice({ ok: true, text: 'Se restauró el texto original.' });
    } catch (e) {
      setNotice({ ok: false, text: msg(e) });
    } finally {
      setBusy(false);
    }
  }

  async function sendTest() {
    if (!draft) return;
    setBusy(true);
    try {
      await api.platformMail.testTemplate(key, { ...draft, to: testTo.trim() }, getToken()!);
      setNotice({ ok: true, text: `Prueba enviada a ${testTo.trim()} con datos de ejemplo.` });
    } catch (e) {
      setNotice({ ok: false, text: msg(e) });
    } finally {
      setBusy(false);
    }
  }

  if (!templates) {
    return notice ? <p className="text-sm text-red-600">{notice.text}</p> : <p className="text-sm text-gray-400">Cargando correos…</p>;
  }

  const fieldProps = (field: Field) => ({
    ref: (el: HTMLInputElement | HTMLTextAreaElement | null) => { refs.current[field] = el; },
    onFocus: () => { lastField.current = field; },
    value: String(draft?.[field] ?? ''),
  });

  return (
    <div className="grid gap-4 lg:grid-cols-[240px_1fr]">
      {/* Lista de correos */}
      <div className="flex gap-2 overflow-x-auto lg:flex-col lg:overflow-visible">
        {templates.map((t) => (
          <button key={t.key} type="button" onClick={() => choose(t)}
            className={`shrink-0 rounded-lg border px-3 py-2 text-left text-sm lg:shrink ${t.key === key ? 'border-blue-300 bg-blue-50' : 'border-gray-200 bg-white hover:border-gray-300'}`}>
            <span className="block font-medium text-gray-800">{t.label}</span>
            <span className={`text-[11px] ${t.customized ? 'text-blue-600' : 'text-gray-400'}`}>{t.customized ? 'Personalizado' : 'Texto original'}</span>
          </button>
        ))}
      </div>

      {current && draft && (
        <div className="grid min-w-0 gap-4 xl:grid-cols-2">
          {/* Editor */}
          <div className="min-w-0 rounded-xl border border-gray-200 bg-white p-4">
            <h2 className="ui-section-title">{current.label}</h2>
            <p className="mb-4 mt-0.5 text-xs text-gray-500">Se envía: {current.trigger}.</p>

            <div className="flex flex-col gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">Asunto *</label>
                <input {...fieldProps('subject')} onChange={(e) => set('subject', e.target.value)} maxLength={200} className={inputCls} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">Título *</label>
                <input {...fieldProps('title')} onChange={(e) => set('title', e.target.value)} maxLength={200} className={inputCls} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">Cuerpo *</label>
                <textarea {...fieldProps('body')} onChange={(e) => set('body', e.target.value)} rows={8} maxLength={5000}
                  className={`${inputCls} font-mono text-[13px] leading-relaxed`} />
                <p className="mt-1 text-[11px] text-gray-400">
                  Línea en blanco = párrafo nuevo · **negrita** · *cursiva* · Una línea cuyas variables quedan vacías no se muestra.
                </p>
              </div>
              {current.hasButton && (
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600">Texto del botón *</label>
                  <input {...fieldProps('buttonLabel')} onChange={(e) => set('buttonLabel', e.target.value)} maxLength={60} className={inputCls} />
                  <p className="mt-1 text-[11px] text-gray-400">El botón lleva al enlace del correo y no se puede quitar.</p>
                </div>
              )}

              <div>
                <p className="mb-1 text-xs font-medium text-gray-600">Variables <span className="font-normal text-gray-400">(clic para insertar)</span></p>
                <div className="flex flex-wrap gap-1.5">
                  {Object.entries(current.vars).map(([name, desc]) => (
                    <button key={name} type="button" title={desc} onClick={() => insertVar(name)}
                      className="rounded-md border border-gray-200 bg-gray-50 px-2 py-1 font-mono text-[11px] text-gray-700 hover:border-blue-300 hover:bg-blue-50">
                      {`{{${name}}}`}
                    </button>
                  ))}
                </div>
                <ul className="mt-2 space-y-0.5 text-[11px] text-gray-500">
                  {Object.entries(current.vars).map(([name, desc]) => <li key={name}><span className="font-mono">{name}</span>: {desc}</li>)}
                </ul>
              </div>

              {notice && <p className={`text-sm ${notice.ok ? 'text-green-700' : 'text-red-600'}`}>{notice.text}</p>}

              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={save} disabled={busy || !dirty || !!previewError} className={btnPrimary}>
                  {busy ? 'Guardando…' : 'Guardar'}
                </button>
                {dirty && <button type="button" onClick={() => setDraft({ ...current.current })} disabled={busy} className={btnSecondary}>Descartar cambios</button>}
                {current.customized && <button type="button" onClick={reset} disabled={busy} className={btnSecondary}>Restaurar texto original</button>}
              </div>
              {current.customized && current.updatedAt && (
                <p className="text-[11px] text-gray-400">
                  Modificado el {new Date(current.updatedAt).toLocaleString('es-CL')}{current.updatedByName ? ` por ${current.updatedByName}` : ''}.
                </p>
              )}
            </div>
          </div>

          {/* Vista previa */}
          <div className="min-w-0">
            <div className="mb-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm">
              <span className="text-gray-400">Asunto: </span>
              <span className="text-gray-800">{preview?.subject ?? '…'}</span>
            </div>
            {previewError
              ? <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{previewError}</p>
              : preview && <EmailPreview html={preview.html} />}
            <p className="mt-1 text-[11px] text-gray-400">Vista previa con datos de ejemplo.</p>
            <div className="mt-3 flex flex-wrap items-end gap-2">
              <div className="min-w-[200px] flex-1">
                <label className="mb-1 block text-xs font-medium text-gray-600">Enviar prueba a</label>
                <input type="email" value={testTo} onChange={(e) => setTestTo(e.target.value)} className={inputCls} />
              </div>
              <button type="button" onClick={sendTest} disabled={busy || !testTo.trim() || !!previewError} className={btnSecondary}>Enviar prueba</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
