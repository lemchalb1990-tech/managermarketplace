import Link from "next/link";

const features = [
  {
    title: "Catálogo y bodegas",
    description: "Administra tu inventario multi-bodega con stock sincronizado en tiempo real.",
  },
  {
    title: "Compras con costeo FIFO",
    description: "Registra compras por lotes y calcula el costo real de tus productos automáticamente.",
  },
  {
    title: "E-commerce multicanal",
    description: "Conecta Mercado Libre, Shopify, WooCommerce y más desde un solo panel.",
  },
  {
    title: "Punto de venta",
    description: "Vende en tienda física con el mismo stock que tus canales online.",
  },
  {
    title: "Despachos y rutas",
    description: "Organiza tus envíos y asigna rutas de despacho a tu equipo.",
  },
  {
    title: "Facturación",
    description: "Emite documentos tributarios integrados con tus proveedores de facturación.",
  },
];

export default function Home() {
  return (
    <div className="min-h-screen bg-white">
      <header className="border-b border-gray-100">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
          <div className="flex items-center gap-2 text-lg font-semibold text-gray-900">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-600 text-white">
              M
            </span>
            Admin Marketplace
          </div>
          <Link
            href="/login"
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
          >
            Iniciar sesión
          </Link>
        </div>
      </header>

      <section className="relative overflow-hidden bg-linear-to-br from-blue-700 via-blue-600 to-indigo-700 text-white">
        <div className="absolute -top-24 -left-24 h-96 w-96 rounded-full bg-white/10 blur-3xl" />
        <div className="absolute bottom-0 right-0 h-80 w-80 rounded-full bg-white/10 blur-3xl" />

        <div className="relative mx-auto max-w-6xl px-6 py-24 text-center">
          <h1 className="mx-auto max-w-3xl text-4xl font-bold leading-tight sm:text-5xl">
            Gestiona tu inventario y ventas en un solo lugar
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-lg text-blue-100">
            Catálogo, compras, órdenes y despachos conectados con tus canales de venta,
            todo desde un mismo panel.
          </p>
          <div className="mt-10">
            <Link
              href="/login"
              className="inline-flex items-center rounded-lg bg-white px-6 py-3 font-medium text-blue-700 transition-colors hover:bg-blue-50"
            >
              Comenzar
            </Link>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 py-20">
        <h2 className="text-center text-2xl font-bold text-gray-900 sm:text-3xl">
          Todo lo que necesitas para operar
        </h2>
        <div className="mt-12 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((feature) => (
            <div
              key={feature.title}
              className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm transition-shadow hover:shadow-md"
            >
              <h3 className="text-lg font-semibold text-gray-900">{feature.title}</h3>
              <p className="mt-2 text-gray-500">{feature.description}</p>
            </div>
          ))}
        </div>
      </section>

      <footer className="border-t border-gray-100 py-8">
        <p className="text-center text-sm text-gray-400">
          © {new Date().getFullYear()} Admin Marketplace
        </p>
      </footer>
    </div>
  );
}
