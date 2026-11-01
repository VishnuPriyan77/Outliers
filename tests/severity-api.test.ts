import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mock = vi.hoisted(() => ({
  auth: vi.fn(),
  admin: vi.fn(),
  claim: vi.fn(),
  run: vi.fn(),
  after: vi.fn(),
  maybe: vi.fn(),
}));
vi.mock("../lib/server", async (original) => ({
  ...(await original<typeof import("../lib/server")>()),
  authenticated: mock.auth,
}));
vi.mock("../lib/severity-engine", () => ({
  severityAdmin: mock.admin,
  runSeverity: mock.run,
}));
vi.mock("next/server", async (original) => ({
  ...(await original<typeof import("next/server")>()),
  after: mock.after,
}));
import { POST, GET } from "../app/api/severity/route";
const id = "11111111-1111-4111-8111-111111111111";
function request(body: unknown) {
  return new NextRequest("http://localhost/api/severity", {
    method: "POST",
    body: JSON.stringify(body),
  });
}
beforeEach(() => {
  const chain = {
    select: () => chain,
    eq: () => chain,
    maybeSingle: mock.maybe,
  };
  mock.auth.mockResolvedValue({
    db: { from: () => chain },
    user: { id: "owner" },
  });
  mock.maybe.mockResolvedValue({ data: { id }, error: null });
  mock.admin.mockReturnValue({ rpc: mock.claim });
  mock.claim.mockResolvedValue({ data: { id, lease: "lease" }, error: null });
  mock.run.mockResolvedValue(undefined);
});
afterEach(() => {
  vi.resetAllMocks();
  vi.unstubAllEnvs();
});
it("rejects unauthenticated and inaccessible reports before privileged access", async () => {
  mock.auth.mockRejectedValueOnce(new Error("unauthenticated"));
  expect((await POST(request({ complaintId: id }))).status).toBe(400);
  expect(mock.admin).not.toHaveBeenCalled();
  mock.maybe.mockResolvedValueOnce({ data: null, error: null });
  expect((await POST(request({ complaintId: id }))).status).toBe(404);
  expect(mock.admin).not.toHaveBeenCalled();
});
it("returns 202 and schedules backend work after responding", async () => {
  expect((await POST(request({ complaintId: id }))).status).toBe(202);
  expect(mock.claim).toHaveBeenCalledWith("claim_severity", {
    p_id: id,
    p_actor: "owner",
  });
  expect(mock.run).not.toHaveBeenCalled();
  await mock.after.mock.calls[0][0]();
  expect(mock.run).toHaveBeenCalledOnce();
});
it("does not schedule duplicate claims", async () => {
  mock.claim.mockResolvedValueOnce({ data: null, error: null });
  expect((await POST(request({ complaintId: id }))).status).toBe(200);
  expect(mock.after).not.toHaveBeenCalled();
});
it("never accepts caller-supplied scores, consent or identifiers", async () => {
  expect(
    (
      await POST(
        request({ complaintId: id, score: 100, ai_image_consent: true }),
      )
    ).status,
  ).toBe(400);
  expect(mock.admin).not.toHaveBeenCalled();
});
it("denies scheduler access without its separate secret", async () => {
  vi.stubEnv("CRON_SECRET", "private-scheduler-secret");
  expect(
    (await GET(new NextRequest("http://localhost/api/severity"))).status,
  ).toBe(401);
  expect(mock.admin).not.toHaveBeenCalled();
});
