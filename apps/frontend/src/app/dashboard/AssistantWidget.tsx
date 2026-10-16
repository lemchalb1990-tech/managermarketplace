'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type AssistantMessageInfo } from '@/lib/api';
import { getToken } from '@/lib/auth';
import { useAdminCompany } from './AdminCompanyContext';

const SUGGESTIONS = [
  '¿Cuánto vendí hoy?',
  '¿Qué productos están bajo stock crítico?',
  '¿Quién me debe?',
  '¿Qué órdenes están atrasadas?',
];

type Msg = Pick<AssistantMessageInfo, 'role' | 'text'> & { id: string; viaVoice?: boolean; pending?: boolean };

// Negritas con **texto** (lo único de formato que se interpreta; el resto va como texto plano).
function RichText({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return <>{parts.map((p, i) => (p.startsWith('**') && p.endsWith('**') ? <strong key={i}>{p.slice(2, -2)}</strong> : <span key={i}>{p}</span>))}</>;
}

/**
 * Asistente con IA (módulo «asistente_ia»): botón flotante y chat de consultas. Solo aparece si el
 * servidor confirma que la empresa tiene el módulo y el usuario el permiso (GET /assistant/status).
 */
export function AssistantWidget({ user }: { user: { id?: string; role?: string } | null }) {
  const { companyId, selectedCompanyId } = useAdminCompany();
  const [enabled, setEnabled] = useState(false);
  const [open, setOpen] = useState(false);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const listRef = useRef<HTMLDivElement>(null);
  const storeKey = `assistant_conv_${user?.id || ''}_${companyId || ''}`;

  // ¿Está habilitado para esta empresa y usuario?
  useEffect(() => {
    const t = getToken();
    let alive = true;
    if (!t || !user || (user.role === 'SUPER_ADMIN' && !selectedCompanyId)) {
      const id = requestAnimationFrame(() => setEnabled(false));
      return () => { alive = false; cancelAnimationFrame(id); };
    }
    api.assistant.status(t, companyId)
      .then((s) => { if (alive) { setEnabled(s.enabled); setRemaining(s.remaining); } })
      .catch(() => { if (alive) setEnabled(false); });
    return () => { alive = false; };
  }, [user, companyId, selectedCompanyId]);

  // Retoma la última conversación al abrir.
  useEffect(() => {
    if (!open || conversationId !== null) return;
    let saved = '';
    try { saved = localStorage.getItem(storeKey) || ''; } catch { /* sin almacenamiento */ }
    if (!saved) return;
    api.assistant.conversation(saved, getToken()!)
      .then((c) => { setConversationId(c.id); setMessages(c.messages.map((m) => ({ id: m.id, role: m.role, text: m.text, viaVoice: m.viaVoice }))); })
      .catch(() => { try { localStorage.removeItem(storeKey); } catch { /* sin almacenamiento */ } });
  }, [open, conversationId, storeKey]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, open]);

  useEffect(() => {
    if (!recording) return;
    const h = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(h);
  }, [recording]);

  const send = useCallback(async (raw: string, viaVoice = false) => {
    const q = raw.trim();
    if (!q || busy) return;
    setError('');
    setBusy(true);
    setText('');
    const tempId = `t${Date.now()}`;
    setMessages((m) => [...m, { id: `u${tempId}`, role: 'user', text: q, viaVoice }, { id: tempId, role: 'assistant', text: 'Consultando…', pending: true }]);
    try {
      const r = await api.assistant.ask({ companyId, conversationId, text: q, viaVoice }, getToken()!);
      setConversationId(r.conversationId);
      setRemaining(r.remaining);
      try { localStorage.setItem(storeKey, r.conversationId); } catch { /* sin almacenamiento */ }
      setMessages((m) => m.map((x) => (x.id === tempId ? { id: tempId, role: 'assistant', text: r.reply } : x)));
    } catch (e) {
      setMessages((m) => m.filter((x) => x.id !== tempId));
      setError((e as Error).message || 'No se pudo consultar');
    } finally {
      setBusy(false);
    }
  }, [busy, companyId, conversationId, storeKey]);

  function newConversation() {
    setConversationId(null);
    setMessages([]);
    setError('');
    try { localStorage.removeItem(storeKey); } catch { /* sin almacenamiento */ }
  }

  async function toggleRecording() {
    if (recording) {
      recorder.current?.stop();
      return;
    }
    setError('');
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setError('Tu navegador no permite grabar audio');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'].find((m) => MediaRecorder.isTypeSupported(m));
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      chunks.current = [];
      rec.ondataavailable = (e) => { if (e.data.size) chunks.current.push(e.data); };
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setRecording(false);
        const blob = new Blob(chunks.current, { type: rec.mimeType || 'audio/webm' });
        if (blob.size < 1000) { setError('La nota de voz quedó vacía'); return; }
        setBusy(true);
        try {
          const { text: heard } = await api.assistant.transcribe(blob, getToken()!, companyId);
          setBusy(false);
          await send(heard, true);
        } catch (e) {
          setBusy(false);
          setError((e as Error).message || 'No se pudo transcribir');
        }
      };
      recorder.current = rec;
      rec.start();
      setSeconds(0);
      setRecording(true);
    } catch {
      setError('No se pudo usar el micrófono (revisa el permiso del navegador)');
    }
  }

  if (!enabled) return null;

  return (
    <>
      {open && (
        <div role="dialog" aria-label="Asistente con IA"
          className="fixed bottom-20 right-4 z-40 flex h-[min(70vh,600px)] w-[min(calc(100vw-2rem),400px)] flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl">
          <div className="flex items-center justify-between gap-2 border-b border-gray-100 bg-[var(--navy)] px-4 py-3 text-white">
            <div className="min-w-0">
              <p className="text-sm font-semibold">Asistente</p>
              <p className="text-[11px] opacity-75">Consultas sobre los datos de tu empresa{remaining != null ? ` · ${remaining} este mes` : ''}</p>
            </div>
            <div className="flex items-center gap-1">
              <button type="button" onClick={newConversation} className="rounded-lg px-2 py-1 text-xs hover:bg-white/10">Nueva</button>
              <button type="button" onClick={() => setOpen(false)} aria-label="Cerrar asistente" className="rounded-lg px-2 py-1 text-lg leading-none hover:bg-white/10">✕</button>
            </div>
          </div>

          <div ref={listRef} className="flex-1 space-y-3 overflow-y-auto bg-gray-50 px-3 py-3">
            {messages.length === 0 && (
              <div className="space-y-2 pt-2">
                <p className="text-center text-sm text-gray-500">Pregúntame por tus ventas, stock, órdenes o deudores. También puedes dictar.</p>
                <div className="flex flex-wrap justify-center gap-1.5">
                  {SUGGESTIONS.map((s) => (
                    <button key={s} type="button" onClick={() => send(s)} disabled={busy}
                      className="rounded-full border border-gray-200 bg-white px-3 py-1.5 text-xs text-gray-700 hover:border-blue-300 hover:text-blue-700 disabled:opacity-50">{s}</button>
                  ))}
                </div>
              </div>
            )}
            {messages.map((m) => (
              <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm ${m.role === 'user' ? 'rounded-br-md bg-blue-600 text-white' : `rounded-bl-md bg-white text-gray-800 shadow-sm ${m.pending ? 'animate-pulse text-gray-400' : ''}`}`}>
                  {m.viaVoice && <span className="mr-1" aria-label="Nota de voz">🎙️</span>}
                  <RichText text={m.text} />
                </div>
              </div>
            ))}
          </div>

          {error && <p className="border-t border-red-100 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
          <form onSubmit={(e) => { e.preventDefault(); send(text); }} className="flex items-end gap-2 border-t border-gray-100 p-2">
            <textarea value={text} onChange={(e) => setText(e.target.value)} rows={1} maxLength={2000} disabled={busy || recording}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(text); } }}
              placeholder={recording ? `Grabando… ${seconds}s (toca para terminar)` : 'Escribe tu pregunta…'}
              className="max-h-28 min-h-[40px] flex-1 resize-none rounded-xl border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50" />
            <button type="button" onClick={toggleRecording} disabled={busy && !recording}
              aria-label={recording ? 'Terminar grabación' : 'Dictar una nota de voz'}
              className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${recording ? 'animate-pulse bg-red-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'} disabled:opacity-50`}>
              {recording ? '■' : '🎙️'}
            </button>
            <button type="submit" disabled={busy || recording || !text.trim()} aria-label="Enviar"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">➤</button>
          </form>
        </div>
      )}
      <button type="button" onClick={() => setOpen((o) => !o)} aria-label={open ? 'Cerrar asistente' : 'Abrir asistente con IA'}
        className="fixed bottom-4 right-4 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-[var(--navy)] text-2xl text-white shadow-lg transition hover:scale-105">
        {open ? '✕' : '✨'}
      </button>
    </>
  );
}
