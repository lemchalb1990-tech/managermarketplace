'use client';
import PlatformPage from '../components/PlatformPage';
import { Logos } from '../components/logos';

export default function WalmartPage() {
  return (
    <PlatformPage config={{
      marketplace: 'WALMART',
      name: 'Walmart',
      description: 'Vende en Walmart Chile con sincronización automática de precios y stock.',
      moduleKey: 'ecommerce_walmart',
      color: '#0071CE',
      logo: Logos.walmart,
      supportsPublish: false,
      supportsImport: true,
      supportsSalesImport: true,
      helpText: 'Obtén tu Client ID y Client Secret desde el portal de vendedores de Walmart Chile (Client ID/Secret de la API de Marketplace, no de otros portales de Walmart como Ads o Retail Link). El sistema sincroniza stock y precio, e importa catálogo y ventas ya existentes en Walmart — publicar productos nuevos todavía no está soportado.',
      fields: [
        { key: 'clientId', label: 'Client ID', placeholder: 'Tu Client ID', hint: 'Pega aqui el Client ID de Walmart' },
        { key: 'clientSecret', label: 'Client Secret', type: 'password', placeholder: 'Tu Client Secret', hint: 'Pega aqui el Client Secret de Walmart' },
        { key: 'commissionRate', label: '% comisión', placeholder: 'Ej: 12', required: false, hint: 'La API de Walmart entrega la comisión en $0: indica tu % de comisión (sobre el precio con IVA) para calcular el neto y la ganancia reales de cada venta importada.' },
      ],
    }} />
  );
}
