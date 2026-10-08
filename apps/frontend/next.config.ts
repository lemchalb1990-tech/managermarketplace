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
  // Rutas antiguas: el perfil de facturación y la configuración de ticket pasaron a
  // Administración (Datos de la empresa).
  async redirects() {
    return [
      { source: "/dashboard/billing/perfil", destination: "/dashboard/empresa", permanent: false },
      { source: "/dashboard/pos/ticket", destination: "/dashboard/empresa/ticket", permanent: false },
    ];
  },
};

export default nextConfig;
