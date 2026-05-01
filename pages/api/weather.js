// Fetches live conditions for Loksa station from Estonian Weather Service.
// Loksa (~10 km east of Hara, same bay) is the closest official station with
// wind direction, wind speed, sea level and water temperature.
// Source: https://www.ilmateenistus.ee/ilma_andmed/xml/observations.php

export default async function handler(req, res) {
  try {
    const xml = await fetch(
      "https://www.ilmateenistus.ee/ilma_andmed/xml/observations.php",
      { cache: "no-store" }
    ).then((r) => r.text());

    const blocks = xml.match(/<station>[\s\S]*?<\/station>/g);
    if (!blocks) return res.status(502).json({ error: "no stations" });

    const fields = [
      "wmocode", "longitude", "latitude",
      "airtemperature", "winddirection", "windspeed", "windspeedmax",
      "waterlevel", "waterlevel_eh2000", "watertemperature",
      "relativehumidity", "airpressure", "phenomenon",
    ];

    let loksa = null;
    for (const block of blocks) {
      const name = block.match(/<name>(.*?)<\/name>/)?.[1] ?? "";
      if (name === "Loksa") {
        loksa = { name };
        for (const f of fields) {
          const m = block.match(new RegExp(`<${f}>(.*?)</${f}>`));
          const v = m ? m[1] : null;
          // Numeric fields → Number, empty → null
          if (v === null || v === "") loksa[f] = null;
          else if (f === "phenomenon" || f === "wmocode") loksa[f] = v;
          else loksa[f] = isNaN(parseFloat(v)) ? v : parseFloat(v);
        }
        break;
      }
    }

    if (!loksa) return res.status(404).json({ error: "Loksa station not found" });

    const ts = xml.match(/timestamp="(\d+)"/);
    loksa.timestamp = ts ? parseInt(ts[1]) * 1000 : Date.now();

    res.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=600");
    return res.status(200).json(loksa);
  } catch (e) {
    return res.status(502).json({ error: String(e) });
  }
}
