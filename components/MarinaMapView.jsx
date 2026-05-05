import { MapContainer, TileLayer, Polygon, Polyline, CircleMarker, Tooltip } from "react-leaflet";

const HARA_CENTER = [59.5881254, 25.6124356];

// Approximate harbor basin outline, matched to the landing-page marina sketch.
const HARBOR_POLYGON = [
  [59.5896254, 25.6109356],
  [59.5897254, 25.6141356],
  [59.5892254, 25.6142356],
  [59.5889254, 25.6135356],
  [59.5879254, 25.6134356],
  [59.5877254, 25.6117356],
  [59.5885254, 25.6111356],
];

const PIER_LINES = [
  [
    [59.5892754, 25.6119856],
    [59.5878754, 25.6119856],
  ],
  [
    [59.5885054, 25.6116856],
    [59.5885054, 25.6129156],
  ],
  [
    [59.5878754, 25.6119856],
    [59.5886454, 25.6132856],
  ],
];

const BERTH_POSITIONS = {
  A: [
    [59.5882254, 25.6123156],
    [59.5881654, 25.6124356],
    [59.5881054, 25.6125556],
  ],
  B: [
    [59.5880454, 25.6126756],
    [59.5879854, 25.6127956],
    [59.5879254, 25.6129156],
    [59.5878654, 25.6130356],
  ],
  C: [
    [59.5878054, 25.6131556],
    [59.5877454, 25.6132756],
    [59.5876854, 25.6133956],
    [59.5876254, 25.6135156],
    [59.5875654, 25.6136356],
  ],
};

function keyFor(boat) {
  return `${boat.section}-${boat.id}`;
}

export default function MarinaMapView({ boats, selectedId, queuedBoatIds, onBoatSelect }) {
  const bySection = {
    A: boats.filter((b) => b.section === "A"),
    B: boats.filter((b) => b.section === "B"),
    C: boats.filter((b) => b.section === "C"),
  };

  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        position: "relative",
        background: "radial-gradient(ellipse at 20% 30%, #123550 0%, #081723 100%)",
      }}
    >
      <MapContainer
        center={HARA_CENTER}
        zoom={17}
        minZoom={14}
        maxZoom={20}
        style={{ height: "100%", width: "100%" }}
        scrollWheelZoom
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        <Polygon
          positions={HARBOR_POLYGON}
          pathOptions={{
            color: "#7ec8e3",
            weight: 2,
            fillColor: "#4ea1c4",
            fillOpacity: 0.16,
          }}
        >
          <Tooltip sticky>Hara sadam basin</Tooltip>
        </Polygon>

        {PIER_LINES.map((line, i) => (
          <Polyline
            key={i}
            positions={line}
            pathOptions={{ color: "#c8a050", weight: 4, opacity: 0.9 }}
          />
        ))}

        {(["A", "B", "C"]).flatMap((sectionId) => {
          const sectionBoats = bySection[sectionId];
          return sectionBoats.map((boat, idx) => {
            const pos = BERTH_POSITIONS[sectionId][idx];
            if (!pos) return null;
            const isSelected = boat.id === selectedId;
            const inQueue = queuedBoatIds.has(boat.id);
            return (
              <CircleMarker
                key={keyFor(boat)}
                center={pos}
                radius={isSelected ? 9 : 7}
                pathOptions={{
                  color: isSelected ? "#f0c040" : "#e8f4f8",
                  weight: isSelected ? 3 : 1.5,
                  fillColor: boat.color,
                  fillOpacity: 0.95,
                }}
                eventHandlers={{ click: () => onBoatSelect(boat.id) }}
              >
                <Tooltip direction="top" offset={[0, -6]}>
                  <div style={{ fontSize: 11, fontWeight: "bold", letterSpacing: 0.5 }}>
                    {boat.name}
                  </div>
                  <div style={{ fontSize: 10, opacity: 0.85 }}>
                    Dock {sectionId}
                    {inQueue ? " · in crane queue" : ""}
                  </div>
                </Tooltip>
              </CircleMarker>
            );
          });
        })}

        <CircleMarker
          center={[59.5884654, 25.6129156]}
          radius={7}
          pathOptions={{
            color: "#5a4010",
            weight: 1.5,
            fillColor: "#d3a850",
            fillOpacity: 1,
          }}
        >
          <Tooltip>Fuel dock</Tooltip>
        </CircleMarker>
      </MapContainer>

      <div
        style={{
          position: "absolute",
          top: 14,
          left: 14,
          zIndex: 500,
          background: "rgba(9, 24, 36, 0.72)",
          border: "1px solid rgba(126,171,200,0.28)",
          borderRadius: 8,
          padding: "8px 10px",
          color: "#c8e0f0",
          fontSize: 11,
          letterSpacing: 0.5,
          backdropFilter: "blur(6px)",
          WebkitBackdropFilter: "blur(6px)",
        }}
      >
        Tap a berth marker to open boat details.
      </div>
    </div>
  );
}
