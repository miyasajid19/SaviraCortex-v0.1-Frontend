import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import BatchIngestionWidget from "./BatchIngestionWidget";
import CookieConsent from "@/components/legal/CookieConsent";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "SaviraCortex â€” Intelligence Workspace",
  description: "Connect your organization's knowledge and AI workflows with SaviraCortex.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={geistSans.variable + " " + geistMono.variable + " h-full antialiased"}>
      <body className="min-h-full flex flex-col">
        {children}
        <BatchIngestionWidget />
        <CookieConsent />
      </body>
    </html>
  );
}