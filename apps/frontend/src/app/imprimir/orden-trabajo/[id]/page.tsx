'use client';

import { use, useEffect, useState } from 'react';
import { getToken, getUser } from '@/lib/auth';
import { api } from '@/lib/api';
import { useDashboardTimezone } from '@/lib/dashboardTimezone';
import { SkeletonDetail } from '@/components/Skeleton';
import { type PrintFormat, type DocHeaderData, PAYMENT_LABEL, formatDateTime } from '../../printLayout';
import { DesignedDocument } from '../../DesignedDocument';
import { resolveLayout, resolveMargins, type PrintLayouts } from '@/lib/printDesign';

const STATUS_LABEL: Record<string, string> = {
  PENDING: 'Presupuesto pendiente', CONVERTED: 'Cobrada', REJECTED: 'Rechazada', CANCELLED: 'Anulada',
};

export default function PrintWorkOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const tz = useDashboardTimezone();
  const [workOrder, setWorkOrder] = useState<any>(null);
  const [profile, setProfile] = useState<any>(null);
  const [printFormat, setPrintFormat] = useState<PrintFormat>('CARTA');
  const [layouts, setLayouts] = useState<PrintLayouts | null>(null);
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
        if (s) { setPrintFormat(s.printFormat); setLayouts(s.printLayouts ?? null); }
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

  const status = STATUS_LABEL[workOrder.status] || workOrder.status;
  // Diseño por bloques de la empresa (Ajustes → Diseño de documentos), en el formato elegido.
  return (
    <DesignedDocument
      doc="WORK_ORDER"
      format={printFormat}
      blocks={resolveLayout(layouts, 'WORK_ORDER')}
      margins={printFormat === 'CARTA' ? undefined : resolveMargins(layouts)[printFormat]}
      data={{
        header,
        subtitle: `Presupuesto / Orden de trabajo · ${status}`,
        status,
        client: clientName || clientPhone || clientEmail ? { name: clientName, phone: clientPhone, email: clientEmail } : null,
        items: workOrder.items.map((i: any) => ({ id: i.id, name: i.productName, sku: i.productSku, quantity: i.quantity, unitPrice: Number(i.unitPrice) })),
        total,
        notes: workOrder.notes,
        legend: {
          ticket: 'Presupuesto/orden de trabajo, no constituye boleta ni factura.',
          carta: 'Este documento es un presupuesto/orden de trabajo, no constituye una boleta ni factura. El precio y disponibilidad quedan sujetos a confirmación al momento de aceptar el trabajo.',
        },
      }}
    />
  );
}
