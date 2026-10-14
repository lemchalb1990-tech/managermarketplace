'use client';

import { use, useEffect, useState } from 'react';
import { getToken } from '@/lib/auth';
import { api } from '@/lib/api';
import { useDashboardTimezone } from '@/lib/dashboardTimezone';
import { SkeletonDetail } from '@/components/Skeleton';
import {
  type PrintFormat, type DocHeaderData, PAYMENT_LABEL, fmtCLP, formatDateTime,
  PrintButton, TicketPage, TicketHeader, LetterHeader,
} from '../../printLayout';

const LABELS: Record<string, string> = { ...PAYMENT_LABEL, SIN_ESPECIFICAR: 'Sin especificar' };

// Comprobante del cierre de caja del punto de venta (mismo formato que los tickets de venta).
export default function PrintCashClosurePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const tz = useDashboardTimezone();
  const [closure, setClosure] = useState<any>(null);
  const [profile, setProfile] = useState<any>(null);
  const [printFormat, setPrintFormat] = useState<PrintFormat>('TICKET');
  const [error, setError] = useState('');

  useEffect(() => {
    const token = getToken();
    if (!token) { setError('Sesión no encontrada. Abre esta página desde el panel.'); return; }
    api.pos.cashClosures.get(id, token)
      .then(async (c) => {
        const [p, settings] = await Promise.all([
          api.billing.profile.get(token, c.companyId).catch(() => null),
          api.pos.settings.get(token, c.companyId).catch(() => null),
        ]);
        setProfile(p);
        if (settings) setPrintFormat(settings.printFormat);
        setClosure(c);
        setTimeout(() => window.print(), 400);
      })
      .catch((err) => setError(err.message || 'No se pudo cargar el cierre.'));
  }, [id]);

  if (error) return <div style={{ padding: 40, fontFamily: 'sans-serif', color: '#b91c1c' }}>{error}</div>;
  if (!closure) return <div style={{ padding: 40 }}><SkeletonDetail /></div>;

  const s = closure.summary || {};
  const payments: any[] = s.payments || [];
  const products: any[] = s.products || [];
  const orders = s.orders || { pickup: 0, delivery: 0, none: 0 };
  const diff = Number(closure.difference);
  const diffLabel = diff === 0 ? 'Cuadra' : diff > 0 ? 'Sobrante' : 'Faltante';
  const { date, time } = formatDateTime(closure.periodTo, tz);
  const from = formatDateTime(closure.periodFrom, tz);
  const header: DocHeaderData = {
    commercialName: closure.company?.name || profile?.razonSocial || 'Cierre de caja',
    profile,
    title: 'Cierre de caja',
    folio: String(closure.number).padStart(4, '0'),
    date,
    time,
    seller: closure.cashier?.name,
    payment: 'Punto de venta',
  };
  const rows: [string, string][] = [
    ['Ventas', String(closure.salesCount)],
    ['Productos vendidos', `${closure.itemsCount} un.`],
    ['Órdenes retiro / despacho', `${orders.pickup} / ${orders.delivery}`],
  ];
  const cashRows: [string, string][] = [
    ['Fondo inicial', fmtCLP(Number(closure.openingCash))],
    ['Ventas en efectivo', fmtCLP(Number(s.cashTotal || 0))],
    ['Efectivo esperado', fmtCLP(Number(closure.expectedCash))],
    ['Efectivo contado', fmtCLP(Number(closure.countedCash))],
    [diffLabel, fmtCLP(Math.abs(diff))],
  ];

  if (printFormat !== 'CARTA') {
    return (
      <TicketPage format={printFormat}>
        <TicketHeader h={header} format={printFormat} />
        <p>Turno: {from.date} {from.time} – {time}</p>
        <div className="ticket-sep" />
        {rows.map(([l, v]) => <div key={l} className="ticket-row"><span>{l}</span><span>{v}</span></div>)}
        <div className="ticket-sep" />
        <p style={{ fontWeight: 'bold' }}>Medios de pago</p>
        {payments.map((p) => (
          <div key={p.method} className="ticket-row"><span>{LABELS[p.method] || p.method} ({p.count})</span><span>{fmtCLP(p.total)}</span></div>
        ))}
        <div className="ticket-row" style={{ fontWeight: 'bold', fontSize: '1.1em' }}><span>Total</span><span>{fmtCLP(Number(closure.total))}</span></div>
        <div className="ticket-sep" />
        <p style={{ fontWeight: 'bold' }}>Arqueo de efectivo</p>
        {cashRows.map(([l, v], i) => (
          <div key={l} className="ticket-row" style={i === cashRows.length - 1 ? { fontWeight: 'bold' } : undefined}><span>{l}</span><span>{v}</span></div>
        ))}
        <div className="ticket-sep" />
        <p style={{ fontWeight: 'bold' }}>Productos</p>
        {products.map((p) => (
          <div key={p.productId || p.name} className="ticket-row"><span>{p.quantity} x {p.name}</span><span>{fmtCLP(p.total)}</span></div>
        ))}
        {closure.notes && (<><div className="ticket-sep" /><p style={{ whiteSpace: 'pre-wrap' }}>Obs.: {closure.notes}</p></>)}
        <p style={{ marginTop: 10 }}>Cerrado por: {closure.closedBy?.name || '—'}</p>
        <p style={{ marginTop: 24, textAlign: 'center' }}>______________________</p>
        <p style={{ textAlign: 'center' }}>Firma cajero</p>
      </TicketPage>
    );
  }

  return (
    <div style={{ fontFamily: 'Arial, sans-serif', color: '#0f172a', maxWidth: 720, margin: '0 auto', padding: 32 }}>
      <style>{`
        @media print { .no-print { display: none !important; } body { margin: 0; } }
        table { border-collapse: collapse; width: 100%; }
        th, td { padding: 6px 10px; text-align: left; font-size: 13px; }
        thead th { border-bottom: 2px solid #0f172a; font-size: 12px; text-transform: uppercase; color: #475569; }
        tbody tr { border-bottom: 1px solid #e2e8f0; }
        h3 { font-size: 14px; margin: 20px 0 6px; }
      `}</style>
      <PrintButton align="right" />
      <LetterHeader h={header} subtitle={`Turno ${from.date} ${from.time} – ${date} ${time}`} />

      <table><tbody>{rows.map(([l, v]) => <tr key={l}><td>{l}</td><td style={{ textAlign: 'right' }}>{v}</td></tr>)}</tbody></table>

      <h3>Medios de pago</h3>
      <table>
        <thead><tr><th>Medio</th><th style={{ textAlign: 'right' }}>Pagos</th><th style={{ textAlign: 'right' }}>Monto</th></tr></thead>
        <tbody>
          {payments.map((p) => (
            <tr key={p.method}><td>{LABELS[p.method] || p.method}</td><td style={{ textAlign: 'right' }}>{p.count}</td><td style={{ textAlign: 'right' }}>{fmtCLP(p.total)}</td></tr>
          ))}
          <tr><td style={{ fontWeight: 'bold' }}>Total</td><td /><td style={{ textAlign: 'right', fontWeight: 'bold' }}>{fmtCLP(Number(closure.total))}</td></tr>
        </tbody>
      </table>

      <h3>Arqueo de efectivo</h3>
      <table><tbody>{cashRows.map(([l, v], i) => (
        <tr key={l} style={i === cashRows.length - 1 ? { fontWeight: 'bold' } : undefined}><td>{l}</td><td style={{ textAlign: 'right' }}>{v}</td></tr>
      ))}</tbody></table>

      <h3>Productos vendidos</h3>
      <table>
        <thead><tr><th>SKU</th><th>Producto</th><th style={{ textAlign: 'right' }}>Cant.</th><th style={{ textAlign: 'right' }}>Monto</th></tr></thead>
        <tbody>
          {products.map((p) => (
            <tr key={p.productId || p.name}><td>{p.sku || '—'}</td><td>{p.name}</td><td style={{ textAlign: 'right' }}>{p.quantity}</td><td style={{ textAlign: 'right' }}>{fmtCLP(p.total)}</td></tr>
          ))}
        </tbody>
      </table>

      {closure.notes && <p style={{ marginTop: 16, fontSize: 13 }}><strong>Observaciones:</strong> {closure.notes}</p>}
      <p style={{ marginTop: 16, fontSize: 13 }}>Cerrado por: {closure.closedBy?.name || '—'}</p>
      <div style={{ marginTop: 48, display: 'flex', justifyContent: 'space-around', fontSize: 13 }}>
        <div style={{ textAlign: 'center' }}>______________________<br />Firma cajero</div>
        <div style={{ textAlign: 'center' }}>______________________<br />Firma supervisor</div>
      </div>
    </div>
  );
}
