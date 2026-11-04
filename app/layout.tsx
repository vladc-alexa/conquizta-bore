import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";
import SiteHeader from "@/components/SiteHeader";
import PresenceBeacon from "@/components/PresenceBeacon";
import ChatDock from "@/components/ChatDock";
import InvitesCenter from "@/components/InvitesCenter";

// Self-hosted (was next/font/google): the Coolify/nixpacks image has no
// reliable path to fonts.googleapis.com at build time, and Turbopack then
// failed the whole build on "next/font/google queries have exactly one entry".
// Files are the latin-subset woff2 taken verbatim from Google Fonts.
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
  title: "ST0NE QUIZ",
  description: "Cultură generală. Antrenament, dueluri 1v1 și lideri.",
  applicationName: "ST0NE QUIZ",
  openGraph: {
    title: "ST0NE QUIZ",
    description: "Cultură generală. Antrenament, dueluri 1v1 și lideri.",
    siteName: "ST0NE QUIZ",
    type: "website",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // cover: lets env(safe-area-inset-*) report the notch/home-bar insets
  viewportFit: "cover",
  themeColor: "#040a08",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ro">
      <body className={`${display.variable} ${lato.variable} antialiased`}>
        <SiteHeader />
        <PresenceBeacon />
        {children}
        {/* general chat as a floating dock on the game screens */}
        <ChatDock />
        {/* invitations to a tower or a carciuma table, wherever you are */}
        <InvitesCenter />
      </body>
    </html>
  );
}
