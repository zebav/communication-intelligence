import type { Metadata, Viewport } from "next";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import "./globals.css";
import "./mobile.css";

export const metadata: Metadata = {
  title: "Solvani",
  description: "A private AI workspace for communication, relationships and everyday decisions.",
  icons: { icon: "/icon.svg", apple: "/apple-icon.svg" },
  manifest: "/manifest.webmanifest",
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#0F172A", viewportFit: "cover" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="sv"><body>{children}<Analytics /><SpeedInsights /></body></html>;
}
