import React from 'react';

export const BillingLogos: Record<string, React.ReactNode> = {
  openfactura: (
    <svg viewBox="0 0 64 40" className="w-full h-full" xmlns="http://www.w3.org/2000/svg">
      <rect width="64" height="40" rx="8" fill="#1A3C8F" />
      {/* Documento con check */}
      <rect x="10" y="7" width="20" height="26" rx="2" fill="white" opacity="0.15" />
      <rect x="10" y="7" width="20" height="26" rx="2" fill="none" stroke="white" strokeWidth="1.5" />
      <line x1="14" y1="14" x2="26" y2="14" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="14" y1="18" x2="26" y2="18" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="14" y1="22" x2="22" y2="22" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="41" cy="22" r="9" fill="#E63B2E" />
      <path d="M36 22 L40 26 L47 18" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <text x="7" y="38" fontSize="7" fontWeight="700" fill="white" fontFamily="Arial,sans-serif" opacity="0.8">OpenFactura</text>
    </svg>
  ),

  facto: (
    <svg viewBox="0 0 64 40" className="w-full h-full" xmlns="http://www.w3.org/2000/svg">
      <rect width="64" height="40" rx="8" fill="#00B274" />
      {/* F estilizada */}
      <rect x="14" y="8" width="4" height="24" rx="2" fill="white" />
      <rect x="14" y="8" width="20" height="4" rx="2" fill="white" />
      <rect x="14" y="18" width="15" height="4" rx="2" fill="white" />
      <text x="38" y="27" fontSize="14" fontWeight="900" fill="white" fontFamily="Arial,sans-serif" opacity="0.9">acto</text>
    </svg>
  ),

  bsale: (
    <svg viewBox="0 0 64 40" className="w-full h-full" xmlns="http://www.w3.org/2000/svg">
      <rect width="64" height="40" rx="8" fill="#FF6B00" />
      {/* B con detalle */}
      <path d="M10 8 L10 32 L20 32 C25 32 28 29 28 25 C28 22 26 20 23 19.5 C26 19 27 17 27 14 C27 10.5 24 8 20 8 Z" fill="white" opacity="0.9" />
      <path d="M14 12 L19 12 C21 12 22.5 13 22.5 15 C22.5 17 21 18 19 18 L14 18 Z M14 21 L20 21 C22 21 24 22 24 24.5 C24 27 22 28 20 28 L14 28 Z" fill="#FF6B00" />
      <text x="33" y="27" fontSize="13" fontWeight="900" fill="white" fontFamily="Arial,sans-serif">sale</text>
    </svg>
  ),

  defontana: (
    <svg viewBox="0 0 64 40" className="w-full h-full" xmlns="http://www.w3.org/2000/svg">
      <rect width="64" height="40" rx="8" fill="#1B2A4A" />
      {/* Rombo / diamante */}
      <path d="M20 20 L28 10 L36 20 L28 30 Z" fill="#4A90D9" />
      <path d="M28 10 L36 20 L28 30 L36 20 Z" fill="#2566A8" />
      <text x="40" y="24" fontSize="9" fontWeight="700" fill="white" fontFamily="Arial,sans-serif">Defontana</text>
    </svg>
  ),

  nubox: (
    <svg viewBox="0 0 64 40" className="w-full h-full" xmlns="http://www.w3.org/2000/svg">
      <rect width="64" height="40" rx="8" fill="#0057B8" />
      {/* N + caja */}
      <path d="M8 28 L8 12 L14 12 L22 24 L22 12 L28 12 L28 28 L22 28 L14 16 L14 28 Z" fill="white" />
      <text x="32" y="27" fontSize="12" fontWeight="700" fill="white" fontFamily="Arial,sans-serif">ubox</text>
    </svg>
  ),

  siigo: (
    <svg viewBox="0 0 64 40" className="w-full h-full" xmlns="http://www.w3.org/2000/svg">
      <rect width="64" height="40" rx="8" fill="#6B21A8" />
      {/* S curva + punto */}
      <path d="M16 26 C16 28.5 18 30 21 30 C24 30 26 28.5 26 26 C26 22 16 22 16 18 C16 15.5 18 14 21 14 C24 14 26 15.5 26 18"
        stroke="white" strokeWidth="3" strokeLinecap="round" fill="none" />
      <circle cx="28" cy="12" r="2.5" fill="#C084FC" />
      <text x="33" y="27" fontSize="13" fontWeight="800" fill="white" fontFamily="Arial,sans-serif">iigo</text>
    </svg>
  ),
};
