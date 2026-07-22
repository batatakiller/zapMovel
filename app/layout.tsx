import type { Metadata, Viewport } from "next";
import ResponsiveShell from "@/components/ResponsiveShell";
import "./globals.css";

export const metadata: Metadata = {
  title: "ZapMóvel",
  description: "WhatsApp via Evolution API",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "ZapMóvel" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
  themeColor: "#008069",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body className="antialiased">
        <ResponsiveShell>{children}</ResponsiveShell>
      </body>
    </html>
  );
}
