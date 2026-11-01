import { createClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
export async function authenticated(req: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL,
    key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (process.env.NEXT_PUBLIC_DEMO_MODE !== "false" || !url || !key)
    throw new Error(
      "Connected mode and sign-in are required for this operation.",
    );
  const token = req.headers.get("authorization");
  if (!token?.startsWith("Bearer ")) throw new Error("Sign in to continue.");
  const db = createClient(url, key, {
    global: { headers: { Authorization: token } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await db.auth.getUser(token.slice(7));
  if (error || !data.user)
    throw new Error("Your session expired. Please sign in again.");
  return { db, user: data.user };
}
export async function boundedJson(req: NextRequest, limit = 18000) {
  if (Number(req.headers.get("content-length") || 0) > limit)
    throw new Error("Request is too large.");
  const reader = req.body?.getReader();
  if (!reader) throw new Error("Request body required.");
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > limit) {
      await reader.cancel();
      throw new Error("Request is too large.");
    }
    chunks.push(value);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
