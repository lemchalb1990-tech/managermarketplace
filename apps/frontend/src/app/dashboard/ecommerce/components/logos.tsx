import React from 'react';

export const Logos: Record<string, React.ReactNode> = {
  mercadolibre: (
    <svg viewBox="0 0 64 40" className="w-full h-full" xmlns="http://www.w3.org/2000/svg">
      <rect width="64" height="40" rx="8" fill="#FFE600" />
      <circle cx="22" cy="29" r="2.2" fill="#333" />
      <circle cx="34" cy="29" r="2.2" fill="#333" />
      <path d="M12 12h4l3 10h13l3-10h2" stroke="#333" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <path d="M20 18 Q28 23 36 18" stroke="#333" strokeWidth="2" strokeLinecap="round" fill="none" />
      <text x="41" y="27" fontSize="12" fontWeight="900" fill="#333" fontFamily="Arial,sans-serif">ML</text>
    </svg>
  ),

  shopify: (
    <svg viewBox="0 0 64 40" className="w-full h-full" xmlns="http://www.w3.org/2000/svg">
      <rect width="64" height="40" rx="8" fill="#96BF48" />
      <path d="M22 17 C22 13 26 11 32 11 C38 11 42 13 42 17 L44 31 H20 Z" fill="white" opacity="0.9" />
      <path d="M28 17 C28 14.2 29.8 12 32 12 C34.2 12 36 14.2 36 17" stroke="white" strokeWidth="2.2" fill="none" strokeLinecap="round" />
      <text x="28.5" y="27" fontSize="13" fontWeight="900" fill="#96BF48" fontFamily="Arial,sans-serif">S</text>
    </svg>
  ),

  woocommerce: (
    <svg viewBox="0 0 64 40" className="w-full h-full" xmlns="http://www.w3.org/2000/svg">
      <rect width="64" height="40" rx="8" fill="#7F54B3" />
      <rect x="7" y="8" width="50" height="19" rx="4" fill="white" opacity="0.9" />
      <path d="M19 27 L15 34 L25 27 Z" fill="white" opacity="0.9" />
      <text x="10" y="23" fontSize="10.5" fontWeight="900" fill="#7F54B3" fontFamily="Arial,sans-serif">WOO</text>
    </svg>
  ),

  jumpseller: (
    <svg viewBox="0 0 64 40" className="w-full h-full" xmlns="http://www.w3.org/2000/svg">
      <rect width="64" height="40" rx="8" fill="#FF6B35" />
      <path d="M32 7 C32 7 26 15 26 23 C26 26.5 28.7 29 32 29 C35.3 29 38 26.5 38 23 C38 15 32 7 32 7Z" fill="white" opacity="0.9" />
      <circle cx="32" cy="20" r="3" fill="#FF6B35" />
      <path d="M26 23 L22 30 L28 27 Z" fill="white" opacity="0.75" />
      <path d="M38 23 L42 30 L36 27 Z" fill="white" opacity="0.75" />
      <rect x="29" y="29" width="6" height="4" rx="3" fill="#E85520" />
    </svg>
  ),

  falabella: (
    <svg viewBox="0 0 64 40" className="w-full h-full" xmlns="http://www.w3.org/2000/svg">
      <rect width="64" height="40" rx="8" fill="#009A44" />
      <text x="8" y="28" fontSize="12.5" fontWeight="900" fill="white" fontFamily="Arial,sans-serif" letterSpacing="-0.3">Falabella</text>
    </svg>
  ),

  paris: (
    <svg viewBox="0 0 64 40" className="w-full h-full" xmlns="http://www.w3.org/2000/svg">
      <rect width="64" height="40" rx="8" fill="#003087" />
      <path d="M32 6 L30 17 M32 6 L34 17 M29 17 L35 17 M27 24 L37 24" stroke="white" strokeWidth="2" strokeLinecap="round" />
      <path d="M27 24 L24 31" stroke="white" strokeWidth="2" strokeLinecap="round" />
      <path d="M37 24 L40 31" stroke="white" strokeWidth="2" strokeLinecap="round" />
      <text x="13" y="38" fontSize="10" fontWeight="900" fill="white" fontFamily="Arial,sans-serif" letterSpacing="2">PARIS</text>
    </svg>
  ),

  hites: (
    <svg viewBox="0 0 64 40" className="w-full h-full" xmlns="http://www.w3.org/2000/svg">
      <rect width="64" height="40" rx="8" fill="#E30613" />
      <text x="8" y="28" fontSize="16" fontWeight="900" fill="white" fontFamily="Arial,sans-serif" letterSpacing="1">HITES</text>
    </svg>
  ),

  ripley: (
    <svg viewBox="0 0 64 40" className="w-full h-full" xmlns="http://www.w3.org/2000/svg">
      <rect width="64" height="40" rx="8" fill="#5B2D8E" />
      <text x="7" y="28" fontSize="14" fontWeight="900" fill="white" fontFamily="Arial,sans-serif" letterSpacing="0.5">RIPLEY</text>
    </svg>
  ),

  walmart: (
    <svg viewBox="0 0 64 40" className="w-full h-full" xmlns="http://www.w3.org/2000/svg">
      <rect width="64" height="40" rx="8" fill="#0071CE" />
      <g>
        {/* spark: 6 rays at 60° */}
        <line x1="20" y1="9" x2="20" y2="15" stroke="#FFC220" strokeWidth="3.5" strokeLinecap="round" />
        <line x1="20" y1="25" x2="20" y2="31" stroke="#FFC220" strokeWidth="3.5" strokeLinecap="round" />
        <line x1="10.8" y1="14.5" x2="15.8" y2="17.2" stroke="#FFC220" strokeWidth="3.5" strokeLinecap="round" />
        <line x1="24.2" y1="22.8" x2="29.2" y2="25.5" stroke="#FFC220" strokeWidth="3.5" strokeLinecap="round" />
        <line x1="10.8" y1="25.5" x2="15.8" y2="22.8" stroke="#FFC220" strokeWidth="3.5" strokeLinecap="round" />
        <line x1="24.2" y1="17.2" x2="29.2" y2="14.5" stroke="#FFC220" strokeWidth="3.5" strokeLinecap="round" />
        <circle cx="20" cy="20" r="4" fill="#FFC220" />
      </g>
      <text x="34" y="24" fontSize="11" fontWeight="900" fill="white" fontFamily="Arial,sans-serif">Walmart</text>
    </svg>
  ),
};
