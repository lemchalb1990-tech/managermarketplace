'use client';

import { useCallback, useEffect, useState, FormEvent } from 'react';
import { getToken } from '@/lib/auth';
import { api, type InvitationResult, type UserInvitation } from '@/lib/api';
import { confirmDialog } from '../ConfirmDialog';

const inputCls = 'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm';
const emptyInvite = { email: '', name: '', accessProfileId: '', companyId: '' };
const day = (d: string) => new Date(d).toLocaleDateString('es-CL', { day: '2-digit', month: 'short' });

// Formulario para invitar (correo o enlace) y lista de invitaciones pendientes.
export function Invitations({ open, onClose, isSuperAdmin, companies, profiles, onChanged, onPending }: {
  open: boolean; onClose: () => void; isSuperAdmin: boolean; companies: Array<{ id: string; name: string }>; profiles: Array<{ id: string; name: string; company?: { id: string; name: string } | null }>;
  onChanged: () => void; onPending: (n: number) => void;
}) {
  const [form, setForm] = useState(emptyInvite);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<InvitationResult | null>(null);
  const [pending, setPending] = useState<UserInvitation[]>([]);
  const [copied, setCopied] = useState('');
  const [rowBusy, setRowBusy] = useState('');

  const load = useCallback(() => {
    api.users.invitations(getToken()!).then((r) => { setPending(r); onPending(r.length); }).catch(() => setPending([]));
  }, [onPending]);
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
      const res = await api.users.invite({
        email: form.email, name: form.name || undefined, accessProfileId: form.accessProfileId || null,
        ...(isSuperAdmin ? { companyId: form.companyId } : {}), sendEmail,
      }, getToken()!);
      setResult(res);
      setForm(emptyInvite);
      load();
      onChanged();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function act(inv: UserInvitation, action: 'resend' | 'link' | 'cancel') {
    if (action === 'cancel' && !(await confirmDialog(`¿Cancelar la invitación de ${inv.email}? El enlace dejará de funcionar.`, { danger: true }))) return;
    setRowBusy(`${inv.id}:${action}`);
    try {
      const token = getToken()!;
      if (action === 'cancel') await api.users.cancelInvitation(inv.id, token);
      else {
        const res = action === 'resend' ? await api.users.resendInvitation(inv.id, token) : await api.users.invitationLink(inv.id, token);
        if (action === 'link') await copy(res.link, inv.id);
        else setResult(res);
      }
      load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRowBusy('');
    }
  }

  return (
    <>
      {open && (
        <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
          <div className="mb-4 flex items-start justify-between gap-2">
            <div>
              <h2 className="ui-section-title">Invitar usuario</h2>
              <p className="text-xs text-gray-500 mt-0.5">Le llega un correo para unirse a la empresa: entra con Google (mismo correo) o crea su contraseña. La invitación vence en 7 días.</p>
            </div>
            <button type="button" onClick={() => { onClose(); setResult(null); setError(''); }} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
          </div>

          {result ? (
            <div className="space-y-3">
              <div className={`rounded-lg px-3.5 py-2.5 text-sm ${result.emailSent ? 'bg-green-50 text-green-800' : 'bg-amber-50 text-amber-800'}`}>
                {result.emailSent
                  ? <>✓ Invitación enviada a <strong>{result.invitation.email}</strong>. También puedes compartirle este enlace:</>
                  : result.emailConfigured
                    ? <>La invitación para <strong>{result.invitation.email}</strong> quedó creada. Compártele este enlace (por WhatsApp, por ejemplo):</>
                    : <>El correo de la plataforma aún no está configurado: la invitación para <strong>{result.invitation.email}</strong> quedó creada, compártele este enlace:</>}
              </div>
              <div className="flex gap-2">
                <input readOnly value={result.link} className="w-full px-3 py-2 border border-gray-200 bg-gray-50 rounded-lg text-xs font-mono text-gray-600" onFocus={(e) => e.target.select()} />
                <button type="button" onClick={() => copy(result.link, 'result')}
                  className="px-3 py-2 border border-gray-300 rounded-lg text-xs font-medium text-gray-700 hover:bg-gray-50 shrink-0">
                  {copied === 'result' ? '✓ Copiado' : 'Copiar enlace'}
                </button>
              </div>
              <p className="text-[11px] text-gray-400">El enlace solo sirve para {result.invitation.email} y vence el {day(result.invitation.expiresAt)}.</p>
              <div className="flex gap-2">
                <button type="button" onClick={() => setResult(null)} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700">Invitar a otra persona</button>
                <button type="button" onClick={() => { onClose(); setResult(null); }} className="px-4 py-2 border border-gray-300 text-gray-600 rounded-lg text-sm hover:bg-gray-50">Listo</button>
              </div>
            </div>
          ) : (
            <form onSubmit={(e) => submit(e, true)} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Correo *</label>
                <input type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} required placeholder="persona@gmail.com" className={inputCls} />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Nombre (opcional)</label>
                <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} className={inputCls} />
              </div>
              {isSuperAdmin && (
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Empresa *</label>
                  <select value={form.companyId} onChange={(e) => setForm((f) => ({ ...f, companyId: e.target.value, accessProfileId: '' }))} required className={inputCls}>
                    <option value="">Elige la empresa…</option>
                    {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
              )}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Perfil de acceso *</label>
                <select value={form.accessProfileId} onChange={(e) => setForm((f) => ({ ...f, accessProfileId: e.target.value }))} required className={inputCls}>
                  <option value="">Elige un perfil…</option>
                  {profiles.filter((p) => (isSuperAdmin ? !p.company || p.company.id === form.companyId : true))
                    .map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                <p className="text-[11px] text-gray-400 mt-0.5">Define dónde entra y qué puede hacer.</p>
              </div>
              {error && <p className="sm:col-span-2 text-red-600 text-sm">{error}</p>}
              <div className="sm:col-span-2 flex flex-wrap gap-2">
                <button type="submit" disabled={busy} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
                  {busy ? 'Enviando…' : 'Enviar invitación'}
                </button>
                <button type="button" disabled={busy} onClick={(e) => submit(e as unknown as FormEvent, false)}
                  className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg text-sm hover:bg-gray-50 disabled:opacity-50">
                  Solo crear enlace (sin correo)
                </button>
              </div>
            </form>
          )}
        </div>
      )}

      {pending.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto mb-6">
          <div className="px-4 py-3 border-b border-gray-100 bg-gray-50 flex items-center justify-between">
            <h2 className="ui-section-title">Invitaciones pendientes</h2>
            <span className="text-xs text-gray-500">{pending.length}</span>
          </div>
          <table className="w-full text-sm min-w-[720px]">
            <thead className="border-b border-gray-100">
              <tr>
                <th className="text-left px-4 py-2 text-gray-500 font-medium text-xs">Correo</th>
                <th className="text-left px-4 py-2 text-gray-500 font-medium text-xs">Perfil</th>
                {isSuperAdmin && <th className="text-left px-4 py-2 text-gray-500 font-medium text-xs">Empresa</th>}
                <th className="text-left px-4 py-2 text-gray-500 font-medium text-xs">Invitado por</th>
                <th className="text-left px-4 py-2 text-gray-500 font-medium text-xs">Vence</th>
                <th className="text-left px-4 py-2 text-gray-500 font-medium text-xs">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {pending.map((inv) => {
                const expired = new Date(inv.expiresAt) < new Date();
                return (
                  <tr key={inv.id}>
                    <td className="px-4 py-2.5">
                      <span className="block font-medium text-gray-900">{inv.email}</span>
                      {inv.name && <span className="text-xs text-gray-400">{inv.name}</span>}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-gray-600">{inv.profileName || '—'}</td>
                    {isSuperAdmin && <td className="px-4 py-2.5 text-xs text-gray-600">{inv.company.name}</td>}
                    <td className="px-4 py-2.5 text-xs text-gray-600">
                      {inv.invitedByName || '—'}
                      <span className="block text-gray-400">{inv.sentAt ? `Correo enviado ${day(inv.sentAt)}` : 'Sin correo (enlace)'}</span>
                    </td>
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
