# CivicLens

A Chennai civic grievance MVP: bilingual conversational intake → citizen-confirmed classification → deterministic simulated department routing → private evidence → officer actions → citizen verification or one appeal. Built with Next.js, React, TypeScript, OpenRouter and Supabase.

**Government integration is simulated.** Department names are illustrative routing destinations and all officer identities are fictional. No reports, SMS or emails are sent to government agencies. No claim of perfect classification or media authenticity is made.

## Run immediately

Use Node.js 24 LTS.

```sh
npm ci
cp .env.example .env.local
npm run dev
```

Open http://localhost:3000. Demo mode works without credentials: three illustrative reports, browser-only persistence, private-to-this-browser evidence stored in IndexedDB, and a switchable fictional officer workspace. Demo data is shared by people using the same browser profile; do not use it for sensitive reports. Clearing site data resets the demo. The OpenRouter server endpoint is disabled in demo mode to prevent anonymous spending.

## Enable Supabase and OpenRouter

1. In your Supabase project's SQL Editor, run `supabase/migrations/202611010001_civiclens.sql` once. It creates the tables, RLS policies, private evidence bucket, transactional workflow functions and daily AI quota. For CLI-managed projects use `supabase link --project-ref YOUR_REF` followed by `supabase db push` after reviewing the migration.
2. Apply `supabase/migrations/202611010002_severity.sql` after the initial migration. This adds the severity queue/results without changing existing RLS or lifecycle behavior.
3. Privately fill `.env.local` using `.env.example`. Set `NEXT_PUBLIC_DEMO_MODE=false`, the project URL and publishable key. Add the **server-only** service-role key to finalize checked evidence metadata. Never prefix secret keys with `NEXT_PUBLIC_` or commit them.
4. Add `OPENROUTER_API_KEY` and an available `OPENROUTER_MODEL` supporting JSON output. The app makes server-side Chat Completions requests only to OpenRouter. If the key, model or provider is unavailable, deterministic guided intake still works. No Gemini dependency is assumed. Each account is limited to 30 AI requests per day in Postgres.
5. Restart the app. Create citizen accounts in the UI and confirm their emails. Configure the Supabase Auth Site URL and redirect allowlist for your actual host. Standard email/password Supabase sessions are used; server endpoints validate the bearer token with `auth.getUser`.
6. Create separate fictional officer users with Supabase Auth (or the signup screen), then provision them from the SQL Editor using `supabase/provision_officials.example.sql`. Users cannot assign their own officer roles. There are no hardcoded passwords or public privileged seed accounts.

## Vercel deployment

See [deployment instructions](docs/DEPLOYMENT.md). `vercel.json` selects the Next.js build and Mumbai function region. The ready-to-enable GitHub Actions template at `docs/github-actions-ci.yml` runs type checking, database/domain/API tests, production build and desktop/mobile browser tests. To activate it, grant your GitHub login the `workflow` scope and move it to `.github/workflows/ci.yml`. Deploy with demo mode first or configure Supabase before enabling connected mode. This repository does not contain a live deployment or applied remote migrations until those steps are performed.

## What works

- Responsive English/Tamil UI and four-step intake; one question at a time. OpenRouter proposes an enum-validated category, urgency and follow-up. The citizen can edit every report field before confirming.
- Categories: road damage, water/sewerage, waste, street lighting, and human triage. Unknown ownership, unsupported jurisdiction and uncertain categories route to the review desk. Departments are selected by fixed TypeScript **and SQL** rules, never arbitrary model strings.
- Citizen-provided Chennai address and ownership declaration. Exact jurisdiction and road ownership remain unverified; no geocoding or verified government directory is implied.
- Permanent UUID, readable tracking reference and append-only event records. Advisory severity assessment shows six weighted factors, reasoning and confidence, with a separate emergency override. No response-day promises. See [severity engine](docs/SEVERITY.md).
- Department-scoped officer queue, acknowledgement, work assignment, forwarding with a reason, resolution proof and citizen closure. After an appeal, fresh resolution evidence is required. One appeal is enforced transactionally with a row lock.
- Private JPEG/PNG/WebP/MP3/WAV/MP4 intake, maximum 4 MB per file and ten attachments per case. Server-side file signature checks, SHA-256 and exact duplicate checks within the case. The 4 MB limit fits Vercel's function request payload ceiling. Original file bytes are preserved. A signature check is **not a full media decode, malware scan or authenticity assessment**.
- Private evidence downloads via one-minute signed URLs. Report JSON download and print/save-as-PDF via the browser, including history.

## Verification

```sh
npm run typecheck
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

Database tests execute the migration in embedded PostgreSQL (PGlite) with Supabase Auth/Storage schema stand-ins. They exercise actual RLS and functions: cross-citizen/department isolation, no self-promotion, immutable events, storage access, server-only evidence finalization, status ordering, proof, one appeal and quotas. This does not replace a smoke test against your hosted Supabase project. Browser tests exercise the full demo journey and Tamil intake on desktop and phone widths. API tests mock OpenRouter; no paid calls occur during tests.

## Limits of this MVP

Independent media verification, provenance/C2PA, manipulation detection, transcription, video analysis, automatic SLA escalation, email/SMS notifications, officer-to-field-team subaccounts, maps and real agency integrations are not implemented. Evidence is explicitly marked **authenticity unverified / manual review**. Status history is append-only for application accounts, not tamper-proof against the database administrator. The officer queue and citizen workspace are private; there is no public feed exposing addresses or attachments. Local Supabase CLI/Docker and a deployed Supabase smoke test are optional follow-up checks once access is configured.

See [architecture and trust boundaries](docs/ARCHITECTURE.md) and [a four-minute demo](docs/DEMO.md).

## Primary references

- [OpenRouter API reference](https://openrouter.ai/docs/api/reference/overview)
- [Supabase Storage access control](https://supabase.com/docs/guides/storage/security/access-control)
- [Supabase JavaScript Auth](https://supabase.com/docs/reference/javascript/auth-getuser)
