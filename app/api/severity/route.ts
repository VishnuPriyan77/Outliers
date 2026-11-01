import { after, NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { authenticated, boundedJson } from "@/lib/server";
import { runSeverity, severityAdmin } from "@/lib/severity-engine";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const { db, user } = await authenticated(req);
    const { complaintId } = z
      .object({ complaintId: z.uuid() })
      .strict()
      .parse(await boundedJson(req, 1000));
    // Authorize with the user's RLS-scoped client before using service-role access.
    const { data: complaint, error } = await db
      .from("complaints")
      .select("id")
      .eq("id", complaintId)
      .maybeSingle();
    if (error || !complaint)
      return NextResponse.json(
        { error: "Complaint unavailable." },
        { status: 404 },
      );
    const admin = severityAdmin();
    const { data: job, error: claimError } = await admin.rpc("claim_severity", {
      p_id: complaintId,
      p_actor: user.id,
    });
    if (claimError) throw new Error("Assessment unavailable");
    if (job)
      after(async () => {
        try {
          await runSeverity(admin, job);
        } catch {
          /* Persisted lease allows recovery without sensitive logging. */
        }
      });
    return NextResponse.json(
      { status: job ? "processing" : "unchanged" },
      { status: job ? 202 : 200 },
    );
  } catch {
    return NextResponse.json(
      {
        error:
          "Sign in and check severity service configuration. Your complaint remains saved.",
      },
      { status: 400 },
    );
  }
}
// Optional scheduler recovers pending jobs, bounded failures and expired leases even if the
// submitting browser closes. Configure a server-side CRON_SECRET; never expose this publicly.
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const expected = Buffer.from(`Bearer ${secret || ""}`),
    supplied = Buffer.from(req.headers.get("authorization") || "");
  if (
    !secret ||
    supplied.length !== expected.length ||
    !timingSafeEqual(supplied, expected)
  )
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (process.env.NEXT_PUBLIC_DEMO_MODE !== "false")
    return NextResponse.json(
      { error: "Connected mode required" },
      { status: 503 },
    );
  try {
    const admin = severityAdmin();
    // One job per invocation keeps all provider timeouts within the function budget.
    const { data, error } = await admin
      .from("severity_assessments")
      .select("complaint_id")
      .in("status", ["pending", "failed", "processing"])
      .or("attempts.lt.3,and(status.eq.processing,attempts.eq.3)")
      .lt("updated_at", new Date(Date.now() - 120000).toISOString())
      .order("updated_at")
      .limit(1);
    if (error) throw new Error("Queue unavailable");
    let claimed = false;
    if (data?.[0]) {
      const { data: job, error: claimError } = await admin.rpc(
        "claim_severity",
        { p_id: data[0].complaint_id, p_actor: null },
      );
      if (claimError) throw new Error("Queue unavailable");
      if (job) {
        claimed = true;
        await runSeverity(admin, job);
      }
    }
    return NextResponse.json({ processed: claimed ? 1 : 0 });
  } catch {
    return NextResponse.json(
      { error: "Queue unavailable; jobs remain persisted for retry." },
      { status: 503 },
    );
  }
}
