'use client';

import { useEffect, useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';
import { saveSession } from '@/lib/auth';
import { Logos } from '@/app/dashboard/ecommerce/components/logos';
import { usePlatformLogos, resolvePlatformLogo } from '@/lib/platformLogos';

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
            {brandChannels.map((k, i) => (
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
            <h1 className="lp-display text-[32px]">Entrar al panel</h1>
            <p className="lp-serif mt-2 text-[17px] text-[#615d59]">Ingresa con tu cuenta para continuar.</p>

            <form onSubmit={handleSubmit} className="mt-7 space-y-4">
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
          </div>

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
