/*
  Primitivas del sistema de diseño. Sin estado ni hooks: se pueden usar tanto en
  server como en client components. Los estilos viven en globals.css (clases .ui-*).
*/
import Link from 'next/link';
import type { ReactNode } from 'react';

export type Crumb = { label: string; href?: string };

export function Breadcrumbs({ items }: { items: Crumb[] }) {
  return (
    <nav className="ui-crumbs" aria-label="Ruta de navegación">
      {items.map((c, i) => {
        const last = i === items.length - 1;
        return (
          <span key={i} className="flex items-center gap-1.5">
            {c.href && !last ? (
              <Link href={c.href} className="hover:underline">{c.label}</Link>
            ) : (
              <span className={last ? 'text-[var(--text-2)] font-medium' : undefined}>{c.label}</span>
            )}
            {!last && <span className="text-[var(--text-muted)]">/</span>}
          </span>
        );
      })}
    </nav>
  );
}

export function PageHeader({
  title,
  crumbs,
  actions,
  updatedAt,
}: {
  title: string;
  crumbs?: Crumb[];
  actions?: ReactNode;
  updatedAt?: Date | string | null;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
      <div>
        <h1 className="ui-page-title">{title}</h1>
        {crumbs && crumbs.length > 0 && <Breadcrumbs items={crumbs} />}
      </div>
      <div className="flex items-center gap-3">
        {updatedAt && <LastUpdated at={updatedAt} />}
        {actions}
      </div>
    </div>
  );
}

export function LastUpdated({ at }: { at: Date | string }) {
  const d = typeof at === 'string' ? new Date(at) : at;
  const hh = d.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' });
  return (
    <span className="hidden sm:flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
      Última actualización: <strong className="text-[var(--text-2)]">{hh}</strong>
      <span className="w-1.5 h-1.5 rounded-full bg-[var(--ok)] inline-block" />
    </span>
  );
}

export function Card({ className = '', children }: { className?: string; children: ReactNode }) {
  return <div className={`ui-card ${className}`}>{children}</div>;
}

export function SectionCard({
  title,
  actions,
  className = '',
  children,
}: {
  title?: string;
  actions?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={`ui-card ${className}`}>
      {(title || actions) && (
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-[var(--border-soft)]">
          {title && <h2 className="font-semibold text-[var(--text)] text-sm">{title}</h2>}
          {actions}
        </div>
      )}
      <div className="p-5">{children}</div>
    </div>
  );
}

export function StatTile({
  label,
  value,
  hint,
  tone,
  icon,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: 'ok' | 'warn' | 'danger' | 'brand';
  icon?: ReactNode;
}) {
  const toneClass =
    tone === 'ok' ? 'text-[var(--ok)]'
    : tone === 'warn' ? 'text-[var(--warn)]'
    : tone === 'danger' ? 'text-[var(--danger)]'
    : tone === 'brand' ? 'text-[var(--brand-ink)]'
    : 'text-[var(--text)]';
  return (
    <div className="ui-stat flex items-start gap-3">
      {icon && (
        <div className="w-9 h-9 rounded-lg bg-[var(--brand-soft)] text-[var(--brand-ink)] flex items-center justify-center shrink-0">
          {icon}
        </div>
      )}
      <div className="min-w-0">
        <div className={`ui-stat-value ${toneClass}`}>{value}</div>
        <div className="ui-stat-label">{label}</div>
        {hint && <div className="text-xs text-[var(--text-muted)] mt-1">{hint}</div>}
      </div>
    </div>
  );
}

export function StatRow({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 md:grid-cols-4 gap-3">{children}</div>;
}

type BadgeTone = 'ok' | 'warn' | 'danger' | 'info' | 'neutral';

export function Badge({ tone = 'neutral', children }: { tone?: BadgeTone; children: ReactNode }) {
  return <span className={`ui-badge ui-badge--${tone}`}>{children}</span>;
}

export function BrandButton({
  children,
  className = '',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button className={`ui-btn-brand ${className}`} {...props}>
      {children}
    </button>
  );
}
