import type { Metadata } from "next";
import "./app.css";

const SITE_URL = "https://plaingl.com";
const DESC =
  "Plain-text general ledger accounting — professional P&L, P&L Detail, and Balance Sheet you fully own.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: "PlainGL.com",
  description: DESC,
  openGraph: {
    title: "PlainGL.com",
    description: DESC,
    url: SITE_URL,
    siteName: "PlainGL.com",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "PlainGL.com",
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
