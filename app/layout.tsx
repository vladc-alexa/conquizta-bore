import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { I18nProvider } from "@/lib/i18n";
import SiteHeader from "@/components/SiteHeader";
import PresenceBeacon from "@/components/PresenceBeacon";
import ChatDock from "@/components/ChatDock";
import InvitesCenter from "@/components/InvitesCenter";

// Self-hosted fonts (works reliably offline and on Coolify/nixpacks builds)
const display = localFont({
  src: [{ path: "./fonts/jost-latin.woff2", weight: "300 500", style: "normal" }],
  variable: "--font-display",
  display: "swap",
});

const lato = localFont({
  src: [
    { path: "./fonts/lato-400-latin.woff2", weight: "400", style: "normal" },
    { path: "./fonts/lato-700-latin.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-lato",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Stone Quiz",
  description: "Stone Quiz — Cultură generală, Quiz Fighter, Asediul Castelului, Turnul și clasament.",
  applicationName: "Stone Quiz",
  openGraph: {
    title: "Stone Quiz",
    description: "Stone Quiz — Cultură generală, Quiz Fighter, Asediul Castelului, Turnul și clasament.",
    siteName: "Stone Quiz",
    type: "website",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0b090e",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ro">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Cinzel:wght@400;600;700;800&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className={`${display.variable} ${lato.variable} antialiased`}>
        <I18nProvider>
          <SiteHeader />
          <PresenceBeacon />
          {children}
          <ChatDock />
          <InvitesCenter />
        </I18nProvider>
      </body>
    </html>
  );
}
