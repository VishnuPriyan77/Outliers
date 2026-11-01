import { afterEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("../lib/supabase", () => ({
  demoMode: false,
  supabase: { rpc: mocks.rpc },
}));
import { submit } from "../lib/repository";
const draft = {
  description: "A street power line is cut",
  location: "Anna Nagar, Chennai",
  duration: "Today",
  impact: "Risk to people",
  category: "electricity" as const,
  language: "en" as const,
  chennai: true,
  ownership: "unknown" as const,
  urgent: true,
  consent: true as const,
};
afterEach(() => vi.clearAllMocks());
it.each([
  { data: null, error: { message: "missing RPC" } },
  { data: "202611010001", error: null },
])(
  "fails closed before sending a report to an outdated hosted schema",
  async (result) => {
    mocks.rpc.mockResolvedValueOnce(result);
    await expect(submit(draft)).rejects.toThrow(/upgrade required/);
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("routing_version");
  },
);
