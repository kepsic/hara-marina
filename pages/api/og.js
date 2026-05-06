import { ImageResponse } from "@vercel/og";

// Edge runtime is required by @vercel/og.
export const config = { runtime: "edge" };

// Renders a 1200×630 OG card used by every page that's shared via the
// ShareModal / WhatsApp / Telegram / Slack / iMessage etc.
//
// Query params (all optional):
//   title    – primary line, e.g. boat name
//   subtitle – secondary line, e.g. "on Hara Marina"
//   badge    – top-left tag, e.g. "BOAT", "MARINA", "MERVARE"
//   hero     – absolute https URL of a photo to use as the card background.
//              When set, the boat's hero image fills the canvas (object-fit
//              cover) and a dark gradient overlay keeps the title readable.
//
// We deliberately avoid hitting our DB / Redis: the endpoint runs on the
// edge and must stay fast & cheap. All real data is passed in the URL by
// the calling page.
export default function handler(req) {
  const { searchParams } = new URL(req.url);
  const title = (searchParams.get("title") || "Hara Marina").slice(0, 80);
  const subtitle = (searchParams.get("subtitle") || "").slice(0, 120);
  const badge = (searchParams.get("badge") || "MerVare").slice(0, 24);

  // Only honour http(s) URLs; anything else (data: URIs, javascript:, …)
  // would be a vector for rendering attacker content into our brand.
  const heroRaw = searchParams.get("hero") || "";
  const hero =
    /^https?:\/\//i.test(heroRaw) && heroRaw.length < 2048 ? heroRaw : "";

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "72px 80px",
          background:
            "radial-gradient(ellipse at 25% 18%, #0d3050 0%, #061320 70%)",
          color: "#e8f4f8",
          fontFamily: "Georgia, 'Times New Roman', serif",
          position: "relative",
        }}
      >
        {/* hero photo background (when provided) — full-bleed cover with a
            dark gradient overlay so white text stays readable on any image */}
        {hero ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={hero}
              alt=""
              width={1200}
              height={630}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                height: "100%",
                objectFit: "cover",
                objectPosition: "center",
              }}
            />
            <div
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                height: "100%",
                background:
                  "linear-gradient(180deg, rgba(6,19,32,0.55) 0%, rgba(6,19,32,0.25) 38%, rgba(6,19,32,0.85) 100%)",
              }}
            />
          </>
        ) : null}
        {/* top row: badge + brand */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            width: "100%",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              padding: "10px 18px",
              borderRadius: 999,
              border: "1px solid rgba(126,171,200,0.35)",
              color: "#9ec8e0",
              fontSize: 22,
              letterSpacing: 6,
              textTransform: "uppercase",
            }}
          >
            {badge}
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              color: "#7eabc8",
              fontSize: 22,
              letterSpacing: 6,
              textTransform: "uppercase",
            }}
          >
            ⚓ MerVare
          </div>
        </div>

        {/* middle: title + subtitle */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-start",
          }}
        >
          <div
            style={{
              fontSize: 96,
              fontWeight: 700,
              lineHeight: 1.05,
              letterSpacing: 2,
              color: "#f4faff",
              maxWidth: 1040,
            }}
          >
            {title}
          </div>
          {subtitle ? (
            <div
              style={{
                marginTop: 22,
                fontSize: 36,
                color: "#9ec8e0",
                letterSpacing: 1,
                maxWidth: 1040,
              }}
            >
              {subtitle}
            </div>
          ) : null}
        </div>

        {/* bottom rule */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            width: "100%",
            borderTop: "1px solid rgba(126,171,200,0.18)",
            paddingTop: 22,
            color: "#7eabc8",
            fontSize: 22,
            letterSpacing: 4,
            textTransform: "uppercase",
          }}
        >
          <div style={{ display: "flex" }}>Berth booking · Live telemetry</div>
          <div style={{ display: "flex", color: "#f0c040" }}>mervare.app</div>
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
      headers: {
        // Allow CDN/Vercel to cache the rendered image for an hour, with
        // longer stale-while-revalidate so social previews stay snappy.
        "cache-control":
          "public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400",
      },
    },
  );
}
