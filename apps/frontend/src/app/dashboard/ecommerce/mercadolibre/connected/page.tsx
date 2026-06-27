'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function ConnectedPage() {
  const router = useRouter();

  useEffect(() => {
    const t = setTimeout(() => router.push('/dashboard/ecommerce/mercadolibre'), 3000);
    return () => clearTimeout(t);
  }, [router]);

  return (
    <div className="flex flex-col items-center justify-center py-20">
      <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mb-4 text-3xl">
        ✓
      </div>
      <h2 className="text-xl font-bold text-gray-900 mb-2">¡Cuenta conectada!</h2>
      <p className="text-gray-500 text-sm">Redirigiendo al panel de Mercado Libre...</p>
    </div>
  );
}
