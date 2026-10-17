'use client';

import { Suspense, useEffect, useState, FormEvent } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';
import { saveSession } from '@/lib/auth';

const MIN = 8;
const field =
  'w-full rounded-lg border border-black/[0.12] bg-white px-3.5 py-2.5 text-[15px] text-black placeholder:text-black/35 transition-colors duration-200 focus:border-[#0075de] focus:outline-none focus:ring-[3px] focus:ring-[#e6f3fe]';

// Llega desde el correo de recuperación (/restablecer?token=…): crea la nueva contraseña y entra.
export default function RestablecerPage() {
  return <Suspense fallback={null}><Restablecer /></Suspense>;
}

function Restablecer() {
  const router = useRouter();
  const token = useSearchParams().get('token') || '';
  const [state, setState] = useState<{ status: 'checking' | 'ready' | 'invalid'; email?: string; error?: string }>({ status: 'checking' });
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let alive = true;
    const check = token
      ? api.auth.checkReset(token).then((r) => ({ status: 'ready' as const, email: r.email }))
      : Promise.reject(new Error('El enlace está incompleto. Ábrelo de nuevo desde el correo.'));
    check
      .then((s) => { if (alive) setState(s); })
      .catch((e) => { if (alive) setState({ status: 'invalid', error: (e as Error).message }); });
    return () => { alive = false; };
  }, [token]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (password.length < MIN) return setError(`La contraseña debe tener al menos ${MIN} caracteres`);
    if (password !== confirm) return setError('Las contraseñas no coinciden');
    setLoading(true);
    try {
      const { access_token, user } = await api.auth.resetPassword(token, password);
      saveSession(access_token, user);
      router.push('/dashboard');
    } catch (err) {
      setError((err as Error).message || 'No se pudo cambiar la contraseña');
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-[100dvh] items-center justify-center p-4">
      <div className="ui-enter w-full max-w-[420px]">
        <Link href="/" className="mb-8 flex items-center justify-center gap-2 text-[15px] font-semibold tracking-[-0.01em]">
          <span className="grid h-7 w-7 place-items-center rounded-[7px] bg-black text-[0.8rem] font-bold text-white">M</span>
          Domium
        </Link>
        <div className="lp-card p-7 sm:p-8">
          <h1 className="lp-display text-[30px]">Nueva contraseña</h1>
          {state.status === 'checking' && <p className="mt-4 text-sm text-black/50">Verificando el enlace…</p>}
          {state.status === 'invalid' && (
            <>
              <p className="mt-4 rounded-lg bg-[#fdecea] px-3.5 py-2.5 text-sm text-[#e32d14]">{state.error}</p>
              <Link href="/login" className="lp-btn lp-btn--primary mt-5 w-full !py-3">Pedir un enlace nuevo</Link>
            </>
          )}
          {state.status === 'ready' && (
            <>
              <p className="lp-serif mt-2 text-[17px] text-[#615d59]">Para la cuenta <strong className="text-black">{state.email}</strong>. Al guardarla se cerrarán las sesiones abiertas en otros equipos.</p>
              <form onSubmit={submit} className="mt-6 space-y-4">
                <div>
                  <div className="mb-1.5 flex items-center justify-between">
                    <label className="block text-[13px] font-medium text-black/70">Nueva contraseña</label>
                    <button type="button" onClick={() => setShow((s) => !s)} className="rounded-md px-1.5 text-[13px] font-medium text-black/50 hover:text-[#0075de]">
                      {show ? 'Ocultar' : 'Mostrar'}
                    </button>
                  </div>
                  <input type={show ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} required autoFocus minLength={MIN}
                    placeholder={`Mínimo ${MIN} caracteres`} className={field} />
                </div>
                <div>
                  <label className="mb-1.5 block text-[13px] font-medium text-black/70">Repite la contraseña</label>
                  <input type={show ? 'text' : 'password'} value={confirm} onChange={(e) => setConfirm(e.target.value)} required minLength={MIN} className={field} />
                </div>
                {error && <p className="rounded-lg bg-[#fdecea] px-3.5 py-2.5 text-sm text-[#e32d14]">{error}</p>}
                <button type="submit" disabled={loading} className="lp-btn lp-btn--primary mt-1 w-full !py-3 disabled:opacity-50">
                  {loading && <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />}
                  {loading ? 'Guardando…' : 'Guardar y entrar'}
                </button>
              </form>
            </>
          )}
        </div>
        <p className="mt-6 text-center text-[13px] text-[#757575]">
          <Link href="/login" className="hover:text-black">← Volver a ingresar</Link>
        </p>
      </div>
    </div>
  );
}
