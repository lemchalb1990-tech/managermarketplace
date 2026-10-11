'use client';

import { use, useEffect, useState } from 'react';
import { Barcode128 } from '@/components/Barcode128';
import { getToken, getUser } from '@/lib/auth';
import { api } from '@/lib/api';
import { useDashboardTimezone } from '@/lib/dashboardTimezone';
import { SkeletonDetail } from '@/components/Skeleton';
import {
  type PrintFormat, type DocHeaderData, PAYMENT_LABEL, fmtCLP, formatDateTime,
  PrintButton, TicketPage, TicketHeader, LetterHeader,
} from '../../printLayout';

const DTE_LABEL: Record<string, string> = { BOLETA: 'Boleta', FACTURA: 'Factura', FACTURA_EXENTA: 'Factura exenta' };

// Comprobante interno de la venta directa (POS). Usa el mismo formato de impresión que las
// órdenes de trabajo (carta, ticket 80 mm o ticket 58 mm).
export default function PrintSalePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const tz = useDashboardTimezone();
  const [sale, setSale] = useState<any>(null);
  const [profile, setProfile] = useState<any>(null);
  const [printFormat, setPrintFormat] = useState<PrintFormat>('TICKET');
  const [error, setError] = useState('');
  const user = getUser();

  useEffect(() => {
    const token = getToken();
    if (!token) { setError('Sesión no encontrada. Abre esta página desde el panel.'); return; }
    api.pos.getSale(id, token)
      .then(async (s) => {
        const [p, settings] = await Promise.all([
          api.billing.profile.get(token, s.companyId).catch(() => null),
          api.pos.settings.get(token, s.companyId).catch(() => null),
        ]);
        setProfile(p);
        if (settings) setPrintFormat(settings.printFormat);
        setSale(s);
        setTimeout(() => window.print(), 400);
      })
      .catch((err) => setError(err.message || 'No se pudo cargar la venta.'));
  }, [id]);

  if (error) {
    return <div style={{ padding: 40, fontFamily: 'sans-serif', color: '#b91c1c' }}>{error}</div>;
  }
  if (!sale) {
    return <div style={{ padding: 40 }}><SkeletonDetail /></div>;
  }

  const items = sale.items.map((i: any) => ({
    id: i.id,
    name: i.product?.name || i.productName || 'Producto',
    sku: i.product?.sku,
    quantity: i.quantity,
    unitPrice: Number(i.unitPrice),
  }));
  const total = Number(sale.total);
  const clientName = sale.client?.name || sale.customerName;
  const clientRut = sale.client?.rut;
  const docs = (sale.invoices || []).filter((inv: any) => inv.folio);
  const { date, time } = formatDateTime(sale.createdAt, tz);
  // Código de barras con el número de venta: va en todo ticket de venta directa (cualquier formato).
  // Largo par (con cero adelante si hace falta): Code 128 usa su forma compacta y cabe en 58 mm.
  const scanDigits = sale.saleNumber != null ? String(sale.saleNumber).padStart(4, '0') : '';
  const scanCode = scanDigits ? (scanDigits.length % 2 ? `0${scanDigits}` : scanDigits) : null;
  // Texto bajo el código: si la venta tiene orden de bodega, se escanea para prepararla.
  const scanLabel = sale.order ? `${sale.order.fulfillmentType === 'DELIVERY' ? 'Despacho' : 'Retiro'} · escanear en bodega` : `Venta N° ${scanDigits}`;
  const header: DocHeaderData = {
    commercialName: sale.company?.name || user?.company?.name || profile?.razonSocial || 'Venta',
    profile,
    title: 'Venta',
    folio: sale.saleNumber != null ? String(sale.saleNumber).padStart(4, '0') : undefined,
    date,
    time,
    seller: sale.user?.name,
    payment: sale.paymentMethod ? (PAYMENT_LABEL[sale.paymentMethod] || sale.paymentMethod) : (sale.paymentMethodName || '—'),
  };

  if (printFormat !== 'CARTA') {
    return (
      <TicketPage format={printFormat}>
        <TicketHeader h={header} format={printFormat} />

        {(clientName || clientRut) && (
          <>
            {clientName && <p>Cliente: {clientName}</p>}
            {clientRut && <p>RUT: {clientRut}</p>}
            <div className="ticket-sep" />
          </>
        )}

        {items.map((item: any) => (
          <div key={item.id} style={{ marginBottom: 4 }}>
            <p>{item.name}</p>
            <div className="ticket-row">
              <span>{item.quantity} x {fmtCLP(item.unitPrice)}</span>
              <span>{fmtCLP(item.quantity * item.unitPrice)}</span>
            </div>
          </div>
        ))}

        <div className="ticket-sep" />
        <div className="ticket-row" style={{ fontWeight: 'bold', fontSize: '1.15em' }}>
          <span>Total</span>
          <span>{fmtCLP(total)}</span>
        </div>

        {docs.map((inv: any) => (
          <p key={inv.id} style={{ marginTop: 4 }}>{DTE_LABEL[inv.dteType] || inv.dteType} N° {inv.folio}</p>
        ))}

        {sale.notes && (
          <div style={{ marginTop: 6 }}>
            <p style={{ fontWeight: 'bold' }}>Notas</p>
            <p style={{ whiteSpace: 'pre-wrap' }}>{sale.notes}</p>
          </div>
        )}

        <p style={{ marginTop: 10, textAlign: 'center' }}>¡Gracias por su compra!</p>
        {docs.length === 0 && (
          <p style={{ marginTop: 4, fontSize: '0.85em', textAlign: 'center' }}>Comprobante interno, no válido como boleta.</p>
        )}

        {/* Al final del ticket: código para escanear la orden en bodega. */}
        {scanCode && (
          <div style={{ marginTop: 10, paddingTop: 6, borderTop: '1px dashed #000', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <Barcode128 value={scanCode} height={printFormat === 'TICKET_58' ? 40 : 44} module={printFormat === 'TICKET_58' ? 1.5 : 1.8} />
            <p style={{ fontSize: '0.8em', marginTop: 2 }}>{scanLabel}</p>
          </div>
        )}
      </TicketPage>
    );
  }

  return (
    <div style={{ fontFamily: 'Arial, sans-serif', color: '#0f172a', maxWidth: 720, margin: '0 auto', padding: 32 }}>
      <style>{`
        @media print {
          .no-print { display: none !important; }
          body { margin: 0; }
        }
        table { border-collapse: collapse; width: 100%; }
        th, td { padding: 8px 10px; text-align: left; }
        thead th { border-bottom: 2px solid #0f172a; font-size: 12px; text-transform: uppercase; color: #475569; }
        tbody tr { border-bottom: 1px solid #e2e8f0; }
      `}</style>

      <PrintButton align="right" />

      <LetterHeader h={header} subtitle="Comprobante de venta" />

      {(clientName || clientRut) && (
        <div style={{ marginBottom: 16, fontSize: 13 }}>
          <p style={{ fontWeight: 'bold', margin: '0 0 4px' }}>Cliente</p>
          {clientName && <p style={{ margin: '2px 0' }}>{clientName}</p>}
          {clientRut && <p style={{ margin: '2px 0', color: '#475569' }}>RUT {clientRut}</p>}
        </div>
      )}

      <table>
        <thead>
          <tr>
            <th>Descripción</th>
            <th style={{ textAlign: 'right' }}>Cant.</th>
            <th style={{ textAlign: 'right' }}>Precio unit.</th>
            <th style={{ textAlign: 'right' }}>Subtotal</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item: any) => (
            <tr key={item.id}>
              <td>{item.name}{item.sku ? ` (${item.sku})` : ''}</td>
              <td style={{ textAlign: 'right' }}>{item.quantity}</td>
              <td style={{ textAlign: 'right' }}>{fmtCLP(item.unitPrice)}</td>
              <td style={{ textAlign: 'right' }}>{fmtCLP(item.quantity * item.unitPrice)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
        <div style={{ minWidth: 200, display: 'flex', justifyContent: 'space-between', fontSize: 16, fontWeight: 'bold', borderTop: '2px solid #0f172a', paddingTop: 8 }}>
          <span>Total</span>
          <span>{fmtCLP(total)}</span>
        </div>
      </div>

      {docs.length > 0 && (
        <p style={{ marginTop: 12, fontSize: 13 }}>
          Documento tributario: {docs.map((inv: any) => `${DTE_LABEL[inv.dteType] || inv.dteType} N° ${inv.folio}`).join(', ')}
        </p>
      )}

      {sale.notes && (
        <div style={{ marginTop: 20, fontSize: 13 }}>
          <p style={{ fontWeight: 'bold', margin: '0 0 4px' }}>Notas</p>
          <p style={{ margin: 0, color: '#475569', whiteSpace: 'pre-wrap' }}>{sale.notes}</p>
        </div>
      )}

      {docs.length === 0 && (
        <p style={{ marginTop: 24, fontSize: 11, color: '#94a3b8', textAlign: 'center' }}>
          Comprobante interno de venta, no constituye boleta ni factura.
        </p>
      )}

      {scanCode && (
        <div style={{ marginTop: 24, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <Barcode128 value={scanCode} height={56} module={2} />
          <p style={{ fontSize: 11, color: '#475569', marginTop: 2 }}>{scanLabel}</p>
        </div>
      )}
    </div>
  );
}
