'use client';

import { use, useEffect, useState } from 'react';
import { getToken, getUser } from '@/lib/auth';
import { api } from '@/lib/api';
import { useDashboardTimezone } from '@/lib/dashboardTimezone';
import { SkeletonDetail } from '@/components/Skeleton';
import { type PrintFormat, type DocHeaderData, PAYMENT_LABEL, fmtCLP, formatDateTime } from '../../printLayout';
import { DesignedDocument } from '../../DesignedDocument';
import { resolveLayout, resolveMargins, type PrintLayouts } from '@/lib/printDesign';

const DTE_LABEL: Record<string, string> = { BOLETA: 'Boleta', FACTURA: 'Factura', FACTURA_EXENTA: 'Factura exenta' };

// Comprobante interno de la venta directa (POS). Usa el mismo formato de impresión que las
// órdenes de trabajo (carta, ticket 80 mm o ticket 58 mm).
export default function PrintSalePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const tz = useDashboardTimezone();
  const [sale, setSale] = useState<any>(null);
  const [profile, setProfile] = useState<any>(null);
  const [printFormat, setPrintFormat] = useState<PrintFormat>('TICKET');
  const [layouts, setLayouts] = useState<PrintLayouts | null>(null);
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
        if (settings) { setPrintFormat(settings.printFormat); setLayouts(settings.printLayouts ?? null); }
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
    // Pago con varios medios: el detalle de cada uno con su monto.
    payment: sale.payments?.length > 1
      ? sale.payments.map((p: any) => `${PAYMENT_LABEL[p.method] || p.method} ${fmtCLP(Number(p.amount))}`).join(' · ')
      : sale.paymentMethod ? (PAYMENT_LABEL[sale.paymentMethod] || sale.paymentMethod) : (sale.paymentMethodName || '—'),
  };

  // Diseño por bloques de la empresa (Ajustes → Diseño de documentos), en el formato elegido.
  return (
    <DesignedDocument
      doc="SALE"
      format={printFormat}
      blocks={resolveLayout(layouts, 'SALE')}
      margins={printFormat === 'CARTA' ? undefined : resolveMargins(layouts)[printFormat]}
      data={{
        header,
        subtitle: 'Comprobante de venta',
        client: clientName || clientRut ? { name: clientName, rut: clientRut } : null,
        items,
        total,
        documents: docs.map((inv: any) => `${DTE_LABEL[inv.dteType] || inv.dteType} N° ${inv.folio}`),
        notes: sale.notes,
        scan: scanCode ? { code: scanCode, label: scanLabel } : null,
        legend: docs.length === 0
          ? { ticket: 'Comprobante interno, no válido como boleta.', carta: 'Comprobante interno de venta, no constituye boleta ni factura.' }
          : null,
      }}
    />
  );
}
