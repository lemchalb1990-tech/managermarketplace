'use client';

import { useCallback, useEffect, useState, FormEvent } from 'react';
import { getToken } from '@/lib/auth';
import { api, type CompanyInvitationResult, type CompanyInvitationRow, type SubscriptionPlan } from '@/lib/api';
import { Modal, btnPrimary, btnSecondary, inputCls, labelCls, FormError } from '@/components/ui/Modal';
import { confirmDialog } from '../ConfirmDialog';

const day = (d: string) => new Date(d).toLocaleDateString('es-CL', { day: '2-digit', month: 'short' });
const empty = { companyName: '', email: '', name: '', planId: '', message: '' };

// Invitar a crear una empresa nueva: la empresa se crea cuando el administrador invitado acepta,
// con el plan elegido y sus perfiles base. Incluye la lista de invitaciones pendientes.
export function CompanyInvitations({ open, onClose, plans }: { open: boolean; onClose: () => void; plans: SubscriptionPlan[] }) {
  const [form, setForm] = useState(empty);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<CompanyInvitationResult | null>(null);
  const [pending, setPending] = useState<CompanyInvitationRow[]>([]);
  const [copied, setCopied] = useState('');
  const [rowBusy, setRowBusy] = useState('');

  const load = useCallback(() => {
    api.companyInvitations.list(getToken()!).then(setPending).catch(() => setPending([]));
  }, []);
  useEffect(() => { load(); }, [load]);

  async function copy(text: string, key: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied(''), 2000);
    } catch { /* portapapeles no disponible */ }
  }

  async function submit(e: FormEvent, sendEmail: boolean) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      setResult(await api.companyInvitations.create({ ...form, planId: form.planId || null, sendEmail }, getToken()!));
      setForm(empty);
      load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function act(inv: CompanyInvitationRow, action: 'resend' | 'link' | 'cancel') {
    if (action === 'cancel' && !(await confirmDialog(`¿Cancelar la invitación de ${inv.companyName}? El enlace dejará de funcionar.`, { danger: true }))) return;
    setRowBusy(`${inv.id}:${action}`);
    try {
      const token = getToken()!;
      if (action === 'cancel') await api.companyInvitations.cancel(inv.id, token);
      else if (action === 'link') await copy((await api.companyInvitations.link(inv.id, token)).link, inv.id);
      else await api.companyInvitations.resend(inv.id, token);
      load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRowBusy('');
    }
  }

  const close = () => { onClose(); setResult(null); setError(''); };

  return (
    <>
      {open && (
        <Modal title="Invitar empresa" subtitle="La empresa se crea cuando el administrador acepta, con el plan elegido y sus perfiles base." size="lg" busy={busy} onClose={close}
          onSubmit={result ? undefined : (e) => submit(e, true)}
          footer={result ? (
            <>
              <button type="button" onClick={() => setResult(null)} className={btnSecondary}>Invitar otra empresa</button>
              <button type="button" onClick={close} className={btnPrimary}>Listo</button>
            </>
          ) : (
            <>
              <button type="button" onClick={close} disabled={busy} className={btnSecondary}>Cancelar</button>
              <button type="button" disabled={busy} onClick={(e) => submit(e as unknown as FormEvent, false)} className={btnSecondary}>Solo crear enlace</button>
              <button type="submit" disabled={busy} className={btnPrimary}>{busy ? 'Enviando…' : 'Enviar invitación'}</button>
            </>
          )}>
          {result ? (
            <div className="space-y-3">
              <div className={`rounded-lg px-3.5 py-2.5 text-sm ${result.emailSent ? 'bg-green-50 text-green-800' : 'bg-amber-50 text-amber-800'}`}>
                {result.emailSent
                  ? <>✓ Invitación de <strong>{result.invitation.companyName}</strong> enviada a <strong>{result.invitation.email}</strong>. También puedes compartir este enlace:</>
                  : result.emailConfigured
                    ? <>Invitación de <strong>{result.invitation.companyName}</strong> creada. Comparte este enlace con <strong>{result.invitation.email}</strong>:</>
                    : <>El correo de la plataforma aún no está configurado: comparte este enlace con <strong>{result.invitation.email}</strong>:</>}
              </div>
              <div className="flex gap-2">
                <input readOnly value={result.link} onFocus={(e) => e.target.select()} className="w-full px-3 py-2 border border-gray-200 bg-gray-50 rounded-lg text-xs font-mono text-gray-600" />
                <button type="button" onClick={() => copy(result.link, 'result')} className="px-3 py-2 border border-gray-300 rounded-lg text-xs font-medium text-gray-700 hover:bg-gray-50 shrink-0">
                  {copied === 'result' ? '✓ Copiado' : 'Copiar enlace'}
                </button>
              </div>
              <p className="text-[11px] text-gray-400">
                Plan: {result.invitation.planName || 'Demo (prueba)'} · solo sirve para {result.invitation.email} · vence el {day(result.invitation.expiresAt)}.
              </p>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className={labelCls}>Nombre de la empresa *</label>
                <input value={form.companyName} onChange={(e) => setForm((f) => ({ ...f, companyName: e.target.value }))} required placeholder="Tienda X SpA" className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Correo del administrador *</label>
                <input type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} required placeholder="juan@gmail.com" className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Nombre del administrador (opcional)</label>
                <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} className={inputCls} />
              </div>
              <div className="sm:col-span-2">
                <label className={labelCls}>Plan</label>
                <select value={form.planId} onChange={(e) => setForm((f) => ({ ...f, planId: e.target.value }))} className={inputCls}>
                  <option value="">Plan de prueba (Demo)</option>
                  {plans.filter((p) => p.active).map((p) => <option key={p.id} value={p.id}>{p.name}{p.isTrial ? ` · prueba ${p.trialDays ?? 15} días` : ''}</option>)}
                </select>
                <p className="mt-0.5 text-[11px] text-gray-400">Define los módulos y límites con que parte la empresa.</p>
              </div>
              <div className="sm:col-span-2">
                <label className={labelCls}>Mensaje personal (opcional)</label>
                <textarea value={form.message} onChange={(e) => setForm((f) => ({ ...f, message: e.target.value.slice(0, 500) }))} rows={2}
                  placeholder="Hola Juan, te dejo tu acceso a AdminMarket." className={`${inputCls} resize-none`} />
              </div>
              <div className="sm:col-span-2"><FormError message={error} /></div>
            </div>
          )}
        </Modal>
      )}

      {pending.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto mb-6">
          <div className="px-4 py-3 border-b border-gray-100 bg-gray-50 flex items-center justify-between">
            <h2 className="ui-section-title">Invitaciones de empresas pendientes</h2>
            <span className="text-xs text-gray-500">{pending.length}</span>
          </div>
          <table className="w-full text-sm min-w-[760px]">
            <thead className="border-b border-gray-100">
              <tr>
                <th className="text-left px-4 py-2 text-gray-500 font-medium text-xs">Empresa</th>
                <th className="text-left px-4 py-2 text-gray-500 font-medium text-xs">Administrador</th>
                <th className="text-left px-4 py-2 text-gray-500 font-medium text-xs">Plan</th>
                <th className="text-left px-4 py-2 text-gray-500 font-medium text-xs">Vence</th>
                <th className="text-left px-4 py-2 text-gray-500 font-medium text-xs">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {pending.map((inv) => {
                const expired = new Date(inv.expiresAt) < new Date();
                return (
                  <tr key={inv.id}>
                    <td className="px-4 py-2.5 font-medium text-gray-900">{inv.companyName}</td>
                    <td className="px-4 py-2.5 text-xs text-gray-600">
                      {inv.email}{inv.name ? <span className="block text-gray-400">{inv.name}</span> : null}
                      <span className="block text-gray-400">{inv.sentAt ? `Correo enviado ${day(inv.sentAt)}` : 'Sin correo (enlace)'}</span>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-gray-600">{inv.planName || 'Demo (prueba)'}</td>
                    <td className={`px-4 py-2.5 text-xs ${expired ? 'text-red-600 font-medium' : 'text-gray-600'}`}>{expired ? 'Vencida' : day(inv.expiresAt)}</td>
                    <td className="px-4 py-2.5 text-xs font-medium">
                      <span className="flex flex-wrap gap-3">
                        <button type="button" onClick={() => act(inv, 'resend')} disabled={!!rowBusy} className="text-blue-600 hover:underline disabled:opacity-50">
                          {rowBusy === `${inv.id}:resend` ? 'Enviando…' : 'Reenviar'}
                        </button>
                        <button type="button" onClick={() => act(inv, 'link')} disabled={!!rowBusy} className="text-blue-600 hover:underline disabled:opacity-50" title="Genera un enlace nuevo (el anterior deja de servir) y lo copia">
                          {copied === inv.id ? '✓ Copiado' : 'Copiar enlace'}
                        </button>
                        <button type="button" onClick={() => act(inv, 'cancel')} disabled={!!rowBusy} className="text-red-500 hover:underline disabled:opacity-50">Cancelar</button>
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {error && !open && <p className="px-4 py-2 text-sm text-red-600">{error}</p>}
        </div>
      )}
    </>
  );
}
