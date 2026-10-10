'use client';

import { useEffect, useRef, useState } from 'react';
import { api, type MlConversationFull } from '@/lib/api';
import { getToken } from '@/lib/auth';

const MAX = 350; // límite de Mercado Libre para mensajes postventa
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

/** Conversación con el comprador de Mercado Libre: mensajes, respuestas rápidas y envío. */
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
  const endRef = useRef<HTMLDivElement>(null);
  const msgs = conversation.messages || [];

  useEffect(() => {
    const id = requestAnimationFrame(() => setQuick(loadQuick()));
    return () => cancelAnimationFrame(id);
  }, []);
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }); }, [msgs.length, conversation.id]);

  async function send() {
    if (!text.trim()) return;
    setBusy(true);
    setError('');
    try {
      const updated = await api.marketplace.messages.send(conversation.id, text.trim(), getToken()!);
      setText('');
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
        {msgs.map((m) => (
          <div key={m.id} className={`flex ${m.from === 'SELLER' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm ${m.from === 'SELLER' ? 'rounded-br-md bg-[var(--navy)] text-white' : 'rounded-bl-md border border-gray-200 bg-white text-gray-800'}`}>
              <p className="whitespace-pre-wrap break-words">{m.text}</p>
              {!!m.attachments?.length && <p className="mt-1 text-[11px] opacity-70">📎 {m.attachments.join(', ')}</p>}
              <p className={`mt-1 text-[10px] ${m.from === 'SELLER' ? 'text-white/60' : 'text-gray-400'}`}>{fmt(m.date)}</p>
            </div>
          </div>
        ))}
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
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <textarea value={text} onChange={(e) => setText(e.target.value.slice(0, MAX))} rows={2}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
                placeholder="Escribe un mensaje al comprador…" className="w-full resize-none rounded-lg border border-gray-300 px-3 py-2 text-sm" />
              <p className={`text-right text-[10px] ${text.length >= MAX ? 'text-red-600' : 'text-gray-400'}`}>{text.length}/{MAX}</p>
            </div>
            <button type="button" onClick={send} disabled={busy || !text.trim()}
              className="mb-4 rounded-lg bg-[var(--navy)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--navy-2)] disabled:opacity-40">
              {busy ? 'Enviando…' : 'Enviar'}
            </button>
          </div>
          {error && <p className="text-xs text-red-600">{error}</p>}
        </div>
      )}
    </div>
  );
}
