import { useEffect, useMemo } from "react";
import { divIcon } from "leaflet";
import { MapContainer, TileLayer, Marker, Polyline, Tooltip, useMap } from "react-leaflet";

const HARA_MARINA = [59.5881254, 25.6124356];

function makeBoatIcon({ name, color = "#2a9a4a", headingDeg }) {
  const rot = Number.isFinite(headingDeg) ? headingDeg : 0;
  // Simple boat-shape SVG, rotated to COG when available.
  return divIcon({
    className: "",
    iconSize: [32, 32],
    iconAnchor: [16, 16],
    html: `
      <div style="position:relative;width:32px;height:32px;">
        <svg width="32" height="32" viewBox="0 0 32 32"
             style="transform:rotate(${rot}deg);transform-origin:50% 50%;filter:drop-shadow(0 1px 2px rgba(0,0,0,0.5));">
          <path d="M16 3 L24 22 L16 28 L8 22 Z"
                fill="${color}" stroke="#fff" stroke-width="1.5"/>
        </svg>
        <div style="position:absolute;top:32px;left:50%;transform:translateX(-50%);
                    background:rgba(9,28,44,0.85);color:#e8f4f8;padding:1px 6px;border-radius:3px;
                    font-size:10px;font-family:Georgia,serif;letter-spacing:1px;white-space:nowrap;">
          ${String(name || "").toUpperCase()}
        </div>
      </div>`,
  });
}

function makeMarinaIcon() {
  return divIcon({
    className: "",
    iconSize: [16, 16],
    iconAnchor: [8, 8],
    html: `
      <div style="width:16px;height:16px;border-radius:50%;
                  background:rgba(240,192,64,0.25);border:2px solid #f0c040;
                  box-shadow:0 0 8px rgba(240,192,64,0.4);"></div>`,
  });
}

// Recenters / refits the map when the boat position changes meaningfully.
function FitBounds({ boatPos, marinaPos }) {
  const map = useMap();
  useEffect(() => {
    if (!boatPos) return;
    const dLat = Math.abs(boatPos[0] - marinaPos[0]);
    const dLon = Math.abs(boatPos[1] - marinaPos[1]);
    // If boat is close (<5 km-ish), fit both points; otherwise center on boat.
    if (dLat < 0.05 && dLon < 0.1) {
      map.fitBounds([boatPos, marinaPos], { padding: [40, 40], maxZoom: 15 });
    } else {
      map.setView(boatPos, 10);
    }
  }, [boatPos?.[0], boatPos?.[1], marinaPos[0], marinaPos[1], map]);
  return null;
}

/**
 * BoatPositionMap — Leaflet map showing the boat's current position and the
 * Hara Marina reference point. Used in the VesselSafetyHero card.
 *
 * Props:
 *   lat, lon       - boat position (numbers; component returns null if missing)
 *   name           - boat name shown under the marker
 *   color          - hull color (defaults to green)
 *   headingDeg     - optional heading or COG for marker rotation
 *   sogKn          - optional speed-over-ground for tooltip
 *   height         - map height in px (default 220)
 *   marina         - [lat, lon] reference marker (default Hara)
 */
export default function BoatPositionMap({
  lat,
  lon,
  name,
  color = "#2a9a4a",
  headingDeg,
  sogKn,
  height = 220,
  marina = HARA_MARINA,
}) {
  const boatPos = useMemo(() => {
    const a = Number(lat);
    const b = Number(lon);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
    return [a, b];
  }, [lat, lon]);

  const boatIcon = useMemo(
    () => makeBoatIcon({ name, color, headingDeg }),
    [name, color, headingDeg]
  );
  const marinaIcon = useMemo(() => makeMarinaIcon(), []);

  if (!boatPos) return null;

  // Initial center is irrelevant; FitBounds sets the right view immediately.
  return (
    <div style={{
      height,
      borderRadius: 7,
      overflow: "hidden",
      border: "1px solid rgba(126,171,200,0.16)",
    }}>
      <MapContainer
        center={boatPos}
        zoom={13}
        style={{ height: "100%", width: "100%", background: "#0a1a26" }}
        scrollWheelZoom={false}
        attributionControl={false}
      >
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          maxZoom={19}
        />
        <FitBounds boatPos={boatPos} marinaPos={marina} />
        <Marker position={marina} icon={marinaIcon}>
          <Tooltip direction="top" offset={[0, -8]} opacity={0.9}>Hara Sadam</Tooltip>
        </Marker>
        <Polyline
          positions={[marina, boatPos]}
          pathOptions={{ color: "#7eabc8", weight: 1.5, opacity: 0.5, dashArray: "4 6" }}
        />
        <Marker position={boatPos} icon={boatIcon}>
          <Tooltip direction="bottom" offset={[0, 28]} opacity={0.9}>
            {name || "boat"}
            {Number.isFinite(Number(sogKn)) && ` · ${Number(sogKn).toFixed(1)} kn`}
          </Tooltip>
        </Marker>
      </MapContainer>
    </div>
  );
}
