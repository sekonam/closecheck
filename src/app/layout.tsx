import type React from "react";
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CloseCheck",
  description: "Tech due-diligence audit software for M&A/QoE consultants.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full antialiased">
      {/* The column is load-bearing, not cosmetic: /login, /signup, the portal shell and the
          not-found boundary all size themselves with flex-1 against this body. */}
      <body className="flex min-h-full flex-col bg-ink-50 font-sans text-ink-900 selection:bg-accent-100 selection:text-accent-900">
        {children}
      </body>
    </html>
  );
}
