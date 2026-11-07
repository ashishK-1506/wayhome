import type { Metadata } from "next";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { publicHosting } from "@/lib/api-guard";
import "./globals.css";

export const metadata: Metadata = {
  title: "Wayhome · Every way to get there",
  description: "A travel planner for trains, flights, buses and shared rides, with different-service connections and a transparent search audit.",
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
      <body className="antialiased">
        {children}
        {/* Vercel Web Analytics and Speed Insights exist only on Vercel; Sites has no scripts for them. */}
        {publicHosting() && (
          <>
            <Analytics />
            <SpeedInsights />
          </>
        )}
      </body>
    </html>
  );
}
