import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CloseCheck",
  description: "Tech due-diligence audit software for M&A/QoE consultants.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col bg-slate-50 text-slate-900 font-sans">
        {children}
      </body>
    </html>
  );
}
