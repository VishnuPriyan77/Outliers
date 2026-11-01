import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mock = vi.hoisted(() => ({ rpc: vi.fn(), auth: vi.fn() }));
vi.mock("../lib/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/server")>();
  return { ...actual, authenticated: mock.auth };
});
import { POST } from "../app/api/interview/route";
const request = (body: unknown) =>
  new NextRequest("http://localhost/api/interview", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
const input = {
  description: "A large pothole blocks the road near my house.",
  language: "en",
};
beforeEach(() => {
  mock.auth.mockResolvedValue({ db: { rpc: mock.rpc }, user: { id: "u" } });
  mock.rpc.mockResolvedValue({ data: true, error: null });
  vi.stubEnv("OPENROUTER_API_KEY", "test-only-secret");
  vi.stubEnv("OPENROUTER_MODEL", "test/model");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
it("rejects unauthenticated access before making a provider request", async () => {
  mock.auth.mockRejectedValueOnce(new Error("Sign in"));
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  expect((await POST(request(input))).status).toBe(400);
  expect(fetch).not.toHaveBeenCalled();
});
it("enforces a persistent account quota before the provider call", async () => {
  mock.rpc.mockResolvedValueOnce({ data: false });
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  expect((await POST(request(input))).status).toBe(429);
  expect(fetch).not.toHaveBeenCalled();
});
it("uses OpenRouter and returns only validated category suggestions", async () => {
  const fetch = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                category: "road",
                urgent: false,
                summary: "Road damage",
                question: "Which street?",
                confidence: 0.95,
                evidence: ["pothole"],
                needsReview: false,
              }),
            },
          },
        ],
      }),
    ),
  );
  vi.stubGlobal("fetch", fetch);
  const data = await (await POST(request(input))).json();
  expect(data.category).toBe("road");
  expect(data.source).toBe("openrouter");
  expect(data.department).toBeUndefined();
  expect(fetch.mock.calls[0][0]).toBe(
    "https://openrouter.ai/api/v1/chat/completions",
  );
  expect(JSON.stringify(data)).not.toContain("test-only-secret");
});
it.each([
  "not JSON",
  JSON.stringify({
    category: "invented-department",
    urgent: false,
    summary: "x",
    question: "x",
  }),
])("falls back safely for invalid model output: %s", async (content) => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ choices: [{ message: { content } }] })),
      ),
  );
  const data = await (await POST(request(input))).json();
  expect(data.source).toBe("guided");
  expect(data.category).toBe("road");
});
it("handles provider timeouts without blocking submission", async () => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("timeout")));
  expect((await (await POST(request(input))).json()).source).toBe("guided");
});
it("rejects oversized request bodies before invoking the provider", async () => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  expect(
    (await POST(request({ ...input, description: "a".repeat(20000) }))).status,
  ).toBe(400);
  expect(fetch).not.toHaveBeenCalled();
});

it.each([
  ["A cut electric power line is lying on the road", "electricity", false],
  ["சாலையில் மின்கம்பி அறுந்து கிடக்கிறது", "electricity", false],
  ["Street light cable is cut and sparking", "other", false],
  ["There is garbage outside my house", "other", false],
  ["A large pothole blocks the road near my house.", "other", true],
])(
  "guards against plausible but wrong model labels: %s",
  async (description, expected, ungrounded) => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            JSON.stringify({
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      category: "road",
                      urgent: false,
                      summary: "Road",
                      question: "Where?",
                      confidence: 0.99,
                      evidence: [ungrounded ? "invented quote" : description],
                      needsReview: false,
                    }),
                  },
                },
              ],
            }),
          ),
        ),
    );
    const data = await (
      await POST(request({ description, language: "en" }))
    ).json();
    expect(data.category).toBe(expected);
    if (/power line|மின்கம்பி|sparking/.test(description))
      expect(data.urgent).toBe(true);
  },
);
it("rejects extra authority claims and low-confidence model output", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    category: "road",
                    urgent: false,
                    summary: "Road",
                    question: "Where?",
                    confidence: 0.4,
                    evidence: ["pothole"],
                    needsReview: false,
                    department: "roads",
                  }),
                },
              },
            ],
          }),
        ),
      ),
  );
  const data = await (await POST(request(input))).json();
  expect(data.category).toBe("other");
  expect(data.department).toBeUndefined();
});
