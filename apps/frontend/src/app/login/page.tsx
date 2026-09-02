'use client';

import { useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';
import { saveSession } from '@/lib/auth';

const EASE = 'cubic-bezier(0.32,0.72,0,1)';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [error, setError] = useState('');
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
    'w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3.5 py-2.5 text-sm text-[var(--text)] placeholder:text-[var(--text-muted)] transition-colors focus:border-[var(--brand)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-soft)]';

  return (
    <div className="flex min-h-[100dvh] bg-[var(--page-bg)]">
      {/* Panel de marca — charcoal, sin gradiente */}
      <aside className="relative hidden w-1/2 flex-col justify-between overflow-hidden bg-[var(--topbar-bg)] p-12 text-[var(--topbar-fg)] lg:flex">
        <Link href="/" className="flex items-center gap-2.5 text-[0.95rem] font-semibold tracking-tight">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--brand)] font-bold text-[#35301f]">M</span>
          Admin Marketplace
        </Link>

        <div className="max-w-md">
          <span className="ui-eyebrow bg-white/10 text-[var(--brand)]">Operación omnicanal</span>
          <h2 className="font-serif mt-5 text-[2.4rem] leading-[1.1] tracking-[-0.02em]">
            Todas tus ventas y toda tu bodega en un solo lugar.
          </h2>
          <p className="mt-4 text-[0.95rem] leading-relaxed text-white/60">
            Catálogo, órdenes, despacho y facturación conectados con cada canal de venta.
          </p>
        </div>

        <p className="text-xs text-white/35">© {new Date().getFullYear()} Admin Marketplace</p>
      </aside>

      {/* Formulario */}
      <div className="flex flex-1 items-center justify-center px-4 py-12 sm:px-6">
        <div className="w-full max-w-sm">
          <Link href="/" className="mb-8 flex items-center gap-2 text-sm font-semibold tracking-tight lg:hidden">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--brand)] text-xs font-bold text-[#35301f]">M</span>
            Admin Marketplace
          </Link>

          <h1 className="font-serif text-[1.9rem] leading-tight tracking-[-0.02em] text-[var(--text)]">
            Entrar al panel
          </h1>
          <p className="mt-1.5 text-sm text-[var(--text-2)]">Ingresa con tu cuenta para continuar.</p>

          <form onSubmit={handleSubmit} className="mt-8 space-y-4">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-[var(--text-2)]">Correo</label>
              <input
                type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                required autoFocus placeholder="tu@empresa.cl" className={field}
              />
            </div>
            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <label className="block text-xs font-medium text-[var(--text-2)]">Contraseña</label>
                <button type="button" onClick={() => setShowPass((s) => !s)}
                  className="text-xs text-[var(--text-muted)] hover:text-[var(--brand-ink)]">
                  {showPass ? 'Ocultar' : 'Mostrar'}
                </button>
              </div>
              <input
                type={showPass ? 'text' : 'password'} value={password}
                onChange={(e) => setPassword(e.target.value)}
                required placeholder="••••••••" className={field}
              />
            </div>

            {error && (
              <p className="rounded-lg bg-[var(--danger-bg)] px-3 py-2 text-sm text-[var(--danger)]">{error}</p>
            )}

            <button
              type="submit" disabled={loading}
              style={{ transitionTimingFunction: EASE }}
              className="group flex w-full items-center justify-center gap-2 rounded-full bg-[var(--brand)] py-2.5 text-sm font-semibold text-[#35301f] transition-transform duration-300 hover:bg-[var(--brand-dark)] active:scale-[0.99] disabled:opacity-50"
            >
              {loading && <span className="h-4 w-4 animate-spin rounded-full border-2 border-[#35301f]/30 border-t-[#35301f]" />}
              {loading ? 'Ingresando…' : 'Ingresar'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
