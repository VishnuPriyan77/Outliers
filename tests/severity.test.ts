import { afterEach, expect, it, vi } from "vitest";
import {
  band,
  calculateAssessment,
  hazardFacts,
  weights,
  unknown,
} from "../lib/severity";
import sharp from "sharp";
import {
  assessModel,
  runSeverity,
  prepareSeverityImage,
} from "../lib/severity-engine";
import { locationContext } from "../lib/severity-context";
import type { SupabaseClient } from "@supabase/supabase-js";
const draft = {
  description: "Large pothole blocking our road",
  impact: "Vehicles cannot pass",
  location: "Private street address",
  duration: "Two weeks",
  category: "road",
  language: "en",
  chennai: true,
  ownership: "municipal",
  urgent: false,
  consent: true,
};
const factor = { score: 50, confidence: 0.8, explanation: "Reported risk" };
const factors = () =>
  Object.fromEntries(Object.keys(weights).map((key) => [key, { ...factor }]));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
it.each([
  [0, "P4"],
  [19, "P4"],
  [20, "P3"],
  [44, "P3"],
  [45, "P2"],
  [69, "P2"],
  [70, "P1"],
  [100, "P1"],
])("preserves band boundary %s", (score, priority) =>
  expect(band(Number(score))).toBe(priority),
);
it("calculates weighted totals in backend code", () => {
  expect(
    calculateAssessment(
      {
        ...factors(),
        hazard: { ...factor, score: 100 },
        visual: { ...factor, score: 0 },
      },
      false,
    ).score,
  ).toBe(52.5);
});
it("keeps missing evidence unknown and separates emergency override", () => {
  const result = calculateAssessment(
    { ...factors(), visual: unknown("No consent") },
    true,
  );
  expect(result.score).toBeNull();
  expect(result.score_range).toEqual([37.5, 62.5]);
  expect(result.priority).toBe("P1");
  expect(result.coverage).toBe(75);
  expect(result.confidence).toBe(0.6);
});
it.each([-1, 101, NaN, Infinity, "80"])(
  "rejects invalid factor scores %s",
  (score) =>
    expect(() =>
      calculateAssessment(
        { ...factors(), hazard: { ...factor, score } },
        false,
      ),
    ).toThrow(),
);
it("rejects invalid confidence and missing factors", () => {
  expect(() => calculateAssessment({ hazard: factor }, false)).toThrow();
  expect(() =>
    calculateAssessment(
      { ...factors(), hazard: { ...factor, confidence: 1.1 } },
      false,
    ),
  ).toThrow();
  expect(() =>
    calculateAssessment(
      { ...factors(), hazard: { ...factor, score: null } },
      false,
    ),
  ).toThrow();
});
it("extracts only allowlisted facts, excluding raw personal information", () => {
  const facts = hazardFacts(
    "road",
    "Large pothole by John at 99 Private St, john@example.com, +91 9876543210 blocks the school",
  );
  expect(facts.reported_signals).toContain("deep_damage");
  expect(JSON.stringify(facts)).not.toMatch(/John|Private|example|9876543210/);
});
it("makes no context requests without explicit consent", async () => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  const result = await locationContext(draft as never);
  expect(fetch).not.toHaveBeenCalled();
  expect(result.weather.score).toBeNull();
});
it("does not fabricate context during provider outages", async () => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("down")));
  const result = await locationContext({
    ...draft,
    context_consent: true,
    context_coordinates: { latitude: 13, longitude: 80 },
  } as never);
  expect(Object.values(result).every((f) => f.score === null)).toBe(true);
});
it("uses validated mapped context and fresh weather; never sends addresses", async () => {
  const fetch = vi.fn().mockImplementation(
    async (url: string) =>
      new Response(
        JSON.stringify(
          url.includes("open-meteo")
            ? {
                current: {
                  precipitation: 12,
                  wind_speed_10m: 10,
                  time: new Date().toISOString().slice(0, 16),
                },
              }
            : {
                elements: [
                  { tags: { amenity: "hospital" } },
                  { tags: { highway: "primary" } },
                ],
              },
        ),
      ),
  );
  vi.stubGlobal("fetch", fetch);
  const result = await locationContext({
    ...draft,
    context_consent: true,
    context_coordinates: { latitude: 13.123456, longitude: 80.123456 },
  } as never);
  expect(result.sensitive_places.score).toBe(100);
  expect(result.road.score).toBe(80);
  expect(result.weather.score).toBe(100);
  expect(JSON.stringify(fetch.mock.calls)).not.toContain("Private street");
  expect(JSON.stringify(fetch.mock.calls)).not.toContain("13.123456");
});
it("validates AI output and refuses invented vision without an image", async () => {
  vi.stubEnv("OPENROUTER_API_KEY", "test-secret");
  vi.stubEnv("OPENROUTER_MODEL", "test/text");
  const fetch = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({ hazard: factor, visual: factor }),
            },
          },
        ],
      }),
    ),
  );
  vi.stubGlobal("fetch", fetch);
  const result = await assessModel(hazardFacts("road", draft.description));
  expect(result.visual.score).toBeNull();
  expect(JSON.stringify(fetch.mock.calls[0])).toContain("data_collection");
});
it("uses the explicitly configured vision model only when an image is provided", async () => {
  vi.stubEnv("OPENROUTER_API_KEY", "test-secret");
  vi.stubEnv("OPENROUTER_MODEL", "test/text");
  vi.stubEnv("OPENROUTER_VISION_MODEL", "test/vision");
  const fetch = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({ hazard: factor, visual: factor }),
            },
          },
        ],
      }),
    ),
  );
  vi.stubGlobal("fetch", fetch);
  const result = await assessModel(
    hazardFacts("road", draft.description),
    "data:image/jpeg;base64,test",
  );
  const body = JSON.parse(fetch.mock.calls[0][1].body);
  expect(body.model).toBe("test/vision");
  expect(result.visual.score).toBe(50);
});
it("persists failure and emergency information without image consent or raw text transfer", async () => {
  vi.stubEnv("OPENROUTER_API_KEY", "");
  const rpc = vi.fn().mockResolvedValue({ error: null }),
    from = vi.fn();
  await runSeverity({ rpc, from } as unknown as SupabaseClient, {
    id: "case",
    lease: "lease",
    corroboration: null,
    draft: { ...draft, urgent: true },
  });
  expect(from).not.toHaveBeenCalled();
  const saved = rpc.mock.calls.find(
    (call) => call[0] === "finish_severity",
  )![1];
  expect(saved.p_result.emergency).toBe(true);
  expect(saved.p_result.priority).toBe("P1");
  expect(saved.p_result.factors.visual.score).toBeNull();
  expect(saved.p_error).toBeTruthy();
});
it.each([
  "not JSON",
  JSON.stringify({ hazard: { ...factor, score: 101 }, visual: factor }),
])("rejects invalid AI responses", async (content) => {
  vi.stubEnv("OPENROUTER_API_KEY", "test-secret");
  vi.stubEnv("OPENROUTER_MODEL", "test/text");
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ choices: [{ message: { content } }] })),
      ),
  );
  await expect(
    assessModel(hazardFacts("road", draft.description)),
  ).rejects.toThrow();
});

it("re-encodes consented images with bounded dimensions and no metadata", async () => {
  const original = await sharp({
    create: { width: 1600, height: 1200, channels: 3, background: "red" },
  })
    .jpeg()
    .withExif({ IFD0: { Artist: "Private citizen" } })
    .toBuffer();
  expect((await sharp(original).metadata()).exif).toBeTruthy();
  const safe = await prepareSeverityImage(original);
  const metadata = await sharp(safe).metadata();
  expect(metadata.width).toBe(1024);
  expect(metadata.exif).toBeUndefined();
  expect(metadata.format).toBe("jpeg");
});
it("does not download evidence without consent even when a vision model is configured", async () => {
  vi.stubEnv("OPENROUTER_VISION_MODEL", "test/vision");
  vi.stubEnv("OPENROUTER_API_KEY", "");
  const from = vi.fn(),
    rpc = vi.fn().mockResolvedValue({ error: null });
  await runSeverity({ rpc, from } as unknown as SupabaseClient, {
    id: "case",
    lease: "lease",
    corroboration: 0,
    draft: { ...draft, ai_image_consent: false },
  });
  expect(from).not.toHaveBeenCalled();
});
it("treats HTTP-200 map runtime errors as unknown, not zero risk", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("overpass"))
        return new Response(
          JSON.stringify({ remark: "runtime error: timeout", elements: [] }),
        );
      throw new Error("unavailable");
    }),
  );
  const result = await locationContext({
    ...draft,
    context_consent: true,
    context_coordinates: { latitude: 13, longitude: 80 },
  } as never);
  expect(result.sensitive_places.score).toBeNull();
  expect(result.road.score).toBeNull();
});
