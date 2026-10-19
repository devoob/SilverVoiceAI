import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SilverVoice AI 銀齡語音 — Inclusive AI Voice Banking",
  description:
    "A trilingual Cantonese / Putonghua / English voice banking assistant for elderly Hong Kong residents. Built for the HKU x HSBC Bank on U Social Innovation Challenge.",
  applicationName: "SilverVoice AI",
  // English is the default until the user switches language.
  keywords: [
    "age-friendly banking",
    "Cantonese voice assistant",
    "financial inclusion",
    "accessibility",
    "WCAG 2.1 AA",
  ],
};

/**
 * Fixed-scale viewport. Allowing pinch-zoom is a WCAG 1.4.4 requirement, and
 * the in-app text-size control is an addition to it, not a replacement.
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
  themeColor: "#A50010",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // Default to English; the client updates this when the language changes.
    <html lang="en-HK" className="h-full">
      <body className="min-h-full">{children}</body>
    </html>
  );
}
