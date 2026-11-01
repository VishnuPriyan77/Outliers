import { routingCases } from "./routing-cases";
import { describe, it, expect } from "vitest";
import {
  classify,
  analyze,
  explainRoute,
  route,
  draftSchema,
  newComplaint,
  transition,
  validateFile,
  urgentSignal,
} from "../lib/domain";
const draft = {
  description: "A large pothole is blocking the road.",
  location: "Velachery Main Road, Chennai",
  duration: "Two weeks",
  impact: "Vehicles swerve into oncoming traffic.",
  category: "road" as const,
  language: "en" as const,
  chennai: true,
  ownership: "municipal" as const,
  urgent: false,
  consent: true as const,
};
describe("classification and deterministic routing", () => {
  it.each([
    ["road is broken", "road"],
    ["சாலையில் பெரிய குழி உள்ளது", "road"],
    ["குடிநீர் குழாய் உடைந்துள்ளது", "water"],
    ["குப்பை எடுக்கவில்லை", "waste"],
    ["தெரு விளக்கு எரியவில்லை", "lighting"],
    ["please help me", "other"],
    ["road damage and sewage leaking", "other"],
  ])("classifies %s", (text, result) => expect(classify(text)).toBe(result));
  it("does not let uncertain jurisdiction become a department assignment", () => {
    expect(route({ ...draft, ownership: "unknown" })).toBe("review");
    expect(route({ ...draft, chennai: false })).toBe("review");
    expect(route({ ...draft, category: "other" })).toBe("review");
  });
  it("routes every supported category independently of model output", () => {
    expect(route(draft)).toBe("roads");
    expect(route({ ...draft, category: "water" })).toBe("water");
    expect(route({ ...draft, category: "lighting" })).toBe("lighting");
    expect(route({ ...draft, category: "waste" })).toBe("waste");
  });
  it("requires citizen confirmation and valid fields", () => {
    expect(draftSchema.safeParse({ ...draft, consent: false }).success).toBe(
      false,
    );
    expect(draftSchema.safeParse({ ...draft, location: " " }).success).toBe(
      false,
    );
  });
  it("detects explicit immediate danger signals", () =>
    expect(urgentSignal("There is a live wire near the school")).toBe(true));
});
describe("accountability lifecycle", () => {
  it("enforces ordering, proof, role and one appeal across the full lifecycle", () => {
    let c = newComplaint(draft);
    expect(() =>
      transition(c, "resolved", "officer", "Work completed"),
    ).toThrow();
    expect(() =>
      transition(c, "acknowledged", "citizen", "Please start"),
    ).toThrow();
    c = transition(c, "acknowledged", "officer", "Received by demo officer");
    c = transition(c, "in_progress", "officer", "Field team assigned");
    expect(() =>
      transition(c, "resolved", "officer", "Work completed"),
    ).toThrow(/evidence/);
    c = {
      ...c,
      evidence: [
        {
          id: "e",
          name: "after.jpg",
          mime: "image/jpeg",
          size: 3,
          sha256: "a".repeat(64),
          purpose: "resolution",
          created_at: new Date().toISOString(),
        },
      ],
    };
    c = transition(c, "resolved", "officer", "Work completed with evidence");
    c = transition(
      c,
      "appealed",
      "citizen",
      "The pothole remains at the location",
    );
    c = transition(c, "in_progress", "officer", "Reinspection scheduled");
    c.evidence = [{ ...c.evidence[0], created_at: new Date().toISOString() }];
    c = transition(c, "resolved", "officer", "Repair inspected again");
    expect(() =>
      transition(c, "appealed", "citizen", "Still unresolved"),
    ).toThrow();
    c = transition(c, "closed", "citizen", "I confirm the repair is complete");
    expect(c.status).toBe("closed");
    expect(c.events).toHaveLength(8);
  });
  it("never resolves a complaint when its internal target expires", () => {
    const c = newComplaint(draft);
    c.due_at = "2020-01-01T00:00:00Z";
    expect(c.status).toBe("submitted");
  });
});
describe("evidence intake", () => {
  it("checks bytes rather than trusting the extension or MIME header", () => {
    expect(validateFile(new Uint8Array([255, 216, 255, 1]), 4)).toBe(
      "image/jpeg",
    );
    expect(() =>
      validateFile(new TextEncoder().encode("<script>bad</script>"), 20),
    ).toThrow(/Supported files/);
  });
  it("rejects empty and oversized evidence", () => {
    expect(() => validateFile(new Uint8Array(), 0)).toThrow();
    expect(() =>
      validateFile(new Uint8Array([255, 216, 255]), 10485761),
    ).toThrow();
  });
});

describe("verified bilingual routing", () => {
  it.each(routingCases)(
    "classifies and prioritizes %s",
    (text, category, hazard) => {
      expect(analyze(text)).toMatchObject({ category, hazard });
    },
  );
  it("prevents a false road choice and urgency downgrade from suppressing electrical safety", () => {
    const c = newComplaint({
      ...draft,
      description: "A street power line is cut and on the road",
      category: "road",
      urgent: false,
    });
    expect(c.department).toBe("review");
    expect(c.urgent).toBe(true);
    expect(c.routing?.severity).toBe("hazard");
    expect(c.routing?.reason).toContain("conflicts");
  });
  it("routes confirmed electricity to distribution and known streetlight cables to GCC", () => {
    expect(
      newComplaint({
        ...draft,
        description: "A street power line is cut",
        category: "electricity",
      }).department,
    ).toBe("electricity");
    expect(
      newComplaint({
        ...draft,
        description: "Streetlight cable is cut",
        category: "lighting",
      }).department,
    ).toBe("lighting");
  });
  it("triages private assets and out-of-area distribution cases", () => {
    expect(
      explainRoute({ ...draft, category: "electricity", assetOwner: "private" })
        .department,
    ).toBe("review");
    expect(
      explainRoute({ ...draft, category: "electricity", chennai: false })
        .department,
    ).toBe("review");
  });
});

it("does not assign explicitly private or transmission assets to distribution even with a manual electricity choice", () => {
  expect(
    explainRoute({
      ...draft,
      category: "electricity",
      description: "Internal wiring power supply has failed",
    }).department,
  ).toBe("review");
  expect(
    explainRoute({
      ...draft,
      category: "electricity",
      description: "Transmission supply outage",
    }).department,
  ).toBe("review");
});
