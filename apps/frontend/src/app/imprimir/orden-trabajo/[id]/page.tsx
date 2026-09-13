'use client';

import { use, useEffect, useState } from 'react';
import { getToken, getUser } from '@/lib/auth';
import { api } from '@/lib/api';
import { useDashboardTimezone } from '@/lib/dashboardTimezone';

const STATUS_LABEL: Record<string, string> = {
  PENDING: 'Presupuesto pendiente', CONVERTED: 'Cobrada', REJECTED: 'Rechazada', CANCELLED: 'Anulada',
};

export default function PrintWorkOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const tz = useDashboardTimezone();
  const [workOrder, setWorkOrder] = useState<any>(null);
  const [error, setError] = useState('');
  const user = getUser();

  useEffect(() => {
    const token = getToken();
    if (!token) { setError('Sesión no encontrada. Abre esta página desde el panel.'); return; }
    api.pos.workOrders.get(id, token)
      .then((wo) => {
        setWorkOrder(wo);
        setTimeout(() => window.print(), 300);
      })
      .catch((err) => setError(err.message || 'No se pudo cargar la orden de trabajo.'));
  }, [id]);

  const fmt = (v: number) => `$${Math.round(v).toLocaleString('es-CL')}`;

  if (error) {
    return <div style={{ padding: 40, fontFamily: 'sans-serif', color: '#b91c1c' }}>{error}</div>;
  }
  if (!workOrder) {
    return <div style={{ padding: 40, fontFamily: 'sans-serif', color: '#64748b' }}>Cargando...</div>;
  }

  const total = workOrder.items.reduce((s: number, i: any) => s + i.quantity * Number(i.unitPrice), 0);
  const clientName = workOrder.client?.name || workOrder.customerName;
  const clientPhone = workOrder.client?.phone || workOrder.customerPhone;
  const clientEmail = workOrder.client?.email || workOrder.customerEmail;

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

      <div className="no-print" style={{ textAlign: 'right', marginBottom: 16 }}>
        <button onClick={() => window.print()} style={{ padding: '8px 16px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, cursor: 'pointer' }}>
          Imprimir
        </button>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '2px solid #0f172a', paddingBottom: 16, marginBottom: 16 }}>
        <div>
          <h1 style={{ fontSize: 20, margin: 0 }}>{user?.company?.name || 'Orden de trabajo'}</h1>
          <p style={{ fontSize: 13, color: '#64748b', margin: '4px 0 0' }}>Presupuesto / Orden de trabajo</p>
        </div>
        <div style={{ textAlign: 'right' }}>
          <p style={{ fontSize: 18, fontWeight: 'bold', margin: 0 }}>N° {String(workOrder.folio).padStart(4, '0')}</p>
          <p style={{ fontSize: 12, color: '#64748b', margin: '4px 0 0' }}>
            {new Date(workOrder.createdAt).toLocaleDateString('es-CL', { day: '2-digit', month: 'long', year: 'numeric', timeZone: tz })}
          </p>
          <p style={{ fontSize: 12, color: '#64748b', margin: '4px 0 0' }}>{STATUS_LABEL[workOrder.status] || workOrder.status}</p>
        </div>
      </div>

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
              <td style={{ textAlign: 'right' }}>{fmt(Number(item.unitPrice))}</td>
              <td style={{ textAlign: 'right' }}>{fmt(item.quantity * Number(item.unitPrice))}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
        <div style={{ minWidth: 200, display: 'flex', justifyContent: 'space-between', fontSize: 16, fontWeight: 'bold', borderTop: '2px solid #0f172a', paddingTop: 8 }}>
          <span>Total</span>
          <span>{fmt(total)}</span>
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
