'use client';

import { useEffect, useState } from 'react';
import { getToken } from '@/lib/auth';
import { api } from '@/lib/api';
import { PageHeader, SectionCard, StatRow, StatTile, Badge, BrandButton } from '@/components/ui';
import { useMlCompany } from '../MlCompanyContext';

const TABS = [
  { key: 'UNANSWERED', label: 'Sin responder' },
  { key: 'ANSWERED', label: 'Respondidas' },
  { key: 'ALL', label: 'Todas' },
] as const;

export default function MlPreguntasPage() {
  const { companyId } = useMlCompany();
  const [tab, setTab] = useState<typeof TABS[number]['key']>('UNANSWERED');
  const [data, setData] = useState<{ questions: any[]; unanswered: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [flash, setFlash] = useState<{ msg: string; ok: boolean } | null>(null);
  const [connections, setConnections] = useState<any[]>([]);
  const [syncConnId, setSyncConnId] = useState('');
  const [syncing, setSyncing] = useState(false);

  async function load() {
    const token = getToken();
    if (!token) return;
    setLoading(true);
    try {
      setData(await api.marketplace.questions(token, tab, companyId));
    } catch (err: any) {
      setFlash({ msg: err.message || 'No se pudieron cargar las preguntas.', ok: false });
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [tab, companyId]);

  useEffect(() => {
    const token = getToken();
    if (!token) return;
    api.marketplace.connections(token, companyId).then((conns) => {
      setConnections(conns);
      if (conns[0]) setSyncConnId(conns[0].id);
    }).catch(() => {});
  }, [companyId]);

  async function answer(externalId: string) {
    const text = (drafts[externalId] || '').trim();
    if (!text) return;
    setBusyId(externalId);
    try {
      await api.marketplace.answerQuestion(externalId, text, getToken()!);
      setDrafts((d) => { const n = { ...d }; delete n[externalId]; return n; });
      await load();
      setFlash({ msg: 'Respuesta enviada', ok: true });
      setTimeout(() => setFlash(null), 2000);
    } catch (err: any) {
      setFlash({ msg: err.message, ok: false });
      setTimeout(() => setFlash(null), 3000);
    } finally {
      setBusyId(null);
    }
  }

  async function syncNow() {
    if (!syncConnId) return;
    setSyncing(true);
    try {
      const res = await api.marketplace.syncQuestions(syncConnId, getToken()!);
      await load();
      setFlash({ msg: `${res.synced} pregunta(s) sincronizada(s)`, ok: true });
      setTimeout(() => setFlash(null), 2500);
    } catch (err: any) {
      setFlash({ msg: err.message, ok: false });
      setTimeout(() => setFlash(null), 3000);
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Preguntas de Mercado Libre"
        crumbs={[{ label: 'Inicio', href: '/dashboard' }, { label: 'Mercado Libre' }, { label: 'Preguntas' }]}
      />

      {data && (
        <StatRow>
          <StatTile label="Sin responder" value={data.unanswered} tone={data.unanswered > 0 ? 'warn' : undefined} />
        </StatRow>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 my-4">
        <div className="flex gap-2">
          {TABS.map((t) => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`px-3.5 py-1.5 rounded-lg text-sm font-medium ${tab === t.key ? 'bg-[var(--brand-light)] text-[var(--brand-ink)]' : 'text-[var(--text-2)] hover:bg-[var(--surface-soft)]'}`}>
              {t.label}
            </button>
          ))}
        </div>
        {connections.length > 0 && (
          <div className="flex items-center gap-2">
            {connections.length > 1 && (
              <select value={syncConnId} onChange={(e) => setSyncConnId(e.target.value)}
                className="px-2.5 py-1.5 border border-[var(--border)] rounded-lg text-xs bg-white">
                {connections.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            )}
            <button onClick={syncNow} disabled={syncing}
              className="px-3 py-1.5 border border-[var(--border)] rounded-lg text-xs text-[var(--text-2)] hover:bg-[var(--surface-soft)] disabled:opacity-50">
              {syncing ? 'Sincronizando…' : 'Sincronizar ahora'}
            </button>
          </div>
        )}
      </div>

      {flash && (
        <div className={`mb-4 px-4 py-2 rounded-lg text-sm ${flash.ok ? 'text-[var(--ok)] bg-[var(--ok-bg)]' : 'text-[var(--danger)] bg-[var(--danger-bg)]'}`}>{flash.msg}</div>
      )}

      {loading ? (
        <p className="text-sm text-[var(--text-muted)] py-8 text-center">Cargando…</p>
      ) : (data?.questions || []).length === 0 ? (
        <SectionCard><p className="text-sm text-[var(--text-muted)] text-center py-6">Sin preguntas para mostrar</p></SectionCard>
      ) : (
        <div className="space-y-3">
          {data!.questions.map((q: any) => (
            <SectionCard key={q.id}
              title={q.product?.name || q.itemTitle || q.itemId}
              actions={q.status === 'UNANSWERED' ? <Badge tone="warn">Sin responder</Badge> : q.status === 'ANSWERED' ? <Badge tone="ok">Respondida</Badge> : <Badge tone="neutral">{q.status}</Badge>}>
              <p className="text-xs text-[var(--text-muted)] -mt-2 mb-2">
                {q.product?.sku ? `SKU ${q.product.sku} · ` : ''}{new Date(q.dateCreated).toLocaleString('es-CL')}
              </p>
              <p className="text-sm text-[var(--text)] mb-3">"{q.text}"</p>
              {q.status === 'ANSWERED' ? (
                <p className="text-sm text-[var(--text-2)] bg-[var(--surface-soft)] rounded-lg px-3 py-2">
                  <strong className="text-[var(--text)]">Tu respuesta:</strong> {q.answerText}
                </p>
              ) : (
                <div className="flex gap-2">
                  <input
                    value={drafts[q.externalId] || ''}
                    onChange={(e) => setDrafts((d) => ({ ...d, [q.externalId]: e.target.value }))}
                    onKeyDown={(e) => { if (e.key === 'Enter') answer(q.externalId); }}
                    placeholder="Escribe la respuesta…"
                    className="flex-1 px-3 py-2 border border-[var(--border)] rounded-lg text-sm bg-white" />
                  <BrandButton onClick={() => answer(q.externalId)} disabled={busyId === q.externalId || !(drafts[q.externalId] || '').trim()}>
                    {busyId === q.externalId ? 'Enviando…' : 'Responder'}
                  </BrandButton>
                </div>
              )}
            </SectionCard>
          ))}
        </div>
      )}
    </div>
  );
}
