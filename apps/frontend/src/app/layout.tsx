import type { Metadata } from "next";
import { Hanken_Grotesk, Geist_Mono } from "next/font/google";
import "./globals.css";

// Una sola familia para toda la app: landing, login y panel. Grotesca cálida,
// con carácter en los pesos altos (titulares) y muy legible en tablas densas.
const hanken = Hanken_Grotesk({
  variable: "--font-hanken",
  subsets: ["latin"],
  display: "swap",
  weight: ["400", "500", "600", "700", "800"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Admin Marketplace",
  description: "Gestión de inventario y marketplace",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="es"
      className={`${hanken.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
