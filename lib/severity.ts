import { z } from "zod";

export const weights = {
  hazard: 30,
  visual: 25,
  sensitive_places: 15,
  road: 10,
  weather: 10,
  corroboration: 10,
} as const;
export type FactorKey = keyof typeof weights;
export const factorNames: Record<FactorKey, string> = {
  hazard: "Hazard type",
  visual: "Visual severity",
  sensitive_places: "Nearby sensitive places",
  road: "Road importance",
  weather: "Weather",
  corroboration: "Citizen corroboration",
};
export const factorSchema = z.object({
  score: z.number().min(0).max(100).nullable(),
  explanation: z.string().min(1).max(600),
  confidence: z.number().min(0).max(1),
});
export type Factor = z.infer<typeof factorSchema>;
export const factorsSchema = z.object({
  hazard: factorSchema,
  visual: factorSchema,
  sensitive_places: factorSchema,
  road: factorSchema,
  weather: factorSchema,
  corroboration: factorSchema,
});
export type Factors = z.infer<typeof factorsSchema>;
export type Priority = "P1" | "P2" | "P3" | "P4";
export function band(score: number): Priority {
  return score >= 70 ? "P1" : score >= 45 ? "P2" : score >= 20 ? "P3" : "P4";
}
export function unknown(explanation: string): Factor {
  return { score: null, explanation, confidence: 0 };
}
export function calculateAssessment(raw: unknown, emergency: boolean) {
  const factors = factorsSchema.parse(raw);
  let known = 0,
    coverage = 0,
    confidence = 0;
  for (const key of Object.keys(weights) as FactorKey[]) {
    const f = factors[key],
      weight = weights[key];
    if (f.score !== null) {
      known += (f.score * weight) / 100;
      coverage += weight;
      confidence += (f.confidence * weight) / 100;
    } else if (f.confidence !== 0)
      throw new Error("Unknown factors must have zero confidence");
  }
  const lower = Math.round(known * 100) / 100;
  const upper = Math.round((known + 100 - coverage) * 100) / 100;
  return {
    factors,
    score: coverage === 100 ? lower : null,
    score_range: [lower, upper],
    coverage,
    confidence: Math.round(confidence * 100) / 100,
    priority: emergency
      ? ("P1" as const)
      : coverage === 100
        ? band(lower)
        : null,
    emergency,
    emergency_reason: emergency
      ? "Citizen-reported immediate danger; seek emergency assistance directly. This is not emergency dispatch."
      : null,
    assessed_at: new Date().toISOString(),
    version: 1,
  };
}
export type AssessmentResult = ReturnType<typeof calculateAssessment>;
export type Assessment = {
  complaint_id: string;
  status: "pending" | "processing" | "completed" | "partial" | "failed";
  attempts: number;
  result: AssessmentResult | null;
  error: string | null;
  created_at: string;
  updated_at: string;
};
export const contextSchema = z
  .object({
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
  })
  .strict();
// No raw free text, address, name, phone or account identifiers are sent to the AI.
export function hazardFacts(category: string, text: string) {
  const signals: Record<string, RegExp> = {
    deep_damage: /deep|large pothole|collapsed|பெரிய குழி|இடிந்து/iu,
    blocked_access: /block|cannot pass|swerv|தடை/iu,
    flooding: /flood|overflow|வெள்ளம்/iu,
    sewage: /sewag|கழிவுநீர்/iu,
    exposed_electricity: /live wire|electrocut|exposed wire|மின்சாரம் தாக்க/iu,
    fire: /\bfire\b|தீ விபத்து/iu,
    injury: /injur|காயம்/iu,
    vulnerable_people: /school|hospital|children|elderly|பள்ளி|மருத்துவமனை/iu,
  };
  return {
    category,
    reported_signals: Object.entries(signals)
      .filter(([, re]) => re.test(text))
      .map(([key]) => key),
  };
}
