import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "mapbox-gl/dist/mapbox-gl.css";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://clearlane.vercel.app";

export const metadata: Metadata = {
  title: {
    default: "ClearLane AI — Predictive Parking Intelligence for Bengaluru",
    template: "%s | ClearLane AI",
  },
  description:
    "AI-powered platform that detects illegal parking hotspots and forecasts congestion 60 minutes ahead. Built for Bengaluru Traffic Police on 298,000+ real violation records.",
  manifest: "/manifest.json",
  icons: {
    icon: [{ url: "/favicon.ico", sizes: "32x32", type: "image/x-icon" }],
    apple: "/apple-touch-icon.png",
  },
  openGraph: {
    title: "ClearLane AI — Predictive Parking Intelligence for Bengaluru",
    description:
      "AI-powered parking intelligence platform. Detects illegal parking hotspots, forecasts congestion 60 minutes ahead, and generates optimized patrol routes.",
    url: baseUrl,
    siteName: "ClearLane AI",
    locale: "en_IN",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "ClearLane AI — Predictive Parking Intelligence",
    description:
      "AI-powered platform that detects illegal parking hotspots and forecasts congestion 60 minutes ahead for Bengaluru Traffic Police.",
  },
  robots: { index: true, follow: true },
  metadataBase: new URL(baseUrl),
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${inter.variable} h-full antialiased`}>
      <body className="min-h-full bg-zinc-950 text-zinc-100">{children}</body>
    </html>
  );
}
