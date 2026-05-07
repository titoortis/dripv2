import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { TelegramBoot } from "@/components/TelegramBoot";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-sans",
});

const interDisplay = Inter({
  subsets: ["latin"],
  display: "swap",
  weight: ["600", "700", "800"],
  variable: "--font-display",
});

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
    <html lang="en" className={`dark ${inter.variable} ${interDisplay.variable}`}>
      <body className="min-h-screen bg-ink-950 text-ink-100 antialiased">
        <TelegramBoot />
        {children}
      </body>
    </html>
  );
}
