// Fetches live conditions for Loksa station from Estonian Weather Service.
// Loksa (~10 km east of Hara, same bay) is the closest official station, but
// it is a coastal buoy that only publishes wind / sea level / water temp.
// For pressure / humidity / phenomenon / precipitation / visibility we backfill
// from the nearest inland station that has each field, and surface the source
// in `sources[field] = { name, distance_km }` so the UI can attribute it.
// Source: https://www.ilmateenistus.ee/ilma_andmed/xml/observations.php

const PRIMARY = "Loksa";

const FIELDS = [
  { key: "airtemperature",    borrow: false, num: true  },
  { key: "winddirection",     borrow: false, num: true  },
  { key: "windspeed",         borrow: false, num: true  },
  { key: "windspeedmax",      borrow: false, num: true  },
  { key: "waterlevel",        borrow: false, num: true  },
  { key: "waterlevel_eh2000", borrow: false, num: true  },
  { key: "watertemperature",  borrow: false, num: true  },
  { key: "airpressure",       borrow: true,  num: true  },
  { key: "relativehumidity",  borrow: true,  num: true  },
  { key: "phenomenon",        borrow: true,  num: false },
  { key: "precipitations",    borrow: true,  num: true  },
  { key: "visibility",        borrow: true,  num: true  },
];

function parseStations(xml) {
  const out = [];
  const blocks = xml.match(/<station>[\s\S]*?<\/station>/g) || [];
  for (const block of blocks) {
    const get = (tag) => {
      const m = block.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`));
      return m ? m[1].trim() : "";
    };
    const name = get("name");
    if (!name) continue;
    const lat = parseFloat(get("latitude"));
    const lon = parseFloat(get("longitude"));
    if (isNaN(lat) || isNaN(lon)) continue;
    const s = { name, wmocode: get("wmocode"), latitude: lat, longitude: lon };
    for (const f of FIELDS) s[f.key] = get(f.key);
    out.push(s);
  }
  return out;
}

function distanceKm(a, b) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

export default async function handler(req, res) {
  try {
    const xml = await fetch(
      "https://www.ilmateenistus.ee/ilma_andmed/xml/observations.php",
      { cache: "no-store" }
    ).then((r) => r.text());

    const stations = parseStations(xml);
    if (!stations.length) return res.status(502).json({ error: "no stations" });

    const primary = stations.find((s) => s.name === PRIMARY);
    if (!primary) return res.status(404).json({ error: `${PRIMARY} station not found` });

    const result = {
      name: primary.name,
      wmocode: primary.wmocode,
      latitude: primary.latitude,
      longitude: primary.longitude,
      sources: {},
    };

    for (const f of FIELDS) {
      const raw = primary[f.key];
      if (raw !== "" && raw !== undefined && raw !== null) {
        result[f.key] = f.num ? parseFloat(raw) : raw;
        result.sources[f.key] = { name: primary.name, distance_km: 0 };
        continue;
      }
      if (!f.borrow) {
        result[f.key] = null;
        continue;
      }
      const candidates = stations
        .filter((s) => s.name !== primary.name && s[f.key] !== "" && s[f.key] !== undefined)
        .map((s) => ({ s, d: distanceKm(primary, s) }))
        .sort((a, b) => a.d - b.d);
      if (candidates.length === 0) {
        result[f.key] = null;
      } else {
        const { s, d } = candidates[0];
        const v = s[f.key];
        result[f.key] = f.num ? parseFloat(v) : v;
        result.sources[f.key] = { name: s.name, distance_km: Math.round(d) };
      }
    }

    const ts = xml.match(/timestamp="(\d+)"/);
    result.timestamp = ts ? parseInt(ts[1]) * 1000 : Date.now();

    res.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=600");
    return res.status(200).json(result);
  } catch (e) {
    return res.status(502).json({ error: String(e) });
  }
}
