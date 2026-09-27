import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./mobile.css";
import { MobileToolsMenu } from "@/components/mobile-tools-menu";

export const metadata: Metadata = { title: "Smart Assistent", description: "Din privata AI-assistent för kommunikation, planering och beslut." };
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#0a0b0d", viewportFit: "cover" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}<MobileToolsMenu /></body></html>;
}
