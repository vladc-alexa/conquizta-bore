import type { Metadata } from "next";
import { Jost, Lato } from "next/font/google";
import "./globals.css";
import SiteHeader from "@/components/SiteHeader";
import PresenceBeacon from "@/components/PresenceBeacon";

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
      </body>
    </html>
  );
}
