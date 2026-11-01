import { z } from "zod";
export const categories = [
  "road",
  "water",
  "waste",
  "lighting",
  "other",
] as const;
export type Category = (typeof categories)[number];
export type Lang = "en" | "ta";
export const categoryNames: Record<Category, [string, string]> = {
  road: ["Road damage", "சாலை சேதம்"],
  water: ["Water & sewerage", "குடிநீர் & கழிவுநீர்"],
  waste: ["Waste & sanitation", "குப்பை & சுகாதாரம்"],
  lighting: ["Street lighting", "தெரு விளக்குகள்"],
  other: ["Needs review", "பரிசீலனை தேவை"],
};
export const departments = {
  roads: "GCC · Roads",
  water: "CMWSSB · Water & Sewerage",
  waste: "GCC · Solid Waste",
  lighting: "GCC · Electrical",
  review: "CivicLens · Triage Desk",
} as const;
export type Department = keyof typeof departments;
export type Status =
  | "submitted"
  | "acknowledged"
  | "in_progress"
  | "resolved"
  | "closed"
  | "appealed";
export const statusNames: Record<Status, [string, string]> = {
  submitted: ["Submitted", "சமர்ப்பிக்கப்பட்டது"],
  acknowledged: ["Acknowledged", "ஏற்கப்பட்டது"],
  in_progress: ["In progress", "பணி நடைபெறுகிறது"],
  resolved: ["Awaiting your verification", "உங்கள் சரிபார்ப்பு தேவை"],
  closed: ["Closed", "முடிக்கப்பட்டது"],
  appealed: ["Appeal under review", "மேல்முறையீடு பரிசீலனையில்"],
};
export const draftSchema = z.object({
  description: z.string().trim().min(10).max(3000),
  location: z.string().trim().min(5).max(500),
  duration: z.string().trim().min(1).max(200),
  impact: z.string().trim().min(3).max(1000),
  category: z.enum(categories),
  language: z.enum(["en", "ta"]),
  chennai: z.boolean(),
  ownership: z.enum(["municipal", "unknown"]),
  urgent: z.boolean(),
  consent: z.literal(true),
});
export type Draft = z.infer<typeof draftSchema>;
export type Evidence = {
  id: string;
  name: string;
  mime: string;
  size: number;
  sha256: string;
  path?: string;
  purpose: "report" | "resolution";
  created_at: string;
  duplicate?: boolean;
};
export type AuditEvent = {
  actor_id?: string;
  id: string;
  action: string;
  note: string;
  actor: string;
  created_at: string;
};
export type Complaint = Draft & {
  citizen_id?: string;
  id: string;
  reference: string;
  department: Department;
  status: Status;
  created_at: string;
  due_at: string;
  appealed: boolean;
  evidence: Evidence[];
  events: AuditEvent[];
};
export function route(
  d: Pick<Draft, "category" | "chennai" | "ownership">,
): Department {
  if (
    !d.chennai ||
    d.category === "other" ||
    (d.category === "road" && d.ownership !== "municipal")
  )
    return "review";
  return (
    {
      road: "roads",
      water: "water",
      waste: "waste",
      lighting: "lighting",
    } as const
  )[d.category];
}
const terms: Record<Exclude<Category, "other">, RegExp> = {
  road: /pothole|road|bridge|சாலை|குழி|பாலம்/iu,
  water: /water|sewag|drain|pipe|குடிநீர்|கழிவுநீர்|குழாய்|தண்ணீர்/iu,
  waste: /garbage|rubbish|trash|waste|குப்பை/iu,
  lighting: /street\s*light|lamp|தெரு\s*விளக்கு/iu,
};
export function classify(text: string): Category {
  const matches = (Object.keys(terms) as Exclude<Category, "other">[]).filter(
    (c) => terms[c].test(text),
  );
  return matches.length === 1 ? matches[0] : "other";
}
export function urgentSignal(text: string) {
  return /electrocut|live wire|fire|injur|immediate danger|மின்சாரம் தாக்க|தீ விபத்து|காயம்/iu.test(
    text,
  );
}
export function allowedActions(
  c: Complaint,
  role: "citizen" | "officer",
): Status[] {
  if (role === "citizen")
    return c.status === "resolved"
      ? ["closed", ...(!c.appealed ? ["appealed" as Status] : [])]
      : [];
  return (
    {
      submitted: ["acknowledged"],
      acknowledged: ["in_progress"],
      in_progress: ["resolved"],
      appealed: ["in_progress"],
      resolved: [],
      closed: [],
    } as Record<Status, Status[]>
  )[c.status];
}
export function transition(
  c: Complaint,
  next: Status,
  role: "citizen" | "officer",
  note: string,
): Complaint {
  if (!allowedActions(c, role).includes(next))
    throw new Error("This status change is not permitted.");
  if (note.trim().length < 5)
    throw new Error("Please add an update of at least five characters.");
  if (
    next === "resolved" &&
    !c.evidence.some(
      (e) =>
        e.purpose === "resolution" &&
        e.created_at >=
          ([...c.events].reverse().find((e) => e.action === "in_progress")
            ?.created_at || ""),
    )
  )
    throw new Error(
      "Upload fresh resolution evidence after starting the work.",
    );
  return {
    ...c,
    status: next,
    appealed: c.appealed || next === "appealed",
    events: [
      ...c.events,
      {
        id: crypto.randomUUID(),
        action: next,
        note: note.trim(),
        actor: role,
        created_at: new Date().toISOString(),
      },
    ],
  };
}
export function newComplaint(d: Draft): Complaint {
  draftSchema.parse(d);
  const id = crypto.randomUUID(),
    now = new Date();
  return {
    ...d,
    id,
    reference: `CL-${now.getFullYear()}-${id.slice(0, 8).toUpperCase()}`,
    department: route(d),
    status: "submitted",
    created_at: now.toISOString(),
    due_at: new Date(
      now.getTime() + (d.urgent ? 1 : 21) * 86400000,
    ).toISOString(),
    appealed: false,
    evidence: [],
    events: [
      {
        id: crypto.randomUUID(),
        action: "submitted",
        actor: "citizen",
        note: "Citizen confirmed report. Routed through the simulated directory.",
        created_at: now.toISOString(),
      },
    ],
  };
}
export const MAX_FILE = 4 * 1024 * 1024;
export function detectMime(bytes: Uint8Array): string | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return "image/jpeg";
  if ([137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => bytes[i] === v))
    return "image/png";
  const s = new TextDecoder("ascii").decode(bytes.slice(0, 16));
  if (s.startsWith("RIFF") && s.slice(8, 12) === "WEBP") return "image/webp";
  if (s.startsWith("RIFF") && s.slice(8, 12) === "WAVE") return "audio/wav";
  if (s.startsWith("ID3") || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0))
    return "audio/mpeg";
  if (s.slice(4, 8) === "ftyp" && /isom|mp4|avc|M4V/.test(s.slice(8)))
    return "video/mp4";
  return null;
}
export function validateFile(bytes: Uint8Array, size: number) {
  if (size === 0 || size > MAX_FILE)
    throw new Error("Choose a nonempty file up to 4 MB.");
  const mime = detectMime(bytes);
  if (!mime)
    throw new Error(
      "Supported files: JPEG, PNG, WebP, MP3, WAV and MP4. File contents must match a supported format.",
    );
  return mime;
}
