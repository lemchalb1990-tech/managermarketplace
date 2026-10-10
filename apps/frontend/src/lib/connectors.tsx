import type { ReactNode } from 'react';
import { Logos } from '@/app/dashboard/ecommerce/components/logos';
import { BillingLogos } from '@/app/dashboard/billing/components/logos';
import { CourierLogos } from '@/app/dashboard/couriers/logos';

// Registro único de los sincronizadores del sistema. La clave es la misma de PlatformSetting
// (logo, nombre y estado editables por el Super Admin). Un sincronizador nuevo se agrega aquí.

export type ConnectorStatus = 'AVAILABLE' | 'SOON' | 'DISABLED';
export type ConnectorGroup = 'ecommerce' | 'billing' | 'couriers' | 'dropshipping';

export type Connector = {
  key: string;
  name: string;
  group: ConnectorGroup;
  description: string;
  logo?: ReactNode;
  // Estado si el Super Admin no lo ha cambiado (los nuevos sin validar parten desactivados).
  defaultStatus: ConnectorStatus;
};

export const GROUP_LABELS: Record<ConnectorGroup, string> = {
  ecommerce: 'E-commerce',
  billing: 'Facturación',
  couriers: 'Couriers',
  dropshipping: 'Dropshipping',
};

const DropLogo = (
  <div className="w-full h-full flex items-center justify-center bg-indigo-500 text-white text-sm font-bold rounded-[8px]">NO</div>
);

export const CONNECTORS: Connector[] = [
  { key: 'mercadolibre', name: 'Mercado Libre', group: 'ecommerce', description: 'Publicaciones, ventas, preguntas y reclamos.', logo: Logos.mercadolibre, defaultStatus: 'AVAILABLE' },
  { key: 'falabella', name: 'Falabella', group: 'ecommerce', description: 'Seller Center de Falabella.', logo: Logos.falabella, defaultStatus: 'AVAILABLE' },
  { key: 'paris', name: 'Paris', group: 'ecommerce', description: 'Marketplace de Paris (Cencosud).', logo: Logos.paris, defaultStatus: 'AVAILABLE' },
  { key: 'ripley', name: 'Ripley', group: 'ecommerce', description: 'Marketplace de Ripley (Mirakl).', logo: Logos.ripley, defaultStatus: 'AVAILABLE' },
  { key: 'hites', name: 'Hites', group: 'ecommerce', description: 'Marketplace de Hites.', logo: Logos.hites, defaultStatus: 'AVAILABLE' },
  { key: 'walmart', name: 'Walmart', group: 'ecommerce', description: 'Marketplace de Walmart Chile (Líder).', logo: Logos.walmart, defaultStatus: 'AVAILABLE' },
  { key: 'shopify', name: 'Shopify', group: 'ecommerce', description: 'Tienda online en Shopify.', logo: Logos.shopify, defaultStatus: 'AVAILABLE' },
  { key: 'woocommerce', name: 'WooCommerce', group: 'ecommerce', description: 'Tienda online en WordPress.', logo: Logos.woocommerce, defaultStatus: 'AVAILABLE' },
  { key: 'jumpseller', name: 'JumpSeller', group: 'ecommerce', description: 'Tienda online en JumpSeller.', logo: Logos.jumpseller, defaultStatus: 'AVAILABLE' },
  { key: 'openfactura', name: 'OpenFactura', group: 'billing', description: 'Boletas y facturas electrónicas.', logo: BillingLogos.openfactura, defaultStatus: 'AVAILABLE' },
  { key: 'facto', name: 'Facto', group: 'billing', description: 'Boletas y facturas electrónicas.', logo: BillingLogos.facto, defaultStatus: 'AVAILABLE' },
  { key: 'bsale', name: 'Bsale', group: 'billing', description: 'Ventas y facturación electrónica.', logo: BillingLogos.bsale, defaultStatus: 'AVAILABLE' },
  { key: 'defontana', name: 'Defontana', group: 'billing', description: 'ERP con facturación electrónica.', logo: BillingLogos.defontana, defaultStatus: 'AVAILABLE' },
  { key: 'nubox', name: 'Nubox', group: 'billing', description: 'Contabilidad y facturación.', logo: BillingLogos.nubox, defaultStatus: 'AVAILABLE' },
  { key: 'siigo', name: 'Siigo', group: 'billing', description: 'Contabilidad en la nube.', logo: BillingLogos.siigo, defaultStatus: 'AVAILABLE' },
  { key: 'chilexpress', name: 'Chilexpress', group: 'couriers', description: 'Cotiza, emite y sigue envíos.', logo: CourierLogos.chilexpress, defaultStatus: 'DISABLED' },
  { key: 'starken', name: 'Starken', group: 'couriers', description: 'Órdenes de flete y seguimiento.', logo: CourierLogos.starken, defaultStatus: 'DISABLED' },
  { key: 'bluexpress', name: 'Blue Express', group: 'couriers', description: 'Órdenes de servicio y seguimiento.', logo: CourierLogos.bluexpress, defaultStatus: 'DISABLED' },
  { key: 'dropship-noriega_api', name: 'API Noriega', group: 'dropshipping', description: 'Catálogo del proveedor por API.', logo: DropLogo, defaultStatus: 'AVAILABLE' },
];

export const CONNECTOR_BY_KEY: Record<string, Connector> = Object.fromEntries(CONNECTORS.map((c) => [c.key, c]));

// Estado efectivo: el guardado por el Super Admin o el valor por defecto del sincronizador.
export function connectorStatus(map: Record<string, { status?: string | null } | undefined>, key: string): ConnectorStatus {
  const saved = map[key]?.status as ConnectorStatus | undefined;
  return saved || CONNECTOR_BY_KEY[key]?.defaultStatus || 'AVAILABLE';
}
