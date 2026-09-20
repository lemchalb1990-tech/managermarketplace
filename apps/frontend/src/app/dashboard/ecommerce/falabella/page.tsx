'use client';
import PlatformPage from '../components/PlatformPage';
import { Logos } from '../components/logos';

export default function FalabellaPage() {
  return (
    <PlatformPage config={{
      marketplace: 'FALABELLA',
      name: 'Falabella',
      description: 'Conecta tu cuenta de Falabella Seller para sincronizar tu inventario.',
      moduleKey: 'ecommerce_falabella',
      color: '#9AC03C',
      logo: Logos.falabella,
      supportsPublish: true,
      supportsImport: true,
      supportsSalesImport: true,
      supportsInvoicePush: true,
      helpText: 'Ingresa el UserID (tu email del Seller Center) y la API Key de Falabella Seller Center. BusinessUnit/OperatorCode los asigna Falabella según el país/tienda de tu cuenta (ej. "Falabella"/"facl" para Falabella Chile) — pídeselos a tu ejecutivo si no los tienes.',
      fields: [
        { key: 'userId', label: 'UserID', placeholder: 'tu-email@dominio.com', hint: 'El mismo con el que entras al Seller Center' },
        { key: 'apiKey', label: 'API Key', type: 'password', placeholder: 'Tu clave de API' },
        { key: 'businessUnit', label: 'Business Unit', placeholder: 'Falabella', required: false },
        { key: 'operatorCode', label: 'Operator Code', placeholder: 'facl', required: false, hint: 'Ej: "facl" para Falabella Chile.' },
      ],
    }} />
  );
}
