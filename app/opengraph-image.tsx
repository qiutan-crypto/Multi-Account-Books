import { ImageResponse } from "next/og";

// Static social-preview image (1200x630). Next.js wires this to both
// og:image and twitter:image automatically.
export const runtime = "edge";
export const alt = "FiveStar — plain-text general ledger accounting";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OgImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "80px",
          background: "#f7f7f4",
          fontFamily: "Arial, sans-serif",
        }}
      >
        {/* GL bracket mark */}
        <div style={{ display: "flex", alignItems: "center", marginBottom: 28 }}>
          <span style={{ fontSize: 96, color: "#2b303a", fontWeight: 800 }}>⌜</span>
          <span style={{ fontSize: 110, color: "#1f6bff", fontWeight: 800, letterSpacing: -4 }}>
            GL
          </span>
          <span style={{ fontSize: 96, color: "#2b303a", fontWeight: 800, alignSelf: "flex-end" }}>
            ⌟
          </span>
        </div>
        <div style={{ fontSize: 64, fontWeight: 800, color: "#171a14", letterSpacing: -1 }}>
          FiveStar
        </div>
        <div style={{ fontSize: 32, color: "#5c6656", marginTop: 18, maxWidth: 900 }}>
          Plain-text general ledger accounting — professional P&amp;L, P&amp;L Detail,
          and Balance Sheet you fully own.
        </div>
        <div style={{ fontSize: 24, color: "#276c57", marginTop: 36, fontWeight: 700 }}>
          Multi-account books
        </div>
      </div>
    ),
    { ...size }
  );
}
