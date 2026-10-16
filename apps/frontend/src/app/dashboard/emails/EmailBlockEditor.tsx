'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { api, type CompanyEmailTemplate, type EmailBlock } from '@/lib/api';
import { btnPrimary, btnSecondary, inputCls } from '@/components/ui/Modal';
import { confirmDialog } from '../ConfirmDialog';
import { EmailPreview } from '../correos-plataforma/EmailPreview';
import { BLOCK_META, EMAIL_VARS, blocksToDisplay, blocksToRaw, newBlock, toDisplay, toRaw } from './emailVars';

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const BLOCK_ORDER: EmailBlock['type'][] = ['title', 'text', 'note', 'items', 'total', 'delivery', 'button', 'image', 'divider'];
const TONES = [
  { value: 'info', label: 'Informativo (azul)' },
  { value: 'success', label: 'Positivo (verde)' },
  { value: 'warning', label: 'Aviso (amarillo)' },
] as const;

// Campo donde se insertan las variables: el último que tuvo el foco, identificado por su
// atributo data-field ("subject" o "<n° de bloque>:text|label").
type FieldEl = HTMLInputElement | HTMLTextAreaElement;

interface Props {
  template: CompanyEmailTemplate;
  token: string;
  defaultTestTo: string;
  // remount = volver a cargar el editor desde el servidor (al restaurar el original).
  onSaved: (remount?: boolean) => Promise<void>;
}

export default function EmailBlockEditor({ template, token, defaultTestTo, onSaved }: Props) {
  const initial = useMemo(() => ({
    subject: toDisplay(template.subject),
    blocks: blocksToDisplay(template.blocks ?? template.defaultBlocks),
    active: template.active,
    mode: template.mode,
    bodyHtml: template.bodyHtml ?? '',
  }), [template]);

  const [subject, setSubject] = useState(initial.subject);
  const [blocks, setBlocks] = useState<EmailBlock[]>(initial.blocks);
  const [active, setActive] = useState(initial.active);
  const [mode, setMode] = useState(initial.mode);
  const [bodyHtml, setBodyHtml] = useState(initial.bodyHtml);
  const [preview, setPreview] = useState<{ subject: string; html: string } | null>(null);
  const [previewError, setPreviewError] = useState('');
  const [device, setDevice] = useState<'desktop' | 'mobile'>('desktop');
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [testTo, setTestTo] = useState(defaultTestTo);
  const lastField = useRef('subject');
  const rootRef = useRef<HTMLDivElement>(null);
  const dragFrom = useRef<number | null>(null);

  const draft = useMemo(() => (mode === 'blocks'
    ? { subject: toRaw(subject), blocks: blocksToRaw(blocks) }
    : { subject: toRaw(subject), bodyHtml }), [mode, subject, blocks, bodyHtml]);

  const dirty = JSON.stringify({ subject, blocks, active, mode, bodyHtml }) !== JSON.stringify(initial);

  // Vista previa en vivo con datos de ejemplo (la arma el servidor, igual que el correo real).
  useEffect(() => {
    const id = setTimeout(() => {
      api.email.previewTemplate(draft, token)
        .then((p) => { setPreview(p); setPreviewError(''); })
        .catch((e) => setPreviewError(msg(e)));
    }, 350);
    return () => clearTimeout(id);
  }, [draft, token]);

  function updateBlock(index: number, patch: Partial<EmailBlock>) {
    setBlocks((list) => list.map((b, i) => (i === index ? ({ ...b, ...patch } as EmailBlock) : b)));
  }

  function move(from: number, to: number) {
    if (to < 0 || to >= blocks.length || from === to) return;
    setBlocks((list) => {
      const next = [...list];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      return next;
    });
  }

  function insertVar(label: string) {
    const token = `[${label}]`;
    const find = (key: string) => rootRef.current?.querySelector<FieldEl>(`[data-field="${key}"]`) ?? null;
    let key = lastField.current;
    let el = find(key);
    // Si el último campo ya no existe (bloque quitado), se inserta en el asunto.
    if (!el) { key = 'subject'; el = find(key); }
    const current = el?.value ?? '';
    const start = el?.selectionStart ?? current.length;
    const end = el?.selectionEnd ?? current.length;
    const value = current.slice(0, start) + token + current.slice(end);
    if (key === 'subject') setSubject(value);
    else {
      const [index, field] = key.split(':');
      updateBlock(Number(index), { [field]: value } as Partial<EmailBlock>);
    }
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      const caret = start + token.length;
      el.setSelectionRange(caret, caret);
    });
  }

  async function save() {
    setBusy(true); setNotice(null);
    try {
      await api.email.saveTemplate(template.type, { ...draft, active }, token);
      await onSaved();
      setNotice({ ok: true, text: 'Correo guardado' });
    } catch (e) { setNotice({ ok: false, text: msg(e) }); }
    finally { setBusy(false); }
  }

  async function reset() {
    if (!(await confirmDialog('El correo vuelve al diseño y texto originales del sistema.', { title: 'Restaurar original', confirmLabel: 'Restaurar' }))) return;
    setBusy(true); setNotice(null);
    try {
      await api.email.resetTemplate(template.type, token);
      await onSaved(true);
    } catch (e) { setNotice({ ok: false, text: msg(e) }); }
    finally { setBusy(false); }
  }

  async function convertToBlocks() {
    if (!(await confirmDialog('Se reemplaza el diseño HTML de este correo por el diseño por bloques del sistema. El cambio se aplica al guardar.', { title: 'Pasar al editor por bloques', confirmLabel: 'Pasar al editor' }))) return;
    setMode('blocks');
    setBlocks(blocksToDisplay(template.defaultBlocks));
  }

  async function sendTest() {
    setBusy(true); setNotice(null);
    try {
      await api.email.testTemplate(template.type, { ...draft, to: testTo.trim() }, token);
      setNotice({ ok: true, text: `Prueba enviada a ${testTo.trim()}` });
    } catch (e) { setNotice({ ok: false, text: msg(e) }); }
    finally { setBusy(false); }
  }

  return (
    <div ref={rootRef} className="bg-white border border-gray-200 rounded-2xl overflow-hidden"
      onFocus={(e) => { const k = (e.target as HTMLElement).dataset?.field; if (k) lastField.current = k; }}>
      {/* Encabezado */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 border-b border-gray-100">
        <div className="min-w-0">
          <p className="font-semibold text-gray-800">{template.label}</p>
          {dirty && <p className="text-xs text-amber-600">Cambios sin guardar</p>}
        </div>
        <button type="button" onClick={() => setActive((a) => !a)} className="flex items-center gap-2 text-sm text-gray-600">
          <span className={`w-9 h-5 rounded-full relative transition-colors ${active ? 'bg-blue-500' : 'bg-gray-300'}`}>
            <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${active ? 'translate-x-4' : 'translate-x-0.5'}`} />
          </span>
          {active ? 'Se envía' : 'No se envía'}
        </button>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-0 xl:divide-x divide-gray-100">
        {/* Columna de edición */}
        <div className="p-5 space-y-4 min-w-0">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Asunto</label>
            <input data-field="subject" value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={300} className={inputCls} />
          </div>

          <div className="rounded-xl border border-blue-100 bg-blue-50 p-3">
            <p className="text-xs text-blue-800 mb-2">Insertar dato del pedido en el campo donde estás escribiendo:</p>
            <div className="flex flex-wrap gap-1.5">
              {EMAIL_VARS.map((v) => (
                <button key={v.key} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => insertVar(v.label)}
                  className="text-xs bg-white border border-blue-200 text-blue-700 px-2 py-1 rounded-md hover:bg-blue-100">
                  + {v.label}
                </button>
              ))}
            </div>
          </div>

          {mode === 'html' ? (
            <div className="space-y-3">
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
                <p className="font-semibold">Este correo tiene un diseño HTML personalizado</p>
                <p className="mt-1">Se sigue enviando tal cual. Puedes pasarlo al editor por bloques para editarlo sin código.</p>
                <button type="button" onClick={convertToBlocks} className={`${btnPrimary} mt-3`}>Pasar al editor por bloques</button>
              </div>
              <details className="rounded-xl border border-gray-200">
                <summary className="cursor-pointer px-4 py-2.5 text-sm text-gray-600">Editar código HTML</summary>
                <textarea value={bodyHtml} onChange={(e) => setBodyHtml(e.target.value)} rows={14} spellCheck={false}
                  className="w-full border-t border-gray-200 px-3 py-2.5 text-xs font-mono focus:outline-none" />
              </details>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-xs font-medium text-gray-600">Contenido del correo</p>
              {blocks.map((b, i) => {
                const meta = BLOCK_META[b.type];
                return (
                  <div key={i}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => { if (dragFrom.current !== null) move(dragFrom.current, i); dragFrom.current = null; }}
                    className="rounded-xl border border-gray-200 bg-white">
                    <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-100 bg-gray-50 rounded-t-xl">
                      <span draggable onDragStart={() => { dragFrom.current = i; }} title="Arrastra para mover"
                        className="cursor-grab text-gray-400 select-none">⠿</span>
                      <span className="w-6 text-center text-sm">{meta.icon}</span>
                      <span className="flex-1 text-sm font-medium text-gray-700 truncate">{meta.label}</span>
                      <button type="button" onClick={() => move(i, i - 1)} disabled={i === 0} title="Subir" className="px-1.5 text-gray-500 hover:text-gray-800 disabled:opacity-30">↑</button>
                      <button type="button" onClick={() => move(i, i + 1)} disabled={i === blocks.length - 1} title="Bajar" className="px-1.5 text-gray-500 hover:text-gray-800 disabled:opacity-30">↓</button>
                      <button type="button" onClick={() => setBlocks((l) => l.filter((_, j) => j !== i))} title="Quitar" className="px-1.5 text-gray-400 hover:text-red-600">✕</button>
                    </div>
                    <div className="p-3">
                      {b.type === 'title' && (
                        <input data-field={`${i}:text`} value={b.text} maxLength={200}
                          onChange={(e) => updateBlock(i, { text: e.target.value })} className={inputCls} />
                      )}
                      {(b.type === 'text' || b.type === 'note') && (
                        <>
                          <textarea data-field={`${i}:text`} value={b.text} rows={3} maxLength={3000}
                            onChange={(e) => updateBlock(i, { text: e.target.value })} className={inputCls} />
                          <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
                            <p className="text-[11px] text-gray-400">Escribe **texto** para dejarlo en negrita.</p>
                            {b.type === 'note' && (
                              <select value={b.tone ?? 'info'} onChange={(e) => updateBlock(i, { tone: e.target.value as 'info' })}
                                className="text-xs border border-gray-300 rounded-md px-2 py-1 bg-white">
                                {TONES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                              </select>
                            )}
                          </div>
                        </>
                      )}
                      {(b.type === 'items' || b.type === 'total' || b.type === 'delivery' || b.type === 'divider') && (
                        <p className="text-xs text-gray-500">{meta.hint}.</p>
                      )}
                      {b.type === 'button' && (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          <input data-field={`${i}:label`} value={b.label} maxLength={60} placeholder="Texto del botón"
                            onChange={(e) => updateBlock(i, { label: e.target.value })} className={inputCls} />
                          <input value={b.url} placeholder="https://mitienda.cl" maxLength={500}
                            onChange={(e) => updateBlock(i, { url: e.target.value })} className={inputCls} />
                        </div>
                      )}
                      {b.type === 'image' && (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          <input value={b.url} placeholder="https://… enlace de la imagen" maxLength={800}
                            onChange={(e) => updateBlock(i, { url: e.target.value })} className={inputCls} />
                          <input value={b.alt ?? ''} placeholder="Descripción (opcional)" maxLength={120}
                            onChange={(e) => updateBlock(i, { alt: e.target.value })} className={inputCls} />
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}

              {adding ? (
                <div className="rounded-xl border border-dashed border-blue-300 p-3">
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {BLOCK_ORDER.map((t) => (
                      <button key={t} type="button" title={BLOCK_META[t].hint}
                        onClick={() => { setBlocks((l) => [...l, newBlock(t)]); setAdding(false); }}
                        className="flex items-center gap-2 rounded-lg border border-gray-200 px-2.5 py-2 text-left text-xs text-gray-700 hover:border-blue-400 hover:bg-blue-50">
                        <span className="w-5 text-center">{BLOCK_META[t].icon}</span>{BLOCK_META[t].label}
                      </button>
                    ))}
                  </div>
                  <button type="button" onClick={() => setAdding(false)} className="mt-2 text-xs text-gray-500 hover:text-gray-700">Cancelar</button>
                </div>
              ) : (
                <button type="button" onClick={() => setAdding(true)}
                  className="w-full rounded-xl border border-dashed border-gray-300 py-2.5 text-sm text-gray-600 hover:border-blue-400 hover:text-blue-600">
                  + Agregar bloque
                </button>
              )}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button type="button" onClick={save} disabled={busy || !dirty || !!previewError} className={btnPrimary}>
              {busy ? 'Guardando…' : 'Guardar'}
            </button>
            {template.isCustomized && (
              <button type="button" onClick={reset} disabled={busy} className={btnSecondary}>Restaurar original</button>
            )}
            {notice && <span className={`text-sm ${notice.ok ? 'text-green-600' : 'text-red-600'}`}>{notice.text}</span>}
          </div>
        </div>

        {/* Columna de vista previa */}
        <div className="p-5 bg-gray-50 min-w-0 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-medium text-gray-600">Vista previa con datos de ejemplo</p>
            <div className="flex rounded-lg border border-gray-200 bg-white p-0.5 text-xs">
              {(['desktop', 'mobile'] as const).map((d) => (
                <button key={d} type="button" onClick={() => setDevice(d)}
                  className={`px-2.5 py-1 rounded-md ${device === d ? 'bg-gray-900 text-white' : 'text-gray-500'}`}>
                  {d === 'desktop' ? 'Escritorio' : 'Celular'}
                </button>
              ))}
            </div>
          </div>
          <p className="text-sm truncate"><span className="text-gray-400">Asunto: </span><span className="text-gray-800">{preview?.subject ?? '…'}</span></p>
          {previewError
            ? <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{previewError}</p>
            : preview && (
              <div className={device === 'mobile' ? 'mx-auto max-w-[375px]' : ''}>
                <EmailPreview html={preview.html} height={device === 'mobile' ? 640 : 560} />
              </div>
            )}
          <div className="flex gap-2">
            <input type="email" value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder="correo@ejemplo.cl" className={inputCls} />
            <button type="button" onClick={sendTest} disabled={busy || !testTo.trim() || !!previewError} className={`${btnSecondary} shrink-0`}>Enviar prueba</button>
          </div>
          <p className="text-[11px] text-gray-400">La prueba usa tu servidor SMTP y lo que tienes en pantalla, aunque no esté guardado.</p>
        </div>
      </div>
    </div>
  );
}
