import type { Metadata, Viewport } from "next";
import { Jost, Lato } from "next/font/google";
import "./globals.css";
import SiteHeader from "@/components/SiteHeader";
import PresenceBeacon from "@/components/PresenceBeacon";
import ChatDock from "@/components/ChatDock";
import InvitesCenter from "@/components/InvitesCenter";

const display = Jost({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["300", "400", "500"],
});

const lato = Lato({
  variable: "--font-lato",
  subsets: ["latin"],
  weight: ["400", "700"],
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
