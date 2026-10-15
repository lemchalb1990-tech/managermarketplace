'use client';

import { useEffect, useRef, useState } from 'react';
import { api, apiBlobUrl, apiOpenPdf, type MlChatFile, type MlConversationFull } from '@/lib/api';
import { getToken } from '@/lib/auth';

const MAX = 350; // límite de Mercado Libre para mensajes postventa
const MAX_FILE_MB = 25; // límite de Mercado Libre por archivo
const MAX_FILES = 10;
const ACCEPT = 'image/jpeg,image/png,image/gif,image/webp,application/pdf,text/plain,.doc,.docx,.xls,.xlsx';
const QUICK_KEY = 'ml-quick-replies';
const DEFAULT_QUICK = [
  'Hola, gracias por tu compra. Tu pedido sale hoy.',
  'Tu pedido ya va en camino.',
  'Adjuntamos tu boleta en la siguiente respuesta.',
];

function loadQuick(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(QUICK_KEY) || 'null');
    return Array.isArray(v) && v.length ? v : DEFAULT_QUICK;
  } catch {
    return DEFAULT_QUICK;
  }
}

const fmt = (d: string) => new Date(d).toLocaleString('es-CL', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
const isImage = (f: { name: string; type: string | null }) => /^image\//.test(f.type || '') || /\.(jpe?g|png|gif|webp)$/i.test(f.name);
const sizeLabel = (n: number | null) => (n == null ? '' : n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

type Pending = { key: string; file: File; preview: string | null; uploaded: MlChatFile | null; progress: number; error: string };

function PaperclipIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m21.4 11.1-9.2 9.2a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5" />
    </svg>
  );
}

function FileIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" /><path d="M14 3v6h6" />
    </svg>
  );
}

/** Adjunto de un mensaje: miniatura si es imagen, ficha con nombre si es documento. Abre el archivo. */
function Attachment({ conversationId, file, mine }: { conversationId: string; file: MlChatFile; mine: boolean }) {
  const [thumb, setThumb] = useState<string | null>(null);
  const image = isImage(file);
  const path = api.marketplace.messages.attachmentPath(conversationId, file.id);

  useEffect(() => {
    if (!image) return;
    let url: string | null = null;
    let alive = true;
    apiBlobUrl(path, getToken()!).then((u) => { url = u; if (alive) setThumb(u); else URL.revokeObjectURL(u); }).catch(() => null);
    return () => { alive = false; if (url) URL.revokeObjectURL(url); };
  }, [path, image]);

  const open = () => apiOpenPdf(path, getToken()!).catch(() => null);

  if (image) {
    return (
      <button type="button" onClick={open} title={file.name}
        className="block h-28 w-36 overflow-hidden rounded-lg bg-black/5">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {thumb ? <img src={thumb} alt={file.name} className="h-full w-full object-cover" /> : <span className="grid h-full place-items-center text-[10px] opacity-60">Cargando…</span>}
      </button>
    );
  }
  return (
    <button type="button" onClick={open} title={file.name}
      className={`flex max-w-[240px] items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs ${mine ? 'bg-white/10 hover:bg-white/20' : 'bg-gray-50 hover:bg-gray-100'}`}>
      <FileIcon />
      <span className="min-w-0">
        <span className="block truncate font-medium">{file.name}</span>
        {file.size != null && <span className="block text-[10px] opacity-70">{sizeLabel(file.size)}</span>}
      </span>
    </button>
  );
}

/** Conversación con el comprador de Mercado Libre: historial completo, adjuntos, respuestas rápidas y envío. */
export function MlChat({ conversation, onChange, compact = false }: {
  conversation: MlConversationFull;
  onChange: (c: MlConversationFull) => void;
  compact?: boolean;
}) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [quick, setQuick] = useState<string[]>(DEFAULT_QUICK);
  const [editingQuick, setEditingQuick] = useState(false);
  const [pending, setPending] = useState<Pending[]>([]);
  const endRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const msgs = conversation.messages || [];

  useEffect(() => {
    const id = requestAnimationFrame(() => setQuick(loadQuick()));
    return () => cancelAnimationFrame(id);
  }, []);
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }); }, [msgs.length, conversation.id]);

  // Al cambiar de conversación se descartan los adjuntos sin enviar.
  useEffect(() => {
    const id = requestAnimationFrame(() => setPending((p) => { p.forEach((x) => x.preview && URL.revokeObjectURL(x.preview)); return []; }));
    return () => cancelAnimationFrame(id);
  }, [conversation.id]);

  const patch = (key: string, data: Partial<Pending>) => setPending((p) => p.map((x) => (x.key === key ? { ...x, ...data } : x)));

  function addFiles(list: FileList | null) {
    if (!list?.length) return;
    setError('');
    const room = MAX_FILES - pending.length;
    const files = Array.from(list).slice(0, Math.max(0, room));
    if (list.length > room) setError(`Puedes adjuntar hasta ${MAX_FILES} archivos por mensaje.`);
    for (const file of files) {
      const key = `${file.name}-${file.size}-${Math.random().toString(36).slice(2)}`;
      if (file.size > MAX_FILE_MB * 1024 * 1024) {
        setError(`"${file.name}" supera los ${MAX_FILE_MB} MB que permite Mercado Libre.`);
        continue;
      }
      const preview = isImage({ name: file.name, type: file.type }) ? URL.createObjectURL(file) : null;
      setPending((p) => [...p, { key, file, preview, uploaded: null, progress: 0, error: '' }]);
      api.marketplace.messages.uploadAttachment(conversation.id, file, getToken()!, (pct) => patch(key, { progress: pct }))
        .then((uploaded) => patch(key, { uploaded, progress: 100 }))
        .catch((e) => patch(key, { error: (e as Error).message || 'No se pudo subir' }));
    }
    if (fileRef.current) fileRef.current.value = '';
  }

  function removePending(key: string) {
    setPending((p) => {
      const x = p.find((y) => y.key === key);
      if (x?.preview) URL.revokeObjectURL(x.preview);
      return p.filter((y) => y.key !== key);
    });
  }

  const uploading = pending.some((p) => !p.uploaded && !p.error);
  const ready = pending.filter((p) => p.uploaded).map((p) => p.uploaded!.id);
  const canSend = !busy && !uploading && (!!text.trim() || ready.length > 0);

  async function send() {
    if (!canSend) return;
    setBusy(true);
    setError('');
    try {
      const updated = await api.marketplace.messages.send(conversation.id, text.trim(), getToken()!, ready);
      setText('');
      pending.forEach((p) => p.preview && URL.revokeObjectURL(p.preview));
      setPending([]);
      onChange(updated);
    } catch (e) {
      setError((e as Error).message || 'No se pudo enviar');
    } finally {
      setBusy(false);
    }
  }

  function saveQuick(list: string[]) {
    setQuick(list);
    try { localStorage.setItem(QUICK_KEY, JSON.stringify(list)); } catch { /* sin almacenamiento */ }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className={`flex-1 min-h-0 overflow-y-auto space-y-2 rounded-xl bg-[var(--page-bg)] p-3 ${compact ? 'max-h-72' : ''}`}>
        {msgs.length === 0 && (
          <p className="py-8 text-center text-xs text-gray-400">
            Sin mensajes todavía. Puedes escribirle al comprador; Mercado Libre lo envía como inicio de conversación.
          </p>
        )}
        {msgs.map((m) => {
          const mine = m.from === 'SELLER';
          const files = m.files || [];
          // Mensajes guardados antes de que existieran los ids de archivo: solo se conoce el nombre.
          const legacy = !files.length ? (m.attachments || []) : [];
          return (
            <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm ${mine ? 'rounded-br-md bg-[var(--navy)] text-white' : 'rounded-bl-md border border-gray-200 bg-white text-gray-800'}`}>
                {m.text && <p className="whitespace-pre-wrap break-words">{m.text}</p>}
                {files.length > 0 && (
                  <div className={`flex flex-wrap gap-1.5 ${m.text ? 'mt-2' : ''}`}>
                    {files.map((f) => <Attachment key={f.id} conversationId={conversation.id} file={f} mine={mine} />)}
                  </div>
                )}
                {legacy.length > 0 && <p className="mt-1 text-[11px] opacity-70">Adjuntos: {legacy.join(', ')}</p>}
                <p className={`mt-1 text-[10px] ${mine ? 'text-white/60' : 'text-gray-400'}`}>{fmt(m.date)}</p>
              </div>
            </div>
          );
        })}
        <div ref={endRef} />
      </div>

      {conversation.blocked ? (
        <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Mercado Libre tiene bloqueada la mensajería de esta venta{conversation.blockedReason ? ` (${conversation.blockedReason})` : ''}. En ventas Full se habilita al entregarse el paquete.
        </p>
      ) : (
        <div className="mt-3 space-y-2">
          <div className="flex flex-wrap items-center gap-1.5">
            {quick.map((q) => (
              <button key={q} type="button" onClick={() => setText(q.slice(0, MAX))}
                className="max-w-[220px] truncate rounded-full border border-gray-200 bg-white px-2.5 py-1 text-[11px] text-gray-600 hover:bg-gray-50" title={q}>
                {q}
              </button>
            ))}
            <button type="button" onClick={() => setEditingQuick((v) => !v)} className="text-[11px] font-medium text-[var(--brand)] hover:underline">
              {editingQuick ? 'Listo' : 'Editar respuestas rápidas'}
            </button>
          </div>
          {editingQuick && (
            <textarea defaultValue={quick.join('\n')} rows={3}
              onBlur={(e) => saveQuick(e.target.value.split('\n').map((s) => s.trim()).filter(Boolean))}
              placeholder="Una respuesta por línea"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-xs" />
          )}

          {pending.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {pending.map((p) => (
                <div key={p.key} className={`relative flex items-center gap-2 rounded-lg border px-2 py-1.5 text-xs ${p.error ? 'border-red-200 bg-red-50 text-red-700' : 'border-gray-200 bg-white text-gray-700'}`}>
                  {p.preview
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <img src={p.preview} alt="" className="h-9 w-9 rounded object-cover" />
                    : <span className="grid h-9 w-9 place-items-center rounded bg-gray-100 text-gray-500"><FileIcon /></span>}
                  <span className="min-w-0 max-w-[160px]">
                    <span className="block truncate font-medium">{p.file.name}</span>
                    <span className="block text-[10px] opacity-70">
                      {p.error ? p.error : p.uploaded ? sizeLabel(p.file.size) : `Subiendo… ${Math.round(p.progress)}%`}
                    </span>
                  </span>
                  <button type="button" onClick={() => removePending(p.key)} aria-label={`Quitar ${p.file.name}`}
                    className="ml-1 rounded px-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700">×</button>
                </div>
              ))}
            </div>
          )}

          <div
            className="flex items-end gap-2"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); addFiles(e.dataTransfer.files); }}
          >
            <input ref={fileRef} type="file" multiple accept={ACCEPT} className="hidden" onChange={(e) => addFiles(e.target.files)} />
            <button type="button" onClick={() => fileRef.current?.click()} disabled={pending.length >= MAX_FILES}
              title="Adjuntar fotos o documentos" aria-label="Adjuntar fotos o documentos"
              className="mb-4 grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-gray-300 bg-white text-gray-600 hover:bg-gray-50 disabled:opacity-40">
              <PaperclipIcon />
            </button>
            <div className="flex-1">
              <textarea value={text} onChange={(e) => setText(e.target.value.slice(0, MAX))} rows={2}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
                onPaste={(e) => { if (e.clipboardData.files.length) { e.preventDefault(); addFiles(e.clipboardData.files); } }}
                placeholder="Escribe un mensaje al comprador… (puedes arrastrar o pegar fotos)" className="w-full resize-none rounded-lg border border-gray-300 px-3 py-2 text-sm" />
              <p className={`text-right text-[10px] ${text.length >= MAX ? 'text-red-600' : 'text-gray-400'}`}>{text.length}/{MAX}</p>
            </div>
            <button type="button" onClick={send} disabled={!canSend}
              className="mb-4 rounded-lg bg-[var(--navy)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--navy-2)] disabled:opacity-40">
              {busy ? 'Enviando…' : uploading ? 'Subiendo…' : 'Enviar'}
            </button>
          </div>
          {error && <p className="text-xs text-red-600">{error}</p>}
        </div>
      )}
    </div>
  );
}
