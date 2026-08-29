import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = { title: "Communication Intelligence", description: "Your private communication command center." };
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#0a0b0d" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
