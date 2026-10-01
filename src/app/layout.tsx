import type { Metadata, Viewport } from "next";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import "./globals.css";
import "./mobile.css";
import { MobileToolsMenu } from "@/components/mobile-tools-menu";

export const metadata: Metadata = { title: "Solvani", description: "Your private AI assistant for communication, planning and decisions." };
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#0a0b0d", viewportFit: "cover" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}<MobileToolsMenu /><Analytics /><SpeedInsights /></body></html>;
}
