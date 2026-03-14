import type { Metadata } from "next";
import { Dock } from "@/components/dock";
import { GhostBackground } from "@/components/ghost-bg";
import "./globals.css";

export const metadata: Metadata = {
  title: "Ghost Operator UI",
  description: "Premium dark ethereal operator surface for Ghost.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        {/* Global background — fixed, persists across all routes */}
        <GhostBackground />
        <div className="app-frame">
          <div className="app-grid" aria-hidden="true" />
          <div className="app-noise" aria-hidden="true" />
          <main className="app-main">{children}</main>
          <Dock />
        </div>
      </body>
    </html>
  );
}
