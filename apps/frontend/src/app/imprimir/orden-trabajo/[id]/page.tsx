'use client';

import { use, useEffect, useState } from 'react';
import { getToken, getUser } from '@/lib/auth';
import { api, imgUrl } from '@/lib/api';
import { useDashboardTimezone } from '@/lib/dashboardTimezone';

const STATUS_LABEL: Record<string, string> = {
  PENDING: 'Presupuesto pendiente', CONVERTED: 'Cobrada', REJECTED: 'Rechazada', CANCELLED: 'Anulada',
};

export default function PrintWorkOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const tz = useDashboardTimezone();
  const [workOrder, setWorkOrder] = useState<any>(null);
  const [profile, setProfile] = useState<any>(null);
  const [printFormat, setPrintFormat] = useState<'CARTA' | 'TICKET'>('CARTA');
  const [error, setError] = useState('');
  const user = getUser();

  useEffect(() => {
    const token = getToken();
    if (!token) { setError('Sesión no encontrada. Abre esta página desde el panel.'); return; }
    api.pos.workOrders.get(id, token)
      .then((wo) => {
        setWorkOrder(wo);
        // Membrete (logo/razón social/RUT/dirección) — mismo Perfil de Facturación que
        // usan boletas y facturas, para no duplicar el dato en dos lugares. Si la empresa
        // no lo configuró todavía, se sigue mostrando solo el nombre (como antes).
        api.billing.profile.get(token, wo.companyId).then(setProfile).catch(() => {});
        api.pos.settings.get(token, wo.companyId).then((s) => setPrintFormat(s.workOrderPrintFormat)).catch(() => {});
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
  const companyName = profile?.razonSocial || user?.company?.name || 'Orden de trabajo';

  if (printFormat === 'TICKET') {
    return (
      <div style={{ fontFamily: 'monospace', color: '#0f172a', width: 280, margin: '0 auto', padding: 12, fontSize: 12 }}>
        <style>{`
          @media print {
            .no-print { display: none !important; }
            body { margin: 0; }
            @page { size: 80mm auto; margin: 2mm; }
          }
        `}</style>

        <div className="no-print" style={{ textAlign: 'center', marginBottom: 12 }}>
          <button onClick={() => window.print()} style={{ padding: '8px 16px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, cursor: 'pointer' }}>
            Imprimir
          </button>
        </div>

        <div style={{ textAlign: 'center', marginBottom: 8 }}>
          {profile?.logoUrl && <img src={imgUrl(profile.logoUrl)} alt="" style={{ width: 40, height: 40, objectFit: 'contain', margin: '0 auto 4px' }} />}
          <p style={{ fontWeight: 'bold', margin: 0 }}>{companyName}</p>
          {profile?.rut && <p style={{ margin: '2px 0 0' }}>RUT {profile.rut}</p>}
          {(profile?.address || profile?.commune) && (
            <p style={{ margin: '2px 0 0' }}>{[profile.address, profile.commune].filter(Boolean).join(', ')}</p>
          )}
          {profile?.phone && <p style={{ margin: '2px 0 0' }}>{profile.phone}</p>}
        </div>

        <div style={{ borderTop: '1px dashed #0f172a', borderBottom: '1px dashed #0f172a', padding: '6px 0', margin: '8px 0' }}>
          <p style={{ margin: 0 }}>Orden N° {String(workOrder.folio).padStart(4, '0')}</p>
          <p style={{ margin: '2px 0 0' }}>
            {new Date(workOrder.createdAt).toLocaleDateString('es-CL', { day: '2-digit', month: 'short', year: 'numeric', timeZone: tz })}
          </p>
          <p style={{ margin: '2px 0 0' }}>{STATUS_LABEL[workOrder.status] || workOrder.status}</p>
        </div>

        {(clientName || clientPhone) && (
          <div style={{ marginBottom: 8 }}>
            {clientName && <p style={{ margin: 0 }}>Cliente: {clientName}</p>}
            {clientPhone && <p style={{ margin: '2px 0 0' }}>{clientPhone}</p>}
          </div>
        )}

        <div style={{ borderTop: '1px dashed #0f172a', paddingTop: 6 }}>
          {workOrder.items.map((item: any) => (
            <div key={item.id} style={{ marginBottom: 6 }}>
              <p style={{ margin: 0 }}>{item.productName}{item.productSku ? ` (${item.productSku})` : ''}</p>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>{item.quantity} x {fmt(Number(item.unitPrice))}</span>
                <span>{fmt(item.quantity * Number(item.unitPrice))}</span>
              </div>
            </div>
          ))}
        </div>

        <div style={{ borderTop: '1px dashed #0f172a', paddingTop: 6, display: 'flex', justifyContent: 'space-between', fontWeight: 'bold' }}>
          <span>Total</span>
          <span>{fmt(total)}</span>
        </div>

        {workOrder.notes && (
          <div style={{ marginTop: 8 }}>
            <p style={{ margin: 0, fontWeight: 'bold' }}>Notas</p>
            <p style={{ margin: '2px 0 0', whiteSpace: 'pre-wrap' }}>{workOrder.notes}</p>
          </div>
        )}

        <p style={{ marginTop: 10, fontSize: 10, color: '#64748b', textAlign: 'center' }}>
          Presupuesto/orden de trabajo, no constituye boleta ni factura.
        </p>
      </div>
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

      <div className="no-print" style={{ textAlign: 'right', marginBottom: 16 }}>
        <button onClick={() => window.print()} style={{ padding: '8px 16px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, cursor: 'pointer' }}>
          Imprimir
        </button>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '2px solid #0f172a', paddingBottom: 16, marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
          {profile?.logoUrl && (
            <img src={imgUrl(profile.logoUrl)} alt="" style={{ width: 56, height: 56, objectFit: 'contain' }} />
          )}
          <div>
            <h1 style={{ fontSize: 20, margin: 0 }}>{companyName}</h1>
            <p style={{ fontSize: 13, color: '#64748b', margin: '4px 0 0' }}>Presupuesto / Orden de trabajo</p>
            {profile?.rut && <p style={{ fontSize: 12, color: '#64748b', margin: '2px 0 0' }}>RUT {profile.rut}{profile.giro ? ` — ${profile.giro}` : ''}</p>}
            {(profile?.address || profile?.commune || profile?.city) && (
              <p style={{ fontSize: 12, color: '#64748b', margin: '2px 0 0' }}>
                {[profile.address, profile.commune, profile.city].filter(Boolean).join(', ')}
              </p>
            )}
            {(profile?.phone || profile?.email) && (
              <p style={{ fontSize: 12, color: '#64748b', margin: '2px 0 0' }}>
                {[profile.phone, profile.email].filter(Boolean).join(' · ')}
              </p>
            )}
          </div>
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
