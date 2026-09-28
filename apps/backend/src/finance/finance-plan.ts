import { FinanceAccountType, SaleChannel } from '@prisma/client';

// Cuentas que alimenta la integración automática. El "real" de estas cuentas se calcula al
// vuelo desde ventas, comisiones, despachos y compras (ver FinanceService.automaticActuals).
export const SYSTEM_KEYS = {
  SALES_POS: 'SALES_POS',
  SALES_MERCADO_LIBRE: 'SALES_MERCADO_LIBRE',
  SALES_WALMART: 'SALES_WALMART',
  SALES_RIPLEY: 'SALES_RIPLEY',
  SALES_PARIS: 'SALES_PARIS',
  SALES_FALABELLA: 'SALES_FALABELLA',
  SALES_OTHER: 'SALES_OTHER',
  MARKETPLACE_FEES: 'MARKETPLACE_FEES',
  SHIPPING: 'SHIPPING',
  PURCHASES: 'PURCHASES',
} as const;

// Canal de venta → cuenta de ingresos. Los canales sin cuenta propia van a "Otros canales".
export function salesKeyForChannel(channel: SaleChannel): string {
  switch (channel) {
    case SaleChannel.POS: return SYSTEM_KEYS.SALES_POS;
    case SaleChannel.MERCADO_LIBRE: return SYSTEM_KEYS.SALES_MERCADO_LIBRE;
    case SaleChannel.WALMART: return SYSTEM_KEYS.SALES_WALMART;
    case SaleChannel.RIPLEY: return SYSTEM_KEYS.SALES_RIPLEY;
    case SaleChannel.PARIS: return SYSTEM_KEYS.SALES_PARIS;
    case SaleChannel.FALABELLA: return SYSTEM_KEYS.SALES_FALABELLA;
    default: return SYSTEM_KEYS.SALES_OTHER;
  }
}

export interface PlanNode {
  code: string;
  name: string;
  systemKey?: string;
  children?: PlanNode[];
}

// Plan base para un e-commerce chileno. Se carga la primera vez que la empresa abre Finanzas;
// después es libre de renombrar, mover, archivar o agregar cuentas.
export const BASE_PLAN: { type: FinanceAccountType; root: PlanNode }[] = [
  {
    type: FinanceAccountType.INCOME,
    root: {
      code: '4', name: 'Ingresos', children: [
        {
          code: '4.1', name: 'Ventas', children: [
            { code: '4.1.01', name: 'Punto de venta', systemKey: SYSTEM_KEYS.SALES_POS },
            { code: '4.1.02', name: 'Mercado Libre', systemKey: SYSTEM_KEYS.SALES_MERCADO_LIBRE },
            { code: '4.1.03', name: 'Walmart', systemKey: SYSTEM_KEYS.SALES_WALMART },
            { code: '4.1.04', name: 'Ripley', systemKey: SYSTEM_KEYS.SALES_RIPLEY },
            { code: '4.1.05', name: 'Paris', systemKey: SYSTEM_KEYS.SALES_PARIS },
            { code: '4.1.06', name: 'Falabella', systemKey: SYSTEM_KEYS.SALES_FALABELLA },
            { code: '4.1.07', name: 'Otros canales', systemKey: SYSTEM_KEYS.SALES_OTHER },
          ],
        },
        {
          code: '4.2', name: 'Otros ingresos', children: [
            { code: '4.2.01', name: 'Intereses y rendimientos' },
            { code: '4.2.02', name: 'Otros ingresos' },
          ],
        },
      ],
    },
  },
  {
    type: FinanceAccountType.EXPENSE,
    root: {
      code: '5', name: 'Gastos', children: [
        {
          code: '5.1', name: 'Costo de mercadería', children: [
            { code: '5.1.01', name: 'Compras de mercadería', systemKey: SYSTEM_KEYS.PURCHASES },
            { code: '5.1.02', name: 'Fletes e internación de compras' },
          ],
        },
        {
          code: '5.2', name: 'Costos de venta', children: [
            { code: '5.2.01', name: 'Comisiones de marketplaces', systemKey: SYSTEM_KEYS.MARKETPLACE_FEES },
            { code: '5.2.02', name: 'Despachos a cargo del vendedor', systemKey: SYSTEM_KEYS.SHIPPING },
            { code: '5.2.03', name: 'Embalaje y materiales' },
            { code: '5.2.04', name: 'Comisiones de medios de pago' },
          ],
        },
        {
          code: '5.3', name: 'Remuneraciones', children: [
            { code: '5.3.01', name: 'Sueldos' },
            { code: '5.3.02', name: 'Leyes sociales' },
            { code: '5.3.03', name: 'Honorarios' },
          ],
        },
        {
          code: '5.4', name: 'Gastos de operación', children: [
            { code: '5.4.01', name: 'Arriendo' },
            { code: '5.4.02', name: 'Servicios básicos' },
            { code: '5.4.03', name: 'Internet y telefonía' },
            { code: '5.4.04', name: 'Software y suscripciones' },
            { code: '5.4.05', name: 'Mantención y reparaciones' },
          ],
        },
        {
          code: '5.5', name: 'Marketing', children: [
            { code: '5.5.01', name: 'Publicidad en marketplaces' },
            { code: '5.5.02', name: 'Publicidad digital' },
            { code: '5.5.03', name: 'Otros de marketing' },
          ],
        },
        {
          code: '5.6', name: 'Gastos financieros', children: [
            { code: '5.6.01', name: 'Comisiones bancarias' },
            { code: '5.6.02', name: 'Intereses de créditos' },
          ],
        },
        {
          code: '5.7', name: 'Impuestos y patentes', children: [
            { code: '5.7.01', name: 'Patente municipal' },
            { code: '5.7.02', name: 'Otros impuestos' },
          ],
        },
        {
          code: '5.9', name: 'Otros gastos', children: [
            { code: '5.9.01', name: 'Gastos varios' },
          ],
        },
      ],
    },
  },
];
