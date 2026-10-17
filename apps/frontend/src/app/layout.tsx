import type { Metadata, Viewport } from "next";
import { Inter, Geist_Mono } from "next/font/google";
import "./globals.css";
import { LoginSplashHost } from "@/components/LoginSplash";
import { InstallAppHost } from "@/components/InstallApp";

// Una sola familia para toda la app (landing, login y panel): Inter, muy legible en
// tablas y números. La variable conserva su nombre histórico (--font-hanken).
const hanken = Inter({
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
  title: "Domium",
  description: "Tu negocio, bajo control: ventas, stock y boletas de todos tus canales en un solo panel.",
  // Instalada en iPhone: nombre bajo el ícono y barra de estado oscura sobre la barra azul marino.
  appleWebApp: { capable: true, title: "Domium", statusBarStyle: "black" },
};

export const viewport: Viewport = {
  themeColor: "#011f3d",
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
      <body className="min-h-full flex flex-col">
        {children}
        <LoginSplashHost />
        <InstallAppHost />
      </body>
    </html>
  );
}
