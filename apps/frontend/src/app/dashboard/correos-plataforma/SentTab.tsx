'use client';

import { useEffect, useState } from 'react';
import { getToken } from '@/lib/auth';
import { api, type EmailLogDetail, type EmailLogPage } from '@/lib/api';
import { FilterBar, FilterCount, FilterField, filterInputCls, filterSelectCls } from '@/components/FilterBar';
import { btnSecondary } from '@/components/ui/Modal';
import { EmailPreview } from './EmailPreview';

const when = (d: string) => new Date(d).toLocaleString('es-CL', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const empty = { search: '', status: '', companyId: '', type: '', channel: '', from: '', to: '' };

function StatusBadge({ status }: { status: string }) {
  return status === 'SENT'
    ? <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">Enviado</span>
    : <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">Fallido</span>;
}

export function SentTab() {
  const [f, setF] = useState(empty);
  const [applied, setApplied] = useState(empty);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<EmailLogPage | null>(null);
  const [error, setError] = useState('');
  const [companies, setCompanies] = useState<{ id: string; name: string }[]>([]);
  const [detail, setDetail] = useState<EmailLogDetail | null>(null);

  useEffect(() => {
    api.companies.list(getToken()!).then(setCompanies).catch(() => setCompanies([]));
  }, []);

  useEffect(() => {
    // Las fechas se toman en la hora local: el día completo, desde las 00:00 hasta las 23:59.
    const params: Record<string, string> = {
      search: applied.search, status: applied.status, companyId: applied.companyId, type: applied.type, channel: applied.channel,
      from: applied.from ? new Date(`${applied.from}T00:00:00`).toISOString() : '',
      to: applied.to ? new Date(`${applied.to}T23:59:59.999`).toISOString() : '',
      page: String(page),
    };
    api.emailLogs.list(params, getToken()!)
      .then((d) => { setData(d); setError(''); })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [applied, page]);

  async function open(id: string) {
    try {
      setDetail(await api.emailLogs.get(id, getToken()!));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const apply = (n: typeof empty) => { setF(n); setApplied(n); setPage(1); };
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div>
      {data && (
        <div className="mb-3 grid grid-cols-2 gap-3 sm:max-w-md">
          <button type="button" onClick={() => apply({ ...empty, status: 'SENT' })}
            className="rounded-xl border border-gray-200 bg-white p-3 text-left hover:border-gray-300">
            <p className="text-xs text-gray-500">Enviados (24 h)</p>
            <p className="text-xl font-semibold text-gray-900 tabular-nums">{data.sent24h}</p>
          </button>
          <button type="button" onClick={() => apply({ ...empty, status: 'FAILED' })}
            className={`rounded-xl border p-3 text-left ${data.failed24h ? 'border-red-200 bg-red-50 hover:border-red-300' : 'border-gray-200 bg-white hover:border-gray-300'}`}>
            <p className={`text-xs ${data.failed24h ? 'text-red-600' : 'text-gray-500'}`}>Fallidos (24 h)</p>
            <p className={`text-xl font-semibold tabular-nums ${data.failed24h ? 'text-red-700' : 'text-gray-900'}`}>{data.failed24h}</p>
          </button>
        </div>
      )}

      <FilterBar
        search={{ label: 'Buscar', value: f.search, onChange: (v) => setF((x) => ({ ...x, search: v })), onSubmit: () => apply(f), placeholder: 'Destinatario o asunto…' }}
        primary={(
          <FilterField label="Estado">
            <select value={f.status} onChange={(e) => apply({ ...f, status: e.target.value })} className={filterSelectCls}>
              <option value="">Todos</option><option value="SENT">Enviados</option><option value="FAILED">Fallidos</option>
            </select>
          </FilterField>
        )}
        activeCount={[f.companyId, f.type, f.channel, f.from, f.to].filter(Boolean).length}
        onApply={() => apply(f)}
        onClear={() => apply(empty)}
        summary={data ? <FilterCount n={data.total} label="correos" /> : null}
      >
        <FilterField label="Empresa">
          <select value={f.companyId} onChange={(e) => setF((x) => ({ ...x, companyId: e.target.value }))} className={filterSelectCls}>
            <option value="">Todas</option>
            <option value="none">Sin empresa</option>
            {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </FilterField>
        <FilterField label="Tipo">
          <select value={f.type} onChange={(e) => setF((x) => ({ ...x, type: e.target.value }))} className={filterSelectCls}>
            <option value="">Todos</option>
            {(data?.types ?? []).map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
          </select>
        </FilterField>
        <FilterField label="Enviado por">
          <select value={f.channel} onChange={(e) => setF((x) => ({ ...x, channel: e.target.value }))} className={filterSelectCls}>
            <option value="">Todos</option><option value="PLATFORM">Correo de la plataforma</option><option value="COMPANY">SMTP de la empresa</option>
          </select>
        </FilterField>
        <FilterField label="Desde">
          <input type="date" value={f.from} onChange={(e) => setF((x) => ({ ...x, from: e.target.value }))} className={filterInputCls} />
        </FilterField>
        <FilterField label="Hasta">
          <input type="date" value={f.to} onChange={(e) => setF((x) => ({ ...x, to: e.target.value }))} className={filterInputCls} />
        </FilterField>
      </FilterBar>

      {error && <p className="my-2 text-sm text-red-600">{error}</p>}

      <div className="mt-3 overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="w-full min-w-[820px] text-sm">
          <thead className="bg-gray-50 text-left text-[11px] uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-4 py-2.5 font-medium">Fecha</th>
              <th className="px-4 py-2.5 font-medium">Tipo</th>
              <th className="px-4 py-2.5 font-medium">Para</th>
              <th className="px-4 py-2.5 font-medium">Asunto</th>
              <th className="px-4 py-2.5 font-medium">Empresa</th>
              <th className="px-4 py-2.5 font-medium">Estado</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {data?.items.map((r) => (
              <tr key={r.id} onClick={() => open(r.id)} className="cursor-pointer hover:bg-gray-50">
                <td className="whitespace-nowrap px-4 py-2.5 text-gray-500">{when(r.createdAt)}</td>
                <td className="px-4 py-2.5">
                  <span className="text-gray-800">{r.typeLabel}</span>
                  <span className="block text-[11px] text-gray-400">{r.channel === 'PLATFORM' ? 'Plataforma' : 'SMTP de la empresa'}</span>
                </td>
                <td className="px-4 py-2.5 text-gray-700">{r.toEmail}</td>
                <td className="max-w-[280px] truncate px-4 py-2.5 text-gray-700" title={r.subject}>{r.subject}</td>
                <td className="px-4 py-2.5 text-gray-500">{r.companyName || '—'}</td>
                <td className="px-4 py-2.5">
                  <StatusBadge status={r.status} />
                  {r.error && <span className="mt-0.5 block max-w-[220px] truncate text-[11px] text-red-600" title={r.error}>{r.error}</span>}
                </td>
              </tr>
            ))}
            {data && data.items.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">No hay correos con estos filtros</td></tr>
            )}
            {!data && !error && (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">Cargando…</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {data && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-gray-500">
          <span>Se guardan los últimos {data.retentionDays} días.</span>
          {pages > 1 && (
            <div className="flex items-center gap-2">
              <button type="button" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className={btnSecondary}>Anterior</button>
              <span>Página {page} de {pages}</span>
              <button type="button" disabled={page >= pages} onClick={() => setPage((p) => p + 1)} className={btnSecondary}>Siguiente</button>
            </div>
          )}
        </div>
      )}

      {detail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setDetail(null)}>
          <div className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3 border-b border-gray-100 px-5 py-4">
              <div className="min-w-0">
                <h2 className="ui-section-title break-words">{detail.subject}</h2>
                <p className="mt-0.5 text-xs text-gray-400">{when(detail.createdAt)} · {detail.typeLabel}</p>
              </div>
              <StatusBadge status={detail.status} />
            </div>
            <div className="overflow-y-auto px-5 py-4">
              <dl className="mb-4 grid grid-cols-[110px_1fr] gap-x-3 gap-y-1.5 text-sm">
                <dt className="text-gray-500">Para</dt><dd className="break-all text-gray-800">{detail.toEmail}</dd>
                <dt className="text-gray-500">De</dt><dd className="break-all text-gray-800">{detail.fromEmail || '—'}</dd>
                <dt className="text-gray-500">Enviado por</dt><dd className="text-gray-800">{detail.channel === 'PLATFORM' ? 'Correo de la plataforma' : 'SMTP de la empresa'}</dd>
                <dt className="text-gray-500">Empresa</dt><dd className="text-gray-800">{detail.companyName || '—'}</dd>
                <dt className="text-gray-500">Generado por</dt><dd className="text-gray-800">{detail.triggeredByName || 'Automático'}</dd>
                {detail.attachments.length > 0 && (<><dt className="text-gray-500">Adjuntos</dt><dd className="break-all text-gray-800">{detail.attachments.join(', ')}</dd></>)}
                {detail.error && (<><dt className="text-gray-500">Error</dt><dd className="break-words text-red-600">{detail.error}</dd></>)}
              </dl>
              {detail.html
                ? <EmailPreview html={detail.html} height={460} />
                : <p className="text-sm text-gray-400">Sin contenido guardado.</p>}
              <p className="mt-2 text-[11px] text-gray-400">Los enlaces de acceso (recuperación de contraseña e invitaciones) no se guardan: aparecen como “#enlace-oculto”.</p>
            </div>
            <div className="border-t border-gray-100 px-5 py-3 text-right">
              <button type="button" onClick={() => setDetail(null)} className={btnSecondary}>Cerrar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
