'use client';

import { use, useEffect, useState } from 'react';
import { getToken, getUser } from '@/lib/auth';
import { api } from '@/lib/api';
import { useDashboardTimezone } from '@/lib/dashboardTimezone';
import { SkeletonDetail } from '@/components/Skeleton';
import {
  type PrintFormat, type DocHeaderData, PAYMENT_LABEL, fmtCLP, formatDateTime,
  PrintButton, TicketPage, TicketHeader, LetterHeader,
} from '../../printLayout';

const STATUS_LABEL: Record<string, string> = {
  PENDING: 'Presupuesto pendiente', CONVERTED: 'Cobrada', REJECTED: 'Rechazada', CANCELLED: 'Anulada',
};

export default function PrintWorkOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const tz = useDashboardTimezone();
  const [workOrder, setWorkOrder] = useState<any>(null);
  const [profile, setProfile] = useState<any>(null);
  const [printFormat, setPrintFormat] = useState<PrintFormat>('CARTA');
  const [error, setError] = useState('');
  const user = getUser();

  useEffect(() => {
    const token = getToken();
    if (!token) { setError('Sesión no encontrada. Abre esta página desde el panel.'); return; }
    api.pos.workOrders.get(id, token)
      .then(async (wo) => {
        // Membrete (logo/razón social/RUT/dirección) — mismo Perfil de Facturación que
        // usan boletas y facturas. Se espera junto con el formato antes de mostrar e
        // imprimir, para que el diálogo de impresión no salga con el ancho equivocado.
        const [p, s] = await Promise.all([
          api.billing.profile.get(token, wo.companyId).catch(() => null),
          api.pos.settings.get(token, wo.companyId).catch(() => null),
        ]);
        setProfile(p);
        if (s) setPrintFormat(s.printFormat);
        setWorkOrder(wo);
        setTimeout(() => window.print(), 400);
      })
      .catch((err) => setError(err.message || 'No se pudo cargar la orden de trabajo.'));
  }, [id]);

  if (error) {
    return <div style={{ padding: 40, fontFamily: 'sans-serif', color: '#b91c1c' }}>{error}</div>;
  }
  if (!workOrder) {
    return <div style={{ padding: 40 }}><SkeletonDetail /></div>;
  }

  const total = workOrder.items.reduce((s: number, i: any) => s + i.quantity * Number(i.unitPrice), 0);
  const clientName = workOrder.client?.name || workOrder.customerName;
  const clientPhone = workOrder.client?.phone || workOrder.customerPhone;
  const clientEmail = workOrder.client?.email || workOrder.customerEmail;
  const { date, time } = formatDateTime(workOrder.createdAt, tz);
  const salePayment = workOrder.sale?.paymentMethod;
  const header: DocHeaderData = {
    commercialName: workOrder.company?.name || user?.company?.name || profile?.razonSocial || 'Orden de trabajo',
    profile,
    title: 'Orden de trabajo',
    folio: String(workOrder.folio).padStart(4, '0'),
    date,
    time,
    seller: workOrder.user?.name,
    payment: salePayment ? (PAYMENT_LABEL[salePayment] || salePayment) : 'Por definir',
  };

  if (printFormat !== 'CARTA') {
    return (
      <TicketPage format={printFormat}>
        <TicketHeader h={header} format={printFormat} />

        <p>Estado: {STATUS_LABEL[workOrder.status] || workOrder.status}</p>
        {clientName && <p>Cliente: {clientName}</p>}
        {clientPhone && <p>Teléfono: {clientPhone}</p>}
        <div className="ticket-sep" />

        {workOrder.items.map((item: any) => (
          <div key={item.id} style={{ marginBottom: 4 }}>
            <p>{item.productName}{item.productSku ? ` (${item.productSku})` : ''}</p>
            <div className="ticket-row">
              <span>{item.quantity} x {fmtCLP(Number(item.unitPrice))}</span>
              <span>{fmtCLP(item.quantity * Number(item.unitPrice))}</span>
            </div>
          </div>
        ))}

        <div className="ticket-sep" />
        <div className="ticket-row" style={{ fontWeight: 'bold', fontSize: '1.15em' }}>
          <span>Total</span>
          <span>{fmtCLP(total)}</span>
        </div>

        {workOrder.notes && (
          <div style={{ marginTop: 6 }}>
            <p style={{ fontWeight: 'bold' }}>Notas</p>
            <p style={{ whiteSpace: 'pre-wrap' }}>{workOrder.notes}</p>
          </div>
        )}

        <p style={{ marginTop: 10, fontSize: '0.85em', textAlign: 'center' }}>
          Presupuesto/orden de trabajo, no constituye boleta ni factura.
        </p>
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

      <LetterHeader h={header} subtitle={`Presupuesto / Orden de trabajo · ${STATUS_LABEL[workOrder.status] || workOrder.status}`} />

      {(clientName || clientPhone || clientEmail) && (
        <div style={{ marginBottom: 16, fontSize: 13 }}>
          <p style={{ fontWeight: 'bold', margin: '0 0 4px' }}>Cliente</p>
          {clientName && <p style={{ margin: '2px 0' }}>{clientName}</p>}
          {clientPhone && <p style={{ margin: '2px 0', color: '#475569' }}>{clientPhone}</p>}
          {clientEmail && <p style={{ margin: '2px 0', color: '#475569' }}>{clientEmail}</p>}
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
          {workOrder.items.map((item: any) => (
            <tr key={item.id}>
              <td>{item.productName}{item.productSku ? ` (${item.productSku})` : ''}</td>
              <td style={{ textAlign: 'right' }}>{item.quantity}</td>
              <td style={{ textAlign: 'right' }}>{fmtCLP(Number(item.unitPrice))}</td>
              <td style={{ textAlign: 'right' }}>{fmtCLP(item.quantity * Number(item.unitPrice))}</td>
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

      {workOrder.notes && (
        <div style={{ marginTop: 20, fontSize: 13 }}>
          <p style={{ fontWeight: 'bold', margin: '0 0 4px' }}>Notas</p>
          <p style={{ margin: 0, color: '#475569', whiteSpace: 'pre-wrap' }}>{workOrder.notes}</p>
        </div>
      )}

      <div style={{ marginTop: 48, display: 'flex', justifyContent: 'space-between', gap: 40 }}>
        <div style={{ flex: 1, textAlign: 'center' }}>
          <div style={{ borderTop: '1px solid #0f172a', paddingTop: 6, fontSize: 12, color: '#475569' }}>Firma cliente</div>
        </div>
        <div style={{ flex: 1, textAlign: 'center' }}>
          <div style={{ borderTop: '1px solid #0f172a', paddingTop: 6, fontSize: 12, color: '#475569' }}>Firma responsable</div>
        </div>
      </div>

      <p style={{ marginTop: 24, fontSize: 11, color: '#94a3b8', textAlign: 'center' }}>
        Este documento es un presupuesto/orden de trabajo, no constituye una boleta ni factura.
        El precio y disponibilidad quedan sujetos a confirmación al momento de aceptar el trabajo.
      </p>
    </div>
  );
}
