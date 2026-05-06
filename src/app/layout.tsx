import type { Metadata, Viewport } from "next";
import "./globals.css";
import { TelegramBoot } from "@/components/TelegramBoot";

export const metadata: Metadata = {
  title: "drip — Seedance 2.0 video presets",
  description: "Mobile-first AI video generator powered by Seedance 2.0.",
  applicationName: "drip",
  formatDetection: { telephone: false, email: false, address: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#0A0A0B",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-ink-950 text-ink-100 antialiased">
        <TelegramBoot />
        {children}
      </body>
    </html>
  );
}
