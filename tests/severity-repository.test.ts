import { expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock("../lib/supabase", () => ({
  demoMode: false,
  supabase: { from: mock.from },
}));
import { listComplaints } from "../lib/repository";
it("never accepts citizen-supplied assessment data embedded in a draft", async () => {
  const fake = { priority: "P4", score: 0 };
  mock.from.mockImplementation((table: string) => ({
    select: () =>
      table === "complaints"
        ? {
            order: async () => ({
              data: [{ id: "case", draft: { severity: fake }, events: [] }],
              error: null,
            }),
          }
        : Promise.resolve({ data: [], error: null }),
  }));
  expect((await listComplaints())[0].severity).toBeNull();
});
