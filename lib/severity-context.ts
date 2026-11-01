import { z } from "zod";
import { contextSchema, unknown, type Factor } from "./severity";
import type { Draft } from "./domain";

// Fixed destinations only; citizen text is never interpolated into queries or URLs.
async function json(url: string, init?: RequestInit) {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(8000),
    cache: "no-store",
    ...init,
  });
  if (!res.ok) throw new Error("Context unavailable");
  const text = await res.text();
  if (text.length > 250000) throw new Error("Context response too large");
  return JSON.parse(text);
}
const osmSchema = z.object({
  remark: z.string().optional(),
  elements: z
    .array(
      z.object({
        tags: z.record(z.string(), z.string()).optional(),
      }),
    )
    .max(500),
});
const roadScores: Record<string, number> = {
  motorway: 100,
  trunk: 90,
  primary: 80,
  secondary: 60,
  tertiary: 40,
  residential: 20,
  service: 10,
  unclassified: 20,
};
export async function locationContext(
  draft: Draft,
  acquireNominatim: () => Promise<boolean> = async () => false,
): Promise<{ sensitive_places: Factor; road: Factor; weather: Factor }> {
  const empty = {
    sensitive_places: unknown("Nearby sensitive places not verified."),
    road: unknown("Road importance not verified."),
    weather: unknown("Current weather unavailable."),
  };
  const coords = contextSchema.safeParse(draft.context_coordinates);
  if (draft.context_consent !== true || !coords.success)
    return {
      sensitive_places: unknown(
        "No permission or coordinates for external location context.",
      ),
      road: unknown(
        "No permission or coordinates for external location context.",
      ),
      weather: unknown(
        "No permission or coordinates for external weather context.",
      ),
    };
  // Round to approximately 100 m; never send the complaint's free-text address.
  const lat = Number(coords.data.latitude.toFixed(3)),
    lon = Number(coords.data.longitude.toFixed(3));
  let nominatimRoad: Factor | undefined;
  await Promise.allSettled([
    (async () => {
      if (!process.env.NOMINATIM_USER_AGENT || !(await acquireNominatim()))
        return;
      // Nominatim is used only for a reverse lookup, not bulk POI search. Opt-in deployment
      // requires an identifying agent and the database-backed one-request-per-second gate.
      const url = new URL("https://nominatim.openstreetmap.org/reverse");
      for (const [key, value] of Object.entries({
        lat,
        lon,
        format: "jsonv2",
        zoom: 18,
        addressdetails: 0,
        extratags: 1,
      }))
        url.searchParams.set(key, String(value));
      const data = z
        .object({ extratags: z.record(z.string(), z.string()).optional() })
        .parse(
          await json(url.href, {
            cache: "force-cache",
            next: { revalidate: 86400 },
            headers: { "User-Agent": process.env.NOMINATIM_USER_AGENT },
          }),
        );
      const highway = data.extratags?.highway;
      if (highway && roadScores[highway] !== undefined)
        nominatimRoad = {
          score: roadScores[highway],
          confidence: 0.6,
          explanation: `OpenStreetMap/Nominatim returned highway=${highway} near the rounded coordinate; exact asset ownership is unverified.`,
        };
    })(),
    (async () => {
      const query = `[out:json][timeout:5];(nwr(around:350,${lat},${lon})[amenity~"^(school|hospital|kindergarten)$"];way(around:100,${lat},${lon})[highway~"^(motorway|trunk|primary|secondary|tertiary|residential|service|unclassified)$"];);out tags 500;`;
      const data = osmSchema.parse(
        await json("https://overpass-api.de/api/interpreter", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ data: query }),
        }),
      );
      // Overpass can return HTTP 200 with a runtime error or a truncated result set.
      if (data.remark || data.elements.length >= 500)
        throw new Error("Incomplete map context");
      const places = data.elements.map((e) => e.tags?.amenity).filter(Boolean);
      // A successful empty OSM query is evidence of no mapped match, not absence in reality.
      empty.sensitive_places = {
        score: places.includes("hospital") ? 100 : places.length ? 80 : 0,
        confidence: 0.6,
        explanation: places.length
          ? "OpenStreetMap maps a school, kindergarten or hospital within 350 m of the rounded coordinate. Proximity and map completeness require review."
          : "No matching sensitive place is mapped within the query area; unmapped places may exist.",
      };
      const roads = data.elements
        .map((e) => roadScores[e.tags?.highway || ""])
        .filter((v) => v !== undefined);
      if (roads.length)
        empty.road = {
          score: Math.max(...roads),
          confidence: 0.6,
          explanation:
            "Highest mapped road class within 100 m of the rounded coordinate. This may be an adjacent road; exact road and ownership require review.",
        };
    })(),
    (async () => {
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=precipitation,wind_speed_10m&wind_speed_unit=kmh`;
      const data = z
        .object({
          current: z.object({
            precipitation: z.number().min(0).max(1000),
            wind_speed_10m: z.number().min(0).max(500),
            time: z.string(),
          }),
        })
        .parse(await json(url));
      const time = Date.parse(`${data.current.time}Z`);
      if (!Number.isFinite(time) || Math.abs(Date.now() - time) > 2 * 3600000)
        throw new Error("Stale weather");
      const { precipitation: rain, wind_speed_10m: wind } = data.current;
      empty.weather = {
        score: Math.max(
          rain >= 10 ? 100 : rain >= 2 ? 60 : rain > 0 ? 30 : 0,
          wind >= 60 ? 100 : wind >= 40 ? 60 : wind >= 20 ? 30 : 0,
        ),
        confidence: 0.8,
        explanation: `Open-Meteo current precipitation ${rain} mm and wind ${wind} km/h at ${data.current.time} UTC. Regional conditions, not on-site verification.`,
      };
    })(),
  ]);
  if (empty.road.score === null && nominatimRoad) empty.road = nominatimRoad;
  return empty;
}
