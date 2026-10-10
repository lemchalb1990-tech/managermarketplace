import React from 'react';

// Logos por defecto de los couriers (se reemplazan por el logo registrado en el lápiz de cada tarjeta).
export const CourierLogos: Record<string, React.ReactNode> = {
  chilexpress: (
    <svg viewBox="0 0 64 40" className="w-full h-full" xmlns="http://www.w3.org/2000/svg">
      <rect width="64" height="40" rx="8" fill="#FFCB05" />
      <path d="M10 26h10l4-12h10" stroke="#1F2937" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <circle cx="16" cy="29" r="2.2" fill="#1F2937" />
      <text x="30" y="27" fontSize="9" fontWeight="900" fill="#1F2937" fontFamily="Arial,sans-serif">CHX</text>
    </svg>
  ),
  starken: (
    <svg viewBox="0 0 64 40" className="w-full h-full" xmlns="http://www.w3.org/2000/svg">
      <rect width="64" height="40" rx="8" fill="#E30613" />
      <path d="M14 13l2.4 5 5.4.6-4 3.7 1.1 5.3-4.9-2.7-4.9 2.7 1.1-5.3-4-3.7 5.4-.6z" fill="white" />
      <text x="26" y="25" fontSize="9" fontWeight="900" fill="white" fontFamily="Arial,sans-serif">Starken</text>
    </svg>
  ),
  bluexpress: (
    <svg viewBox="0 0 64 40" className="w-full h-full" xmlns="http://www.w3.org/2000/svg">
      <rect width="64" height="40" rx="8" fill="#0033A0" />
      <rect x="9" y="13" width="14" height="12" rx="1.5" fill="none" stroke="white" strokeWidth="2" />
      <path d="M23 17h5l3 4v4h-8" stroke="white" strokeWidth="2" strokeLinejoin="round" fill="none" />
      <text x="34" y="25" fontSize="10" fontWeight="900" fill="white" fontFamily="Arial,sans-serif">blue</text>
    </svg>
  ),
};
