import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "VyaporaFlow: wholesale orders, stock and payments", template: "%s · VyaporaFlow" },
  description:
    "Manage products, retailer orders, deliveries, and outstanding payments from one simple workspace. Give your retailers an easier way to order the products they need.",
  applicationName: "VyaporaFlow",
};

export const viewport: Viewport = { themeColor: "#faf7f2", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en-IN">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
