# Architecture

```mermaid
flowchart LR
    Citizen[Citizen: English / Tamil] --> UI[Next.js client]
    Officer[Fictional department officer] --> UI
    UI --> Auth[Supabase Auth]
    UI --> RPC[Postgres workflow functions + RLS]
    UI --> Intake[Authenticated intake route]
    Intake --> Quota[Persistent daily quota]
    Intake --> OpenRouter[OpenRouter JSON suggestion]
    OpenRouter --> Review[Citizen confirms editable fields]
    Review --> RPC
    UI --> Upload[Bounded evidence route]
    Upload --> Storage[Private Supabase Storage]
    Upload --> Finalize[Server-only metadata finalization]
    Finalize --> RPC
    RPC --> Events[Append-only action history]
```

The client uses a Supabase publishable key. Postgres RLS permits citizens to read their own cases and officers to read cases assigned to their department. Officer roles are administratively provisioned and cannot be created or changed by client accounts. Client table writes are revoked. `submit_complaint`, `transition_complaint` and `reassign_complaint` implement constrained state changes and write events in the same transaction. Status and appeal transitions lock the complaint row to prevent race conditions.

AI is advisory. Model output is validated against a fixed enum; unsupported fields cannot become routing instructions. The citizen confirms the category and address. Both TypeScript and Postgres independently map categories to the simulated directory. Road ownership uncertainty, non-Chennai reports and ambiguous categories go to triage. A review officer can forward with a recorded reason. This is deterministic routing under reported inputs, not a guarantee of real-world jurisdiction correctness.

The intake route validates the bearer token using Supabase Auth and enforces a 30-request daily account quota before calling OpenRouter. Demo mode never calls the paid endpoint. Missing configuration, failed responses and invalid model JSON all fall back to guided intake. No API key is sent to the browser.

The evidence route bounds bytes before multipart parsing, validates basic file signatures, calculates SHA-256, uploads unchanged bytes with the user's access rights, then finalizes metadata with a server-only service key. Only the service role may call `attach_evidence`; it validates the actor, complaint, workflow state, object path and attachment limit. Normal users cannot forge checked metadata by invoking the RPC directly. Client writes cannot overwrite or delete registered evidence. File access uses RLS and short-lived signed URLs. Exact duplicate detection is scoped to the same case to avoid revealing another citizen's submissions. Severity may transmit one metadata-stripped report image to OpenRouter only with explicit, separate citizen consent and a configured vision model. See [severity engine](SEVERITY.md).

The browser-only demo uses localStorage for case metadata and IndexedDB for attachments. It is intentionally a single-browser simulation and has no role security boundary. Connected mode never silently falls back to demo storage if Supabase configuration is absent.

New reports have no response-day targets; historical `due_at` values are retained only for storage compatibility and are not shown. Priority and severity reasoning replace target dates. Severity uses a durable RLS-protected assessment row and an authenticated asynchronous route, with an optional secret-protected recovery scheduler. Urgency signals and the review UI advise citizens to contact emergency services directly for immediate danger.

Evidence relevance/authenticity, verified asset ownership, officer team hierarchy, public aggregate analytics, notification delivery and automatic escalation remain future extensions. Current public-facing screens reveal no other citizens' data.
