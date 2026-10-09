import type { ReactNode } from "react";
import { Inter, Source_Serif_4 } from "next/font/google";

// Mismas tipografías y paleta de la landing (clase .lp en globals.css).
const sans = Inter({ variable: "--font-lp-sans", subsets: ["latin"], display: "swap" });
const serif = Source_Serif_4({ variable: "--font-lp-serif", subsets: ["latin"], weight: "400", display: "swap" });

export default function LoginLayout({ children }: { children: ReactNode }) {
  return <div className={`lp ${sans.variable} ${serif.variable} min-h-[100dvh] w-full`}>{children}</div>;
}
