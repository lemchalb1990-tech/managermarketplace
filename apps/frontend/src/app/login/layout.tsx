import type { ReactNode } from "react";
import { Nunito } from "next/font/google";
import "./login-domium.css";

// Marca Domium: Nunito para todo el login (la clase .lp trae la paleta de la landing).
const sans = Nunito({ variable: "--font-lp-sans", subsets: ["latin"], display: "swap", weight: ["400", "500", "600", "700", "800", "900"] });

export default function LoginLayout({ children }: { children: ReactNode }) {
  return <div className={`lp login-domium ${sans.variable} min-h-[100dvh] w-full`}>{children}</div>;
}
