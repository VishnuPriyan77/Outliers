import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import { z } from "zod";
import { authenticated } from "@/lib/server";
import { MAX_FILE, validateFile } from "@/lib/domain";
export async function POST(req: NextRequest) {
  try {
    const { db, user } = await authenticated(req);
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY)
      throw new Error(
        "Evidence service is not configured. Contact the administrator.",
      );
    // Bound the stream before multipart parsing, including chunked requests.
    const reader = req.body?.getReader();
    if (!reader) throw new Error("Missing upload.");
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const r = await reader.read();
      if (r.done) break;
      size += r.value.length;
      if (size > MAX_FILE + 65536) {
        await reader.cancel();
        return NextResponse.json(
          { error: "Upload exceeds 4 MB." },
          { status: 413 },
        );
      }
      chunks.push(r.value);
    }
    const buffer = Buffer.concat(chunks);
    const form = await new Response(buffer, {
      headers: { "content-type": req.headers.get("content-type") || "" },
    }).formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new Error("Choose a file.");
    const complaintId = z.uuid().parse(form.get("complaintId"));
    const purpose = z.enum(["report", "resolution"]).parse(form.get("purpose"));
    const bytes = new Uint8Array(await file.arrayBuffer()),
      mime = validateFile(bytes, file.size);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const path = `${user.id}/${complaintId}/${crypto.randomUUID()}`;
    const { error: uploadError } = await db.storage
      .from("evidence")
      .upload(path, bytes, { contentType: mime, upsert: false });
    if (uploadError)
      throw new Error("Upload denied. Check complaint access and file limits.");
    const admin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const { data, error } = await admin.rpc("attach_evidence", {
      p_actor: user.id,
      p_complaint: complaintId,
      p_path: path,
      p_name: file.name.slice(0, 200),
      p_mime: mime,
      p_size: file.size,
      p_sha256: sha256,
      p_purpose: purpose,
    });
    if (error) {
      await admin.storage.from("evidence").remove([path]);
      throw new Error(
        "Evidence could not be attached. Check your role and complaint status.",
      );
    }
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Upload failed." },
      { status: 400 },
    );
  }
}
