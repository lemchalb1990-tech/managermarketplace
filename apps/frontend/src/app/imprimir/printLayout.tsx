'use client';

import type { CSSProperties, ReactNode } from 'react';
import { imgUrl } from '@/lib/api';

// Formato de impresión configurado por la empresa (Ajustes del POS). 'TICKET' es el de
// 80 mm (nombre previo a que existiera el de 58 mm).
export type PrintFormat = 'CARTA' | 'TICKET' | 'TICKET_58';

export const PRINT_FORMAT_LABEL: Record<PrintFormat, string> = {
  CARTA: 'Hoja carta',
  TICKET: 'Ticket 80 mm',
  TICKET_58: 'Ticket 58 mm',
};

export const PAYMENT_LABEL: Record<string, string> = {
  CASH: 'Efectivo', CARD: 'Tarjeta', TRANSFER: 'Transferencia', OTHER: 'Otro',
};

export type LogoSize = 'SMALL' | 'MEDIUM' | 'LARGE';

export const LOGO_SIZE_LABEL: Record<LogoSize, string> = { SMALL: 'Pequeño', MEDIUM: 'Mediano', LARGE: 'Grande' };

// Alto del logo (px) por formato y tamaño elegido en Datos de la empresa. El ancho se ajusta
// solo (logos horizontales) con tope en el ancho disponible.
const LOGO_HEIGHT: Record<PrintFormat, Record<LogoSize, number>> = {
  TICKET_58: { SMALL: 24, MEDIUM: 36, LARGE: 54 },
  TICKET: { SMALL: 32, MEDIUM: 48, LARGE: 72 },
  CARTA: { SMALL: 48, MEDIUM: 72, LARGE: 100 },
};

export function logoStyle(format: PrintFormat, size?: string | null): CSSProperties {
  const s: LogoSize = size === 'SMALL' || size === 'LARGE' ? size : 'MEDIUM';
  return { height: LOGO_HEIGHT[format][s], width: 'auto', maxWidth: format === 'CARTA' ? 240 : '100%', objectFit: 'contain' };
}

export const fmtCLP = (v: number) => `$${Math.round(v).toLocaleString('es-CL')}`;

export function formatDateTime(value: string | Date, tz: string) {
  const d = new Date(value);
  return {
    date: d.toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: tz }),
    time: d.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: tz }),
  };
}

const printButtonStyle = { padding: '8px 16px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, cursor: 'pointer' };

export function PrintButton({ align = 'center' }: { align?: 'center' | 'right' }) {
  return (
    <div className="no-print" style={{ textAlign: align, marginBottom: 12 }}>
      <button onClick={() => window.print()} style={printButtonStyle}>Imprimir</button>
    </div>
  );
}

/** Contenedor de ticket térmico: ancho de papel 58 u 80 mm según el formato. */
export function TicketPage({ format, children }: { format: PrintFormat; children: ReactNode }) {
  const paper = format === 'TICKET_58' ? 58 : 80;
  // Área imprimible típica: 48 mm en papel de 58 y 72 mm en papel de 80.
  const content = format === 'TICKET_58' ? 48 : 72;
  return (
    <div style={{ fontFamily: 'monospace', color: '#000', width: `${content}mm`, margin: '0 auto', padding: '2mm 0', fontSize: format === 'TICKET_58' ? 10 : 12, lineHeight: 1.3, wordBreak: 'break-word' }}>
      <style>{`
        @media print {
          .no-print { display: none !important; }
          html, body { margin: 0; padding: 0; }
          @page { size: ${paper}mm auto; margin: 0 ${(paper - content) / 2}mm; }
        }
        .ticket-row { display: flex; justify-content: space-between; gap: 6px; }
        .ticket-sep { border-top: 1px dashed #000; margin: 6px 0; }
        .ticket p { margin: 0; }
      `}</style>
      <PrintButton />
      <div className="ticket">{children}</div>
    </div>
  );
}

export interface DocHeaderData {
  /** Nombre comercial (nombre de la empresa en la plataforma). */
  commercialName: string;
  /** Perfil de facturación: logo, razón social, RUT, dirección. */
  profile: any;
  title: string;
  folio?: string;
  date: string;
  time: string;
  seller?: string | null;
  payment: string;
}

/** Encabezado del ticket: logo, nombre comercial, datos legales, vendedor, fecha, hora y pago. */
export function TicketHeader({ h, format }: { h: DocHeaderData; format: PrintFormat }) {
  const p = h.profile;
  const showRazon = p?.razonSocial && p.razonSocial.trim().toLowerCase() !== h.commercialName.trim().toLowerCase();
  return (
    <>
      <div style={{ textAlign: 'center' }}>
        {p?.logoUrl && <img src={imgUrl(p.logoUrl)} alt="" style={{ ...logoStyle(format, p.logoSize), display: 'block', margin: '0 auto 4px' }} />}
        <p style={{ fontWeight: 'bold', fontSize: '1.15em' }}>{h.commercialName}</p>
        {showRazon && <p>{p.razonSocial}</p>}
        {p?.rut && <p>RUT {p.rut}</p>}
        {(p?.address || p?.commune) && <p>{[p.address, p.commune].filter(Boolean).join(', ')}</p>}
        {p?.phone && <p>{p.phone}</p>}
      </div>
      <div className="ticket-sep" />
      <p style={{ fontWeight: 'bold', textAlign: 'center' }}>{h.title}{h.folio ? ` N° ${h.folio}` : ''}</p>
      <div style={{ marginTop: 4 }}>
        <div className="ticket-row"><span>Fecha</span><span>{h.date}</span></div>
        <div className="ticket-row"><span>Hora</span><span>{h.time}</span></div>
        <div className="ticket-row"><span>Vendedor</span><span style={{ textAlign: 'right' }}>{h.seller || '—'}</span></div>
        <div className="ticket-row"><span>Forma de pago</span><span style={{ textAlign: 'right' }}>{h.payment}</span></div>
      </div>
      <div className="ticket-sep" />
    </>
  );
}

/** Encabezado para hoja carta, con los mismos datos que el ticket. */
export function LetterHeader({ h, subtitle }: { h: DocHeaderData; subtitle?: string }) {
  const p = h.profile;
  const showRazon = p?.razonSocial && p.razonSocial.trim().toLowerCase() !== h.commercialName.trim().toLowerCase();
  const meta = { fontSize: 12, color: '#64748b', margin: '2px 0 0' } as const;
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, borderBottom: '2px solid #0f172a', paddingBottom: 16, marginBottom: 16 }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        {p?.logoUrl && <img src={imgUrl(p.logoUrl)} alt="" style={logoStyle('CARTA', p.logoSize)} />}
        <div>
          <h1 style={{ fontSize: 20, margin: 0 }}>{h.commercialName}</h1>
          {subtitle && <p style={{ fontSize: 13, color: '#64748b', margin: '4px 0 0' }}>{subtitle}</p>}
          {showRazon && <p style={meta}>{p.razonSocial}</p>}
          {p?.rut && <p style={meta}>RUT {p.rut}{p.giro ? ` — ${p.giro}` : ''}</p>}
          {(p?.address || p?.commune || p?.city) && <p style={meta}>{[p.address, p.commune, p.city].filter(Boolean).join(', ')}</p>}
          {(p?.phone || p?.email) && <p style={meta}>{[p.phone, p.email].filter(Boolean).join(' · ')}</p>}
        </div>
      </div>
      <div style={{ textAlign: 'right', fontSize: 12, color: '#475569' }}>
        <p style={{ fontSize: 18, fontWeight: 'bold', margin: 0, color: '#0f172a' }}>{h.title}{h.folio ? ` N° ${h.folio}` : ''}</p>
        <p style={{ margin: '4px 0 0' }}>Fecha: {h.date}</p>
        <p style={{ margin: '2px 0 0' }}>Hora: {h.time}</p>
        <p style={{ margin: '2px 0 0' }}>Vendedor: {h.seller || '—'}</p>
        <p style={{ margin: '2px 0 0' }}>Forma de pago: {h.payment}</p>
      </div>
    </div>
  );
}
