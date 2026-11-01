import {
  Complaint,
  Draft,
  Evidence,
  Department,
  Status,
  newComplaint,
  transition,
  validateFile,
} from "./domain";
import { demoMode, supabase } from "./supabase";
const KEY = "civiclens-demo-v1";
export const demoOfficers: Record<Department, string> = {
  roads: "Arun · Demo Roads Officer",
  water: "Meena · Demo Water Officer",
  waste: "Kavya · Demo Sanitation Officer",
  lighting: "Rahul · Demo Electrical Officer",
  review: "Priya · Demo Triage Officer",
};
export function loadDemo(): Complaint[] {
  const raw = localStorage.getItem(KEY);
  if (raw) return JSON.parse(raw);
  const base = {
    language: "en" as const,
    chennai: true,
    ownership: "municipal" as const,
    consent: true as const,
    urgent: false,
    duration: "Two weeks",
    impact: "Residents have difficulty using this street.",
  };
  const a = newComplaint({
    ...base,
    description: "A large pothole is affecting traffic near the bus stop.",
    category: "road",
    location: "Velachery Main Road, Chennai",
  });
  const b = newComplaint({
    ...base,
    description: "Garbage has not been collected near the market.",
    category: "waste",
    location: "Pondy Bazaar, T. Nagar, Chennai",
  });
  const c = newComplaint({
    ...base,
    description: "Street light is not working near the park entrance.",
    category: "lighting",
    location: "Anna Nagar Tower Park, Chennai",
  });
  const examples = [
    a,
    {
      ...b,
      status: "in_progress" as const,
      events: [
        ...b.events,
        {
          id: crypto.randomUUID(),
          action: "in_progress",
          actor: "simulated officer",
          note: "Illustrative update: sanitation team assigned.",
          created_at: b.created_at,
        },
      ],
    },
    c,
  ];
  saveDemo(examples);
  return examples;
}
export function saveDemo(c: Complaint[]) {
  localStorage.setItem(KEY, JSON.stringify(c));
}
function db() {
  if (!supabase) throw new Error("Configure Supabase to use connected mode.");
  return supabase;
}
async function headers() {
  const { data } = await db().auth.getSession();
  return { Authorization: `Bearer ${data.session?.access_token || ""}` };
}
export async function listComplaints(): Promise<Complaint[]> {
  if (demoMode) return loadDemo();
  const { data, error } = await db()
    .from("complaints")
    .select("*, evidence(*), events(*)")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data || []).map((row) => ({
    ...row.draft,
    ...row,
    events: row.events.sort(
      (a: { created_at: string }, b: { created_at: string }) =>
        a.created_at.localeCompare(b.created_at),
    ),
  }));
}
export async function submit(d: Draft): Promise<Complaint> {
  if (demoMode) {
    const c = newComplaint(d);
    saveDemo([c, ...loadDemo()]);
    return c;
  }
  const { data, error } = await db().rpc("submit_complaint", { p_draft: d });
  if (error) throw new Error(error.message);
  const cases = await listComplaints();
  const c = cases.find((c) => c.id === data);
  if (!c)
    throw new Error(
      "Submitted successfully. Refresh your dashboard to view it.",
    );
  return c;
}
export async function updateStatus(
  c: Complaint,
  status: Status,
  role: "citizen" | "officer",
  note: string,
) {
  if (demoMode) {
    const next = transition(c, status, role, note);
    saveDemo(loadDemo().map((v) => (v.id === c.id ? next : v)));
    return;
  }
  const { error } = await db().rpc("transition_complaint", {
    p_id: c.id,
    p_status: status,
    p_note: note,
  });
  if (error) throw new Error(error.message);
}
export async function reassign(
  c: Complaint,
  department: Department,
  note: string,
) {
  if (note.trim().length < 5)
    throw new Error("Add an assignment reason of at least five characters.");
  if (demoMode) {
    const next = {
      ...c,
      department,
      events: [
        ...c.events,
        {
          id: crypto.randomUUID(),
          action: "reassigned",
          actor: "simulated officer",
          note: `${c.department} → ${department}: ${note}`,
          created_at: new Date().toISOString(),
        },
      ],
    };
    saveDemo(loadDemo().map((v) => (v.id === c.id ? next : v)));
    return;
  }
  const { error } = await db().rpc("reassign_complaint", {
    p_id: c.id,
    p_department: department,
    p_note: note,
  });
  if (error) throw new Error(error.message);
}
async function blobStore() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open("civiclens-evidence", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("files");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(new Error("Browser storage unavailable."));
  });
}
async function storeBlob(id: string, file: File) {
  const db = await blobStore();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction("files", "readwrite");
    tx.objectStore("files").put(file, id);
    tx.oncomplete = () => resolve();
    tx.onerror = () =>
      reject(
        new Error("File could not be saved. Browser storage may be full."),
      );
  });
  db.close();
}
export async function evidenceUrl(e: Evidence) {
  if (!demoMode) {
    const { data, error } = await db()
      .storage.from("evidence")
      .createSignedUrl(e.path!, 60);
    if (error) throw new Error(error.message);
    return data.signedUrl;
  }
  const database = await blobStore();
  const blob = await new Promise<Blob>((resolve, reject) => {
    const req = database.transaction("files").objectStore("files").get(e.id);
    req.onsuccess = () =>
      req.result
        ? resolve(req.result)
        : reject(new Error("This local attachment is no longer available."));
    req.onerror = () => reject(new Error("Could not open attachment."));
  });
  database.close();
  return URL.createObjectURL(blob);
}
export async function uploadEvidence(
  c: Complaint,
  file: File,
  purpose: Evidence["purpose"],
) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const mime = validateFile(bytes, file.size);
  if (demoMode) {
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    const sha256 = Array.from(new Uint8Array(digest))
      .map((x) => x.toString(16).padStart(2, "0"))
      .join("");
    const latest = loadDemo().find((v) => v.id === c.id)!;
    if (latest.evidence.length >= 10)
      throw new Error("Ten attachments maximum per complaint.");
    const e: Evidence = {
      id: crypto.randomUUID(),
      name: file.name,
      mime,
      size: file.size,
      sha256,
      purpose,
      created_at: new Date().toISOString(),
      duplicate: latest.evidence.some((e) => e.sha256 === sha256),
    };
    await storeBlob(e.id, file);
    saveDemo(
      loadDemo().map((v) =>
        v.id === c.id
          ? {
              ...v,
              evidence: [...v.evidence, e],
              events: [
                ...v.events,
                {
                  id: crypto.randomUUID(),
                  actor: purpose === "report" ? "citizen" : "simulated officer",
                  action: "evidence_added",
                  note: `${purpose} evidence received; SHA-256 recorded. Authenticity unverified.`,
                  created_at: e.created_at,
                },
              ],
            }
          : v,
      ),
    );
    return;
  }
  const form = new FormData();
  form.set("file", file);
  form.set("complaintId", c.id);
  form.set("purpose", purpose);
  const response = await fetch("/api/evidence", {
    method: "POST",
    headers: await headers(),
    body: form,
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Upload failed.");
}
export async function interview(description: string, language: "en" | "ta") {
  const res = await fetch("/api/interview", {
    method: "POST",
    headers: { ...(await headers()), "Content-Type": "application/json" },
    body: JSON.stringify({ description, language }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error);
  return data;
}
