'use client';

import { Suspense, useCallback, useEffect, useState, FormEvent } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { api, type InvitationInfo } from '@/lib/api';
import { saveSession } from '@/lib/auth';
import { GoogleSignInButton } from '@/components/GoogleSignInButton';

const MIN = 8;
const field =
  'w-full rounded-lg border border-black/[0.12] bg-white px-3.5 py-2.5 text-[15px] text-black placeholder:text-black/35 transition-colors duration-200 focus:border-[#0075de] focus:outline-none focus:ring-[3px] focus:ring-[#e6f3fe]';

// Llega desde el correo o el enlace de invitación (/invitacion?token=…): se une a la empresa con
// Google (mismo correo invitado) o creando su contraseña, y entra directo.
export default function InvitacionPage() {
  return <Suspense fallback={null}><Invitacion /></Suspense>;
}

function Invitacion() {
  const router = useRouter();
  const token = useSearchParams().get('token') || '';
  const [info, setInfo] = useState<InvitationInfo | null>(null);
  const [invalid, setInvalid] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let alive = true;
    const check = token ? api.auth.invitation(token) : Promise.reject(new Error('El enlace está incompleto. Ábrelo de nuevo desde el correo o el mensaje que recibiste.'));
    check
      .then((r) => { if (alive) { setInfo(r); setName(r.name || ''); } })
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
      enter(await api.auth.acceptInvitationGoogle(token, credential));
    } catch (err) {
      setError((err as Error).message || 'No se pudo aceptar con Google');
      setLoading(false);
    }
  }, [token, enter]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (password.length < MIN) return setError(`La contraseña debe tener al menos ${MIN} caracteres`);
    if (password !== confirm) return setError('Las contraseñas no coinciden');
    setLoading(true);
    try {
      enter(await api.auth.acceptInvitation({ token, name, password }));
    } catch (err) {
      setError((err as Error).message || 'No se pudo aceptar la invitación');
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-[100dvh] items-center justify-center p-4">
      <div className="ui-enter w-full max-w-[440px]">
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
              <h1 className="lp-display text-[28px]">Únete a {info.company}</h1>
              <p className="lp-serif mt-2 text-[17px] text-[#615d59]">
                {info.invitedByName || 'El administrador'} te invitó como <strong className="text-black">{info.roleLabel}</strong>.
              </p>
              <div className="mt-4 rounded-lg bg-[#f6f5f4] px-3.5 py-2.5 text-sm text-black/70">Invitación para <strong className="text-black">{info.email}</strong></div>

              {info.exists ? (
                <>
                  <p className="mt-4 rounded-lg bg-[#fff4dc] px-3.5 py-2.5 text-sm text-[#7a4d00]">Ya existe una cuenta con este correo. Ingresa con ella.</p>
                  <Link href="/login" className="lp-btn lp-btn--primary mt-5 w-full !py-3">Ir a ingresar</Link>
                </>
              ) : (
                <>
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
                      {loading ? 'Uniéndote…' : 'Aceptar invitación'}
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
