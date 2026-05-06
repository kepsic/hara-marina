import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { divIcon } from "leaflet";
import { MapContainer, TileLayer, Marker, Popup } from "react-leaflet";

function pinIcon(label) {
  return divIcon({
    className: "marina-pin",
    iconSize: [28, 36],
    iconAnchor: [14, 34],
    html: `<div style="
      width:28px;height:28px;border-radius:50% 50% 50% 0;
      transform:rotate(-45deg);
      background:#1e6fa8;
      border:2px solid #fff;
      box-shadow:0 4px 10px rgba(0,0,0,0.4);
      display:flex;align-items:center;justify-content:center;
      ">
      <span style="transform:rotate(45deg);color:#fff;font-size:14px;font-weight:700;">⚓</span>
    </div>`,
  });
}

export default function MarinaDiscoveryMap({ marinas = [] }) {
  const [host, setHost] = useState("mervare.app");
  useEffect(() => {
    if (typeof window !== "undefined") {
      const h = window.location.host;
      if (h.endsWith(".mervare.app") || h === "mervare.app") setHost("mervare.app");
      else setHost(h);
    }
  }, []);

  const validMarinas = marinas.filter(
    (m) => Number.isFinite(m.lat) && Number.isFinite(m.lon)
  );

  // Center on the centroid of all marinas, default to the Baltic.
  let center = [59.0, 25.0];
  let zoom = 6;
  if (validMarinas.length === 1) {
    center = [validMarinas[0].lat, validMarinas[0].lon];
    zoom = 11;
  } else if (validMarinas.length > 1) {
    const lat = validMarinas.reduce((a, m) => a + m.lat, 0) / validMarinas.length;
    const lon = validMarinas.reduce((a, m) => a + m.lon, 0) / validMarinas.length;
    center = [lat, lon];
  }

  return (
    <div style={{ height: "100%", width: "100%", position: "relative" }}>
      <MapContainer
        center={center}
        zoom={zoom}
        style={{ height: "100%", width: "100%", background: "#0d2438" }}
        scrollWheelZoom
      >
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution="&copy; OpenStreetMap contributors"
        />
        {validMarinas.map((m) => (
          <Marker key={m.slug} position={[m.lat, m.lon]} icon={pinIcon(m.name)}>
            <Popup>
              <div style={{ minWidth: 180 }}>
                <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>{m.name}</div>
                <div style={{ fontSize: 12, color: "#666", marginBottom: 8 }}>
                  {m.country || "—"}
                  {m.plan ? ` · ${m.plan}` : ""}
                </div>
                <a
                  href={`https://${m.slug}.${host.replace(/^www\./, "").split(":")[0] || "mervare.app"}`}
                  style={{
                    display: "inline-block",
                    background: "#1e6fa8",
                    color: "#fff",
                    padding: "6px 12px",
                    borderRadius: 4,
                    textDecoration: "none",
                    fontSize: 12,
                    fontWeight: 600,
                  }}
                >
                  View marina →
                </a>
              </div>
            </Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
}
