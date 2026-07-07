import type { Metadata } from "next";
import "./app.css";

const SITE_URL = "https://qiutan-crypto.github.io/Multi-Account-Books";
const DESC =
  "Plain-text general ledger accounting — professional P&L, P&L Detail, and Balance Sheet you fully own.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: "FiveStar",
  description: DESC,
  openGraph: {
    title: "FiveStar",
    description: DESC,
    url: SITE_URL,
    siteName: "FiveStar",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "FiveStar",
    description: DESC,
  },
};

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
