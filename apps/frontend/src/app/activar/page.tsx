'use client';

import { Suspense, useCallback, useEffect, useState, FormEvent } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { api, type CompanyInvitationInfo } from '@/lib/api';
import { saveSession } from '@/lib/auth';
import { GoogleSignInButton } from '@/components/GoogleSignInButton';

const MIN = 8;
const field =
  'w-full rounded-lg border border-black/[0.12] bg-white px-3.5 py-2.5 text-[15px] text-black placeholder:text-black/35 transition-colors duration-200 focus:border-[#0075de] focus:outline-none focus:ring-[3px] focus:ring-[#e6f3fe]';

// Llega desde la invitación del Super Admin (/activar?token=…): el administrador activa su
// empresa (se crea con el plan elegido) con Google o creando su contraseña, y entra directo.
export default function ActivarPage() {
  return <Suspense fallback={null}><Activar /></Suspense>;
}

function Activar() {
  const router = useRouter();
  const token = useSearchParams().get('token') || '';
  const [info, setInfo] = useState<CompanyInvitationInfo | null>(null);
  const [invalid, setInvalid] = useState('');
  const [company, setCompany] = useState({ companyName: '', phone: '', rut: '' });
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let alive = true;
    const check = token ? api.auth.companyInvitation(token) : Promise.reject(new Error('El enlace está incompleto. Ábrelo de nuevo desde el correo o el mensaje que recibiste.'));
    check
      .then((r) => { if (alive) { setInfo(r); setName(r.name || ''); setCompany((c) => ({ ...c, companyName: r.companyName })); } })
      .catch((e) => { if (alive) setInvalid((e as Error).message); });
    return () => { alive = false; };
  }, [token]);

  const enter = useCallback((res: { access_token: string; user: unknown }) => {
    saveSession(res.access_token, res.user);
    router.push('/dashboard');
  }, [router]);

  const handleGoogle = useCallback(async (credential: string) => {
    setError('');
    setLoading(true);
    try {
      enter(await api.auth.acceptCompanyInvitationGoogle({ token, credential, ...company }));
    } catch (err) {
      setError((err as Error).message || 'No se pudo activar con Google');
      setLoading(false);
    }
  }, [token, company, enter]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (password.length < MIN) return setError(`La contraseña debe tener al menos ${MIN} caracteres`);
    if (password !== confirm) return setError('Las contraseñas no coinciden');
    setLoading(true);
    try {
      enter(await api.auth.acceptCompanyInvitation({ token, name, password, ...company }));
    } catch (err) {
      setError((err as Error).message || 'No se pudo activar la cuenta');
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-[100dvh] items-center justify-center p-4">
      <div className="ui-enter w-full max-w-[460px]">
        <Link href="/" className="mb-8 flex items-center justify-center gap-2 text-[15px] font-semibold tracking-[-0.01em]">
          <span className="grid h-7 w-7 place-items-center rounded-[7px] bg-black text-[0.8rem] font-bold text-white">M</span>
          Domium
        </Link>
        <div className="lp-card p-7 sm:p-8">
          {!info && !invalid && <p className="text-sm text-black/50">Revisando la invitación…</p>}
          {invalid && (
            <>
              <h1 className="lp-display text-[28px]">Invitación no disponible</h1>
              <p className="mt-4 rounded-lg bg-[#fdecea] px-3.5 py-2.5 text-sm text-[#e32d14]">{invalid}</p>
              <Link href="/login" className="lp-btn lp-btn--primary mt-5 w-full !py-3">Ir a ingresar</Link>
            </>
          )}
          {info && (
            <>
              <h1 className="lp-display text-[28px]">Activa {info.companyName}</h1>
              <p className="lp-serif mt-2 text-[17px] text-[#615d59]">
                Te invitaron a administrar esta empresa en AdminMarket
                {info.planName ? <> con el plan <strong className="text-black">{info.planName}</strong>{info.trialDays ? ` (${info.trialDays} días de prueba)` : ''}</> : ''}.
              </p>
              {info.message && <p className="mt-3 rounded-lg bg-[#f6f5f4] px-3.5 py-2.5 text-sm italic text-black/70">“{info.message}”</p>}
              <div className="mt-3 rounded-lg bg-[#f6f5f4] px-3.5 py-2.5 text-sm text-black/70">Invitación para <strong className="text-black">{info.email}</strong></div>

              {info.exists ? (
                <>
                  <p className="mt-4 rounded-lg bg-[#fff4dc] px-3.5 py-2.5 text-sm text-[#7a4d00]">Ya existe una cuenta con este correo. Ingresa con ella o pide la invitación para otro correo.</p>
                  <Link href="/login" className="lp-btn lp-btn--primary mt-5 w-full !py-3">Ir a ingresar</Link>
                </>
              ) : (
                <>
                  <div className="mt-5 space-y-4">
                    <div>
                      <label className="mb-1.5 block text-[13px] font-medium text-black/70">Nombre de la empresa</label>
                      <input value={company.companyName} onChange={(e) => setCompany((c) => ({ ...c, companyName: e.target.value }))} required minLength={2} className={field} />
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div>
                        <label className="mb-1.5 block text-[13px] font-medium text-black/70">Teléfono</label>
                        <input value={company.phone} onChange={(e) => setCompany((c) => ({ ...c, phone: e.target.value }))} placeholder="+56 9 1234 5678" className={field} />
                      </div>
                      <div>
                        <label className="mb-1.5 block text-[13px] font-medium text-black/70">RUT (opcional)</label>
                        <input value={company.rut} onChange={(e) => setCompany((c) => ({ ...c, rut: e.target.value }))} placeholder="76.123.456-7" className={field} />
                      </div>
                    </div>
                  </div>

                  {info.googleClientId && (
                    <div className="mt-6">
                      <GoogleSignInButton clientId={info.googleClientId} onCredential={handleGoogle} text="continue_with" />
                      <p className="mt-2 text-center text-[12px] text-black/45">Usa la cuenta de Google de {info.email}</p>
                      <div className="my-5 flex items-center gap-3 text-[12px] text-black/40">
                        <span className="h-px flex-1 bg-black/10" />o crea tu contraseña<span className="h-px flex-1 bg-black/10" />
                      </div>
                    </div>
                  )}
                  <form onSubmit={submit} className={`${info.googleClientId ? '' : 'mt-6 '}space-y-4`}>
                    <div>
                      <label className="mb-1.5 block text-[13px] font-medium text-black/70">Tu nombre</label>
                      <input value={name} onChange={(e) => setName(e.target.value)} required className={field} />
                    </div>
                    <div>
                      <div className="mb-1.5 flex items-center justify-between">
                        <label className="block text-[13px] font-medium text-black/70">Contraseña</label>
                        <button type="button" onClick={() => setShow((s) => !s)} className="rounded-md px-1.5 text-[13px] font-medium text-black/50 hover:text-[#0075de]">
                          {show ? 'Ocultar' : 'Mostrar'}
                        </button>
                      </div>
                      <input type={show ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} required minLength={MIN}
                        placeholder={`Mínimo ${MIN} caracteres`} className={field} />
                    </div>
                    <div>
                      <label className="mb-1.5 block text-[13px] font-medium text-black/70">Repite la contraseña</label>
                      <input type={show ? 'text' : 'password'} value={confirm} onChange={(e) => setConfirm(e.target.value)} required minLength={MIN} className={field} />
                    </div>
                    {error && <p className="rounded-lg bg-[#fdecea] px-3.5 py-2.5 text-sm text-[#e32d14]">{error}</p>}
                    <button type="submit" disabled={loading} className="lp-btn lp-btn--primary mt-1 w-full !py-3 disabled:opacity-50">
                      {loading && <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />}
                      {loading ? 'Activando…' : 'Activar mi cuenta'}
                    </button>
                  </form>
                </>
              )}
            </>
          )}
        </div>
        <p className="mt-6 text-center text-[13px] text-[#757575]">
          <Link href="/login" className="hover:text-black">¿Ya tienes cuenta? Ingresa aquí</Link>
        </p>
      </div>
    </div>
  );
}
