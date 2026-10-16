import React from 'react';

// Logos por defecto de las pasarelas de pago (se reemplazan por el logo registrado en el lápiz de cada tarjeta).
export const PaymentLogos: Record<string, React.ReactNode> = {
  flow: (
    <svg viewBox="0 0 64 40" className="w-full h-full" xmlns="http://www.w3.org/2000/svg">
      <rect width="64" height="40" rx="8" fill="#1F1F7A" />
      <path d="M12 26c4-8 8-8 12 0s8 8 12 0" stroke="#7CC4FF" strokeWidth="2.6" strokeLinecap="round" fill="none" />
      <text x="40" y="25" fontSize="10" fontWeight="900" fill="white" fontFamily="Arial,sans-serif">flow</text>
    </svg>
  ),
  mercadopago: (
    <svg viewBox="0 0 64 40" className="w-full h-full" xmlns="http://www.w3.org/2000/svg">
      <rect width="64" height="40" rx="8" fill="#009EE3" />
      <ellipse cx="17" cy="20" rx="9" ry="6.5" fill="white" />
      <path d="M11.5 20.5l3-2.5 2.5 2 2.5-2 3 2.5" stroke="#009EE3" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <text x="30" y="19" fontSize="7.5" fontWeight="900" fill="white" fontFamily="Arial,sans-serif">mercado</text>
      <text x="30" y="27" fontSize="7.5" fontWeight="900" fill="white" fontFamily="Arial,sans-serif">pago</text>
    </svg>
  ),
};
