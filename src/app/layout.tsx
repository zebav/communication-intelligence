import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./mobile.css";
import { MobileToolsMenu } from "@/components/mobile-tools-menu";
import { PersonNavigationBridge } from "@/components/person-navigation-bridge";

export const metadata: Metadata = { title: "Communication Intelligence", description: "Your private communication command center." };
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#0a0b0d", viewportFit: "cover" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}<PersonNavigationBridge /><MobileToolsMenu /></body></html>;
}
