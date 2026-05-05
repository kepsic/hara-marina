import { MapContainer, TileLayer, Polygon, Polyline, CircleMarker, Tooltip } from "react-leaflet";

const HARA_CENTER = [59.5742, 25.7431];

// Approximate harbor basin outline, matched to the landing-page marina sketch.
const HARBOR_POLYGON = [
  [59.5757, 25.7416],
  [59.5758, 25.7448],
  [59.5753, 25.7449],
  [59.5750, 25.7442],
  [59.5740, 25.7441],
  [59.5738, 25.7424],
  [59.5746, 25.7418],
];

const PIER_LINES = [
  [
    [59.57535, 25.74265],
    [59.57395, 25.74265],
  ],
  [
    [59.57458, 25.74235],
    [59.57458, 25.74358],
  ],
  [
    [59.57395, 25.74265],
    [59.57472, 25.74395],
  ],
];

const BERTH_POSITIONS = {
  A: [
    [59.57430, 25.74298],
    [59.57424, 25.74310],
    [59.57418, 25.74322],
  ],
  B: [
    [59.57412, 25.74334],
    [59.57406, 25.74346],
    [59.57400, 25.74358],
    [59.57394, 25.74370],
  ],
  C: [
    [59.57388, 25.74382],
    [59.57382, 25.74394],
    [59.57376, 25.74406],
    [59.57370, 25.74418],
    [59.57364, 25.74430],
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
          center={[59.57454, 25.74358]}
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
