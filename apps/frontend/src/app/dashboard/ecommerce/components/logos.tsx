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
      <rect width="64" height="40" rx="8" fill="#95BF47" />
      <path d="M23 16 C23 12.5 26 10 32 10 C38 10 41 12.5 41 16 L43.5 30 H20.5 Z" fill="white" />
      <path d="M27.5 16 C27.5 13.2 29.2 11 32 11 C34.8 11 36.5 13.2 36.5 16" stroke="#95BF47" strokeWidth="2" fill="none" strokeLinecap="round" />
      <path d="M29 20 l1 6 M35 20 l-1 6" stroke="#95BF47" strokeWidth="1.4" strokeLinecap="round" opacity="0.55" />
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
      <rect width="64" height="40" rx="8" fill="#9AC03C" />
      <text x="21" y="28" fontSize="20" fontWeight="700" fontStyle="italic" fill="white" fontFamily="Georgia,serif">f.</text>
    </svg>
  ),

  paris: (
    <svg viewBox="0 0 64 40" className="w-full h-full" xmlns="http://www.w3.org/2000/svg">
      <rect width="64" height="40" rx="8" fill="#1571F2" />
      <circle cx="32" cy="20" r="11" fill="none" stroke="white" strokeWidth="1.6" />
      <text x="32" y="26" fontSize="16" fontWeight="700" fontStyle="italic" fill="white" fontFamily="Georgia,serif" textAnchor="middle">p</text>
    </svg>
  ),

  hites: (
    <svg viewBox="0 0 64 40" className="w-full h-full" xmlns="http://www.w3.org/2000/svg">
      <rect width="64" height="40" rx="8" fill="#E4232D" />
      <text x="32" y="27" fontSize="18" fontWeight="900" fill="white" fontFamily="Arial,sans-serif" textAnchor="middle">H</text>
    </svg>
  ),

  ripley: (
    <svg viewBox="0 0 64 40" className="w-full h-full" xmlns="http://www.w3.org/2000/svg">
      <rect width="64" height="40" rx="8" fill="#EC008C" />
      <text x="32" y="24" fontSize="17" fontWeight="700" fontStyle="italic" fill="white" fontFamily="Georgia,serif" textAnchor="middle">R</text>
      <text x="32" y="32" fontSize="6" fill="white" fontFamily="Arial,sans-serif" textAnchor="middle" opacity="0.85">.com</text>
    </svg>
  ),

  walmart: (
    <svg viewBox="0 0 64 40" className="w-full h-full" xmlns="http://www.w3.org/2000/svg">
      <rect width="64" height="40" rx="8" fill="#0071CE" />
      <g>
        {/* spark: 6 rays at 60° */}
        <line x1="32" y1="8" x2="32" y2="15" stroke="#FFC220" strokeWidth="3.6" strokeLinecap="round" />
        <line x1="32" y1="25" x2="32" y2="32" stroke="#FFC220" strokeWidth="3.6" strokeLinecap="round" />
        <line x1="21.9" y1="13.5" x2="27.9" y2="16.8" stroke="#FFC220" strokeWidth="3.6" strokeLinecap="round" />
        <line x1="36.1" y1="23.2" x2="42.1" y2="26.5" stroke="#FFC220" strokeWidth="3.6" strokeLinecap="round" />
        <line x1="21.9" y1="26.5" x2="27.9" y2="23.2" stroke="#FFC220" strokeWidth="3.6" strokeLinecap="round" />
        <line x1="36.1" y1="16.8" x2="42.1" y2="13.5" stroke="#FFC220" strokeWidth="3.6" strokeLinecap="round" />
        <circle cx="32" cy="20" r="4.2" fill="#FFC220" />
      </g>
    </svg>
  ),
};
