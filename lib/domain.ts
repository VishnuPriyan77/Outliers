import { z } from "zod";
export const categories = [
  "road",
  "water",
  "waste",
  "lighting",
  "electricity",
  "stormwater",
  "other",
] as const;
export type Category = (typeof categories)[number];
export type Lang = "en" | "ta";
export const categoryNames: Record<Category, [string, string]> = {
  road: ["Road damage", "சாலை சேதம்"],
  water: ["Water & sewerage", "குடிநீர் & கழிவுநீர்"],
  waste: ["Waste & sanitation", "குப்பை & சுகாதாரம்"],
  lighting: ["Street lighting", "தெரு விளக்குகள்"],
  electricity: [
    "Electricity supply & power lines",
    "மின் விநியோகம் & மின் கம்பிகள்",
  ],
  stormwater: ["Stormwater drainage", "மழைநீர் வடிகால்"],
  other: ["Needs review", "பரிசீலனை தேவை"],
};
export const departments = {
  roads: "GCC · Roads",
  water: "CMWSSB · Water & Sewerage",
  waste: "GCC · Solid Waste",
  lighting: "GCC · Electrical",
  electricity: "TNPDCL · Electricity Distribution",
  stormwater: "GCC · Storm Water Drains",
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
  assetOwner: z.enum(["public", "private", "unknown"]).default("unknown"),
});
export type Draft = z.input<typeof draftSchema>;
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
  routing?: RoutingDecision;
  status: Status;
  created_at: string;
  due_at: string;
  appealed: boolean;
  evidence: Evidence[];
  events: AuditEvent[];
};
// Sources are versioned separately from any model response. No government submission occurs.
export const ROUTING_VERSION = "202611010002";
export const authorities = {
  roads: {
    parent: "Municipal Administration and Water Supply",
    source: "https://chennaicorporation.gov.in/gcc/department/road/",
    scope:
      "Citizen-reported municipal road; asset ownership needs verification.",
  },
  water: {
    parent: "Municipal Administration and Water Supply",
    source: "https://cmwssb.tn.gov.in/",
    scope: "CMWSSB water supply and sewerage; not stormwater drains.",
  },
  waste: {
    parent: "Municipal Administration and Water Supply",
    source:
      "https://chennaicorporation.gov.in/gcc/department/solid-waste-management/",
    scope: "GCC municipal solid waste collection.",
  },
  lighting: {
    parent: "Municipal Administration and Water Supply",
    source: "https://chennaicorporation.gov.in/gcc/department/electrical/",
    scope:
      "GCC streetlights and their electrical assets; not distribution lines.",
  },
  electricity: {
    parent: "Energy",
    source: "https://www.tnpdcl.org/en/tnpdcl/about-us/tnpdcl-profile/",
    scope:
      "TNPDCL distribution network. Local section/circle must verify the asset; private or transmission assets need triage.",
  },
  stormwater: {
    parent: "Municipal Administration and Water Supply",
    source: "https://chennaicorporation.gov.in/gcc/department/storm-water/",
    scope:
      "GCC stormwater drains; not CMWSSB sewers or Water Resources rivers.",
  },
  review: {
    parent: "CivicLens (simulation)",
    source: "https://www.tn.gov.in/document_dept_list.php?cate_name=YWxs",
    scope:
      "Human verification of category, ownership and competent authority required.",
  },
} as const;
export type Classification = {
  category: Category;
  confidence: "supported" | "uncertain";
  reason:
    | "electrical_hazard"
    | "single_service"
    | "multiple_services"
    | "insufficient_detail";
  evidence: string[];
  hazard: boolean;
};
// English, Tamil and common Tamil transliterations. Location words alone are never a road defect.
const electricity =
  /electric(?:al|ity)?|power\s*(?:line|cable|wire|supply|cut|outage)|live\s*wire|transformer|\b(?:tneb|tangedco|tnpdcl|eb)\b|மின்(?:சார|கம்பி| கம்பி| விநியோக|தடை)|மின்கம்ப|மின்சாரம்|மின்மாற்றி|min\s*kambi|current\s*(?:wire|kambi|cut)/iu;
const wire =
  /wire|cable|(?:power|transmission|electric)\s*line|கம்பி|கேபிள்|kambi/iu;
const damage =
  /cut|snapp|broken|fallen|\bdown\b|downed|dangl|hanging|exposed|spark|sever|leak|அறுந்த|துண்டி|வெட்ட|விழுந்|விழுந்த|தொங்க|வெளியே|தீப்பொறி|arunth|arundh/iu;
const lighting =
  /street\s*light|lamp\s*(?:post|not|broken)|தெரு\s*விளக்கு|தெருவிளக்கு/iu;
const terms: Record<Exclude<Category, "other" | "electricity">, RegExp> = {
  road: /pothole|road\s*(?:is\s*)?(?:damage|broken|crack|collapsed)|damaged\s*road|bridge\s*(?:damage|broken|collapse)|சாலை.{0,20}(?:குழி|சேத|உடை)|பாலம்.{0,20}(?:சேத|உடை)/iu,
  water:
    /sewag|sewer|drinking\s*water|water\s*(?:supply|leak|pipe)|pipe\s*(?:burst|broken|leak)|குடிநீர்|கழிவுநீர்|தண்ணீர்|குழாய்/iu,
  waste: /garbage|rubbish|trash|waste|குப்பை/iu,
  lighting,
  stormwater: /storm\s*water|rain\s*water\s*drain|மழைநீர்\s*வடிகால்/iu,
};
const excludedAsset =
  /\b(?:transmission|high[ -]voltage|telecom|broadband|internet|fibre|fiber|private wiring|internal wiring|inside (?:house|home|flat))\b|தொலைத்தொடர்பு|உயர்\s*அழுத்த|தனியார்\s*மின்/iu;
export function analyze(text: string): Classification {
  text = text.normalize("NFC");
  const electrical = electricity.test(text);
  // A streetlight cable explicitly belongs to GCC's electrical assets. An unspecified
  // cut cable remains uncertain but still displays precautionary hazard guidance.
  const lightCable =
    /street\s*light.{0,12}(?:cable|wire)|(?:cable|wire).{0,12}(?:street\s*light)|தெரு\s*விளக்.{0,15}(?:கம்பி|கேபிள்)/iu.test(
      text,
    ) &&
    wire.test(text) &&
    !/power\s*line|distribution|transformer|மின்\s*விநியோக/iu.test(text);
  const hazard =
    (wire.test(text) && damage.test(text)) ||
    /electrocut|live\s*wire|மின்சாரம் தாக்க|மின்.{0,20}தீப்பொறி/iu.test(text);
  const uncertain =
    /\b(?:not sure|unsure|maybe|hypothetical|what if|no (?:cut|fallen|live|broken)|not (?:cut|broken|damaged)|transmission|high[ -]voltage|telecom|broadband|internet|fibre|fiber)\b|தெரியவில்லை|உறுதியாக|தொலைத்தொடர்பு|உயர்\s*அழுத்த|அறுந்து?\s*இல்லை/iu.test(
      text,
    );
  if (uncertain || excludedAsset.test(text))
    return {
      category: "other",
      confidence: "uncertain",
      reason: "insufficient_detail",
      evidence: [],
      hazard,
    };
  if (electrical && hazard && !lightCable)
    return {
      category: "electricity",
      confidence: "supported",
      reason: "electrical_hazard",
      evidence: [
        text.match(electricity)![0],
        ...(text.match(damage) || []).slice(0, 1),
      ],
      hazard: true,
    };
  const matches = (Object.keys(terms) as (keyof typeof terms)[]).filter((c) =>
    terms[c].test(text),
  );
  const found: Category[] = [...matches];
  if (electrical && !lightCable && !lighting.test(text))
    found.push("electricity");
  // Generic water/pipe descriptions alongside a stormwater drain need clarification.
  const category =
    found.length === 1 && !(hazard && !electrical && !lightCable)
      ? found[0]
      : "other";
  return {
    category,
    confidence: category === "other" ? "uncertain" : "supported",
    reason:
      found.length > 1
        ? "multiple_services"
        : category === "other"
          ? "insufficient_detail"
          : "single_service",
    evidence:
      category === "other"
        ? []
        : [
            category === "electricity"
              ? text.match(electricity)![0]
              : text.match(terms[category])![0],
          ],
    hazard,
  };
}
export function classify(text: string): Category {
  return analyze(text).category;
}
export function urgentSignal(text: string) {
  return (
    analyze(text).hazard ||
    /electrocut|fire|injur|immediate danger|மின்சாரம் தாக்க|தீ விபத்து|காயம்/iu.test(
      text,
    )
  );
}
export type RoutingInput = Pick<Draft, "category" | "chennai" | "ownership"> &
  Partial<Pick<Draft, "description" | "impact" | "assetOwner" | "urgent">>;
export type RoutingDecision = {
  version: string;
  department: Department;
  reason: string;
  reasonTa: string;
  severity: "hazard" | "priority" | "routine";
  humanReview: boolean;
  source: string;
  parent: string;
};
export function explainRoute(d: RoutingInput): RoutingDecision {
  const signal = analyze([d.description, d.impact].filter(Boolean).join(" "));
  let department: Department = "review";
  let reason = "Category or asset ownership needs human verification.";
  let reasonTa = "வகை அல்லது சொத்தின் பொறுப்பை மனிதர் சரிபார்க்க வேண்டும்.";
  if (!d.chennai) {
    reason = "Outside the Chennai pilot; local authority must be verified.";
    reasonTa =
      "சென்னை சோதனை எல்லைக்கு வெளியே; உள்ளூர் அதிகாரியைச் சரிபார்க்க வேண்டும்.";
  } else if (d.assetOwner === "private") {
    reason = "Private asset: public agency ownership cannot be assumed.";
    reasonTa =
      "தனியார் சொத்து: அரசு நிறுவனத்தின் பொறுப்பு என்று கருத முடியாது.";
  } else if (
    excludedAsset.test([d.description, d.impact].filter(Boolean).join(" "))
  ) {
    reason =
      "Asset type is outside the verified service directory; human ownership verification required.";
    reasonTa =
      "இந்தச் சொத்து சரிபார்க்கப்பட்ட சேவை அடைவுக்கு வெளியே உள்ளது; பொறுப்பை மனிதர் சரிபார்க்க வேண்டும்.";
  } else if (
    signal.hazard &&
    signal.category !== d.category &&
    d.category !== "other"
  ) {
    reason =
      "Safety signal conflicts with the chosen category. Confirm the electrical asset or request human triage.";
    reasonTa =
      "ஆபத்து அறிகுறியும் தேர்ந்தெடுத்த வகையும் முரண்படுகின்றன. மின் சொத்தை உறுதிசெய்யவும் அல்லது மனிதப் பரிசீலனை கோரவும்.";
  } else if (
    d.category !== "other" &&
    !(d.category === "road" && d.ownership !== "municipal")
  ) {
    department = (
      {
        road: "roads",
        water: "water",
        waste: "waste",
        lighting: "lighting",
        electricity: "electricity",
        stormwater: "stormwater",
      } as const
    )[d.category];
    reason = authorities[department].scope;
    reasonTa =
      "உறுதிசெய்த சேவை வகை மற்றும் சென்னை இடத்தின் அடிப்படையில். உள்ளூர் சொத்தின் பொறுப்பை அதிகாரி சரிபார்க்க வேண்டும்.";
  }
  return {
    version: ROUTING_VERSION,
    department,
    reason,
    reasonTa,
    severity: signal.hazard
      ? "hazard"
      : d.urgent ||
          urgentSignal([d.description, d.impact].filter(Boolean).join(" "))
        ? "priority"
        : "routine",
    humanReview: department === "review",
    source: authorities[department].source,
    parent: authorities[department].parent,
  };
}
export function route(d: RoutingInput): Department {
  return explainRoute(d).department;
}
export const electricalSafety = {
  en: "Possible electrical hazard: keep away; do not touch or approach the wire, water or nearby objects. Do not approach to collect evidence. Contact TNPDCL Minnagam directly: 94987 94987. CivicLens does not alert emergency responders or government agencies.",
  ta: "மின் ஆபத்து இருக்கலாம்: விலகி இருங்கள்; கம்பி, அருகிலுள்ள நீர் அல்லது பொருட்களைத் தொடவோ நெருங்கவோ வேண்டாம். ஆதாரம் சேகரிக்க அருகில் செல்ல வேண்டாம். TNPDCL மின்னகத்தை நேரடியாக அழைக்கவும்: 94987 94987. CivicLens அவசர உதவியையோ அரசு நிறுவனத்தையோ தொடர்புகொள்ளாது.",
};
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
  d = draftSchema.parse(d);
  const routing = explainRoute(d);
  d = { ...d, urgent: d.urgent || routing.severity !== "routine" };
  const id = crypto.randomUUID(),
    now = new Date();
  return {
    ...d,
    id,
    reference: `CL-${now.getFullYear()}-${id.slice(0, 8).toUpperCase()}`,
    department: routing.department,
    routing,
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
