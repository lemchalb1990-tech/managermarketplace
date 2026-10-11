'use client';

import { connectorStatus } from '@/lib/connectors';
import { useCallback, useEffect, useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';
import { saveSession } from '@/lib/auth';
import { Logos } from '@/app/dashboard/ecommerce/components/logos';
import { usePlatformLogos, resolvePlatformLogo } from '@/lib/platformLogos';
import { GoogleSignInButton } from '@/components/GoogleSignInButton';

type Mode = 'login' | 'register' | 'signup' | 'forgot';

const MARK_COLORS = ['#ffffff', '#62aef0', '#ffffff', '#62aef0'];
const brandChannels = ['mercadolibre', 'falabella', 'paris', 'ripley', 'walmart'] as const;

export default function LoginPage() {
  const router = useRouter();
  const logoMap = usePlatformLogos();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [error, setError] = useState('');
  // Después de dar de baja la cuenta se llega acá con ?closed=<fecha de borrado>.
  const [closedOn, setClosedOn] = useState('');
  useEffect(() => { setClosedOn(new URLSearchParams(window.location.search).get('closed') || ''); }, []);
  const [loading, setLoading] = useState(false);
  // Ingreso con Google, registro de empresas nuevas y recuperación de contraseña.
  const [mode, setMode] = useState<Mode>('login');
  const [authCfg, setAuthCfg] = useState<{ googleClientId: string | null; signupEnabled: boolean }>({ googleClientId: null, signupEnabled: false });
  const [signup, setSignup] = useState({ signupToken: '', email: '', name: '', companyName: '', phone: '', rut: '' });
  const [notice, setNotice] = useState('');
  useEffect(() => {
    api.auth.config().then(setAuthCfg).catch(() => {});
    // Desde la landing: "Prueba gratis" llega con ?registro=1.
    const t = setTimeout(() => { if (new URLSearchParams(window.location.search).get('registro') === '1') setMode('register'); }, 0);
    return () => clearTimeout(t);
  }, []);

  const handleGoogle = useCallback(async (credential: string) => {
    setError('');
    setLoading(true);
    try {
      const res = await api.auth.google(credential);
      if (res.needsSignup && res.signupToken) {
        setSignup((s) => ({ ...s, signupToken: res.signupToken!, email: res.email || '', name: res.name || '' }));
        setMode('signup');
        return;
      }
      saveSession(res.access_token!, res.user);
      router.push('/dashboard');
    } catch (err) {
      setError((err as Error).message || 'No se pudo ingresar con Google');
    } finally {
      setLoading(false);
    }
  }, [router]);

  async function handleSignup(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const { access_token, user } = await api.auth.googleSignup(signup);
      saveSession(access_token, user);
      router.push('/dashboard');
    } catch (err) {
      const message = (err as Error).message || '';
      setError(message || 'No se pudo crear la cuenta');
      if (/venció|Vuelve a entrar/i.test(message)) setMode('register');
    } finally {
      setLoading(false);
    }
  }

  async function handleForgot(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await api.auth.forgotPassword(email);
      setNotice(res.message);
    } catch (err) {
      setError((err as Error).message || 'No se pudo enviar el correo');
    } finally {
      setLoading(false);
    }
  }

  function go(m: Mode) {
    setMode(m);
    setError('');
    setNotice('');
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const { access_token, user } = await api.login(email, password);
      saveSession(access_token, user);
      router.push('/dashboard');
    } catch (err: any) {
      setError(err.message || 'Credenciales inválidas');
    } finally {
      setLoading(false);
    }
  }

  const field =
    'w-full rounded-lg border border-black/[0.12] bg-white px-3.5 py-2.5 text-[15px] text-black placeholder:text-black/35 transition-colors duration-200 focus:border-[#0075de] focus:outline-none focus:ring-[3px] focus:ring-[#e6f3fe]';

  return (
    <div className="flex min-h-[100dvh] gap-4 p-4 sm:p-6">
      {/* Panel de marca: bloque de color como en la landing */}
      <aside className="relative hidden w-[46%] flex-col justify-between overflow-hidden rounded-[12px] p-12 text-white lg:flex" style={{ background: "linear-gradient(160deg, #02093a 0%, #0b1d5c 100%)" }}>
        <Link href="/" className="flex items-center gap-2 text-[15px] font-semibold tracking-[-0.01em]">
          <span className="grid h-7 w-7 place-items-center rounded-[7px] bg-white text-[0.8rem] font-bold text-[#02093a]">M</span>
          Admin Marketplace
        </Link>

        <div className="max-w-md">
          <h2 className="lp-display text-[clamp(2.4rem,3.6vw,54px)]">
            Todas tus ventas en <span className="lp-pill text-[#02093a]" style={{ background: "#cfe6fc" }}>un solo</span> lugar
          </h2>
          <p className="lp-serif mt-5 text-[18px] leading-[1.56] text-white/75">
            Catálogo, órdenes, despacho y facturación conectados con cada canal de venta.
          </p>
          <div className="mt-8 space-y-2">
            {['Stock sincronizado en todos tus canales', 'Pedidos del día ordenados por hora de corte', 'Boleta y factura en el mismo paso'].map((t) => (
              <div key={t} className="lp-shot flex items-center gap-3 rounded-[8px] border border-black/[0.08] bg-white px-3 py-2.5 text-[14px] font-medium text-black">
                <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-[#e6f3fe] text-[#0075de]">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5" /></svg>
                </span>
                {t}
              </div>
            ))}
          </div>
        </div>

        <div>
          <p className="mb-3 text-[13px] font-medium text-white/60">Tus principales canales</p>
          <div className="flex items-center gap-2.5">
            {brandChannels.filter((k) => connectorStatus(logoMap, k) === 'AVAILABLE').map((k, i) => (
              <span key={k} className="lp-mark" style={{ color: MARK_COLORS[i % MARK_COLORS.length] }}>
                <span className="h-full w-full overflow-hidden rounded-full [&>*]:h-full [&>*]:w-full [&>img]:object-cover [&>img]:rounded-full [&>svg]:scale-[1.7]">{resolvePlatformLogo(logoMap, k, Logos[k], k, 'login')}</span>
              </span>
            ))}
          </div>
        </div>
      </aside>

      {/* Formulario */}
      <div className="flex flex-1 items-center justify-center py-6">
        <div className="ui-enter w-full max-w-[400px]">
          <Link href="/" className="mb-8 flex items-center justify-center gap-2 text-[15px] font-semibold tracking-[-0.01em] lg:hidden">
            <span className="grid h-7 w-7 place-items-center rounded-[7px] bg-black text-[0.8rem] font-bold text-white">M</span>
            Admin Marketplace
          </Link>

          <div className="lp-card p-7 sm:p-8">
            {mode === 'signup' ? (
              <>
                <h1 className="lp-display text-[32px]">Crea tu empresa</h1>
                <p className="lp-serif mt-2 text-[17px] text-[#615d59]">Último paso: con estos datos dejamos lista tu cuenta con 15 días de prueba gratis.</p>
                <form onSubmit={handleSignup} className="mt-7 space-y-4">
                  <div className="rounded-lg bg-[#f6f5f4] px-3.5 py-2.5 text-sm text-black/70">Cuenta de Google: <strong className="text-black">{signup.email}</strong></div>
                  <div>
                    <label className="mb-1.5 block text-[13px] font-medium text-black/70">Tu nombre</label>
                    <input value={signup.name} onChange={(e) => setSignup((s) => ({ ...s, name: e.target.value }))} required className={field} />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-[13px] font-medium text-black/70">Nombre de tu empresa o tienda</label>
                    <input value={signup.companyName} onChange={(e) => setSignup((s) => ({ ...s, companyName: e.target.value }))} required autoFocus minLength={2} placeholder="Mi Tienda SpA" className={field} />
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <label className="mb-1.5 block text-[13px] font-medium text-black/70">Teléfono</label>
                      <input value={signup.phone} onChange={(e) => setSignup((s) => ({ ...s, phone: e.target.value }))} placeholder="+56 9 1234 5678" className={field} />
                    </div>
                    <div>
                      <label className="mb-1.5 block text-[13px] font-medium text-black/70">RUT (opcional)</label>
                      <input value={signup.rut} onChange={(e) => setSignup((s) => ({ ...s, rut: e.target.value }))} placeholder="76.123.456-7" className={field} />
                    </div>
                  </div>
                  {error && <p className="rounded-lg bg-[#fdecea] px-3.5 py-2.5 text-sm text-[#e32d14]">{error}</p>}
                  <button type="submit" disabled={loading} className="lp-btn lp-btn--primary mt-1 w-full !py-3 disabled:opacity-50">
                    {loading && <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />}
                    {loading ? 'Creando tu cuenta…' : 'Crear mi cuenta'}
                  </button>
                  <button type="button" onClick={() => go('register')} className="w-full text-center text-[13px] font-medium text-black/50 hover:text-[#0075de]">Usar otra cuenta de Google</button>
                </form>
              </>
            ) : mode === 'forgot' ? (
              <>
                <h1 className="lp-display text-[32px]">Recupera tu acceso</h1>
                <p className="lp-serif mt-2 text-[17px] text-[#615d59]">Escribe tu correo y te enviaremos un enlace para crear una nueva contraseña.</p>
                <form onSubmit={handleForgot} className="mt-7 space-y-4">
                  <div>
                    <label className="mb-1.5 block text-[13px] font-medium text-black/70">Correo electrónico</label>
                    <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus placeholder="tu@empresa.cl" className={field} />
                  </div>
                  {notice && <p className="rounded-lg bg-[#e6f3fe] px-3.5 py-2.5 text-sm text-[#004b8f]">{notice} Revisa también la carpeta de spam.</p>}
                  {error && <p className="rounded-lg bg-[#fdecea] px-3.5 py-2.5 text-sm text-[#e32d14]">{error}</p>}
                  <button type="submit" disabled={loading} className="lp-btn lp-btn--primary mt-1 w-full !py-3 disabled:opacity-50">
                    {loading && <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />}
                    {loading ? 'Enviando…' : notice ? 'Enviar de nuevo' : 'Enviar enlace'}
                  </button>
                  <button type="button" onClick={() => go('login')} className="w-full text-center text-[13px] font-medium text-black/50 hover:text-[#0075de]">← Volver a ingresar</button>
                </form>
              </>
            ) : (
              <>
                <h1 className="lp-display text-[32px]">{mode === 'register' ? 'Crea tu cuenta' : 'Entrar al panel'}</h1>
                <p className="lp-serif mt-2 text-[17px] text-[#615d59]">
                  {mode === 'register' ? '15 días de prueba gratis. Entra con tu cuenta de Google y crea tu empresa en un minuto.' : 'Ingresa con tu cuenta para continuar.'}
                </p>

                {authCfg.googleClientId && (mode === 'login' || authCfg.signupEnabled) && (
                  <div className="mt-7">
                    <GoogleSignInButton clientId={authCfg.googleClientId} onCredential={handleGoogle} text={mode === 'register' ? 'signup_with' : 'continue_with'} />
                  </div>
                )}
                {mode === 'register' && !authCfg.signupEnabled && (
                  <p className="mt-7 rounded-lg bg-[#fff4dc] px-3.5 py-2.5 text-sm text-[#7a4d00]">El registro de empresas nuevas no está disponible por ahora. Escríbenos desde la página de inicio y te creamos la cuenta.</p>
                )}

                {mode === 'login' && (
                  <>
                    {authCfg.googleClientId && (
                      <div className="my-5 flex items-center gap-3 text-[12px] text-black/40">
                        <span className="h-px flex-1 bg-black/10" />o con tu correo<span className="h-px flex-1 bg-black/10" />
                      </div>
                    )}
                    <form onSubmit={handleSubmit} className={`${authCfg.googleClientId ? '' : 'mt-7 '}space-y-4`}>
                      <div>
                        <label className="mb-1.5 block text-[13px] font-medium text-black/70">Correo electrónico</label>
                        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                          required autoFocus placeholder="tu@empresa.cl" className={field} />
                      </div>
                      <div>
                        <div className="mb-1.5 flex items-center justify-between">
                          <label className="block text-[13px] font-medium text-black/70">Contraseña</label>
                          <button type="button" onClick={() => setShowPass((s) => !s)}
                            className="rounded-md px-1.5 text-[13px] font-medium text-black/50 transition-colors duration-200 hover:text-[#0075de]">
                            {showPass ? 'Ocultar' : 'Mostrar'}
                          </button>
                        </div>
                        <input type={showPass ? 'text' : 'password'} value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          required placeholder="••••••••" className={field} />
                        <button type="button" onClick={() => go('forgot')} className="mt-1.5 text-[13px] font-medium text-[#0075de] hover:underline">
                          ¿Olvidaste tu contraseña?
                        </button>
                      </div>

                      {closedOn && !error && (
                        <div className="rounded-lg bg-[#fff4dc] px-3.5 py-2.5 text-sm text-[#7a4d00]">
                          La cuenta fue dada de baja. Sus datos se eliminarán definitivamente el {closedOn}.
                        </div>
                      )}
                      {error && (
                        <p className="rounded-lg bg-[#fdecea] px-3.5 py-2.5 text-sm text-[#e32d14]">{error}</p>
                      )}

                      <button type="submit" disabled={loading}
                        className="lp-btn lp-btn--primary mt-1 w-full !py-3 disabled:opacity-50">
                        {loading && <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />}
                        {loading ? 'Ingresando…' : 'Ingresar'}
                      </button>
                    </form>
                  </>
                )}
                {mode === 'register' && error && <p className="mt-4 rounded-lg bg-[#fdecea] px-3.5 py-2.5 text-sm text-[#e32d14]">{error}</p>}
                {mode === 'register' && loading && <p className="mt-4 text-center text-sm text-black/50">Verificando con Google…</p>}
              </>
            )}
          </div>

          {authCfg.signupEnabled && (mode === 'login' || mode === 'register') && (
            <p className="mt-5 text-center text-[14px] text-black/60">
              {mode === 'login'
                ? <>¿No tienes cuenta? <button type="button" onClick={() => go('register')} className="font-semibold text-[#0075de] hover:underline">Prueba gratis 15 días</button></>
                : <>¿Ya tienes cuenta? <button type="button" onClick={() => go('login')} className="font-semibold text-[#0075de] hover:underline">Ingresa aquí</button></>}
            </p>
          )}

          <p className="mt-6 text-center text-[13px] text-[#757575]">
            <Link href="/" className="hover:text-black">← Volver al inicio</Link>
            <span className="mx-2">·</span>
            Creado por OnDataSolution
          </p>
        </div>
      </div>
    </div>
  );
}
