import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  images: {
    remotePatterns: [
      {
        protocol: "http",
        hostname: "localhost",
      },
      {
        protocol: "https",
        hostname: "**.easypanel.host",
      },
    ],
  },
  // Rutas antiguas: los datos de la empresa y la configuración de ticket ahora son modales
  // dentro de Configuración.
  async redirects() {
    return [
      { source: "/dashboard/billing/perfil", destination: "/dashboard/settings?abrir=empresa", permanent: false },
      { source: "/dashboard/empresa", destination: "/dashboard/settings?abrir=empresa", permanent: false },
      { source: "/dashboard/pos/ticket", destination: "/dashboard/settings?abrir=ticket", permanent: false },
      { source: "/dashboard/empresa/ticket", destination: "/dashboard/settings?abrir=ticket", permanent: false },
    ];
  },
};

export default nextConfig;
