import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Wayhome · Every way to get there",
  description: "A private travel planner for trains, flights, buses and shared rides, with different-service connections and a transparent search audit.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
