# Deploy CivicLens on Vercel

## Access needed

- A valid GitHub login with write access to `VishnuPriyan77/Outliers` to push the code.
- A Vercel account permitted to import that repository.
- Access to your Supabase project's SQL Editor, Auth settings and API settings.
- Your OpenRouter key and chosen model ID.

Enter secrets directly in `.env.local` or Vercel → Project → Settings → Environment Variables. Do not paste them in chat, issue descriptions, logs or commits.

## Configure and deploy

1. Push the reviewed code, then import `VishnuPriyan77/Outliers` into Vercel. Select Next.js; the repository itself is the root directory. Use Node.js 24.x, `npm ci`, `npm run build`, and default Next.js output settings.
2. For a credentials-free preview, set `NEXT_PUBLIC_DEMO_MODE=true` and deploy. Data stays in each visitor's browser. No paid AI endpoint is exposed in demo mode.
3. For the persistent pilot, apply `supabase/migrations/202611010001_civiclens.sql` to your existing project. Review it first; no remote database changes have been made by this implementation.
4. Add all variables below for the intended Preview/Production environments. Set `NEXT_PUBLIC_DEMO_MODE=false` and **rebuild**, since public settings are embedded at build time.

| Variable                               | Visibility    | Purpose                                         |
| -------------------------------------- | ------------- | ----------------------------------------------- |
| `NEXT_PUBLIC_DEMO_MODE`                | Browser       | `false` enables persistent mode                 |
| `NEXT_PUBLIC_SUPABASE_URL`             | Browser       | Project API URL                                 |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Browser       | Publishable client key; RLS protects rows       |
| `SUPABASE_SERVICE_ROLE_KEY`            | Server secret | Finalizes server-checked evidence metadata only |
| `OPENROUTER_API_KEY`                   | Server secret | Authenticated model requests                    |
| `OPENROUTER_MODEL`                     | Server        | Available model with JSON output                |
| `NEXT_PUBLIC_APP_URL`                  | Browser       | Your deployment URL for setup/reference         |

5. Set Supabase Auth Site URL to the deployed HTTPS URL, add the same host to the allowed redirect URLs, and use email confirmation. Configure a mail provider if the hosted project's default email delivery limits are unsuitable.
6. Create a citizen user and separate fictional officer users. Provision the officers from `supabase/provision_officials.example.sql`. Use one account per department, including `review` for unknown ownership.
7. Run the smoke test below. Hosted activation requires these configuration steps; a successful local demo is not proof that remote Auth/Storage is configured.

## Hosted smoke test

- Sign up, confirm email and sign in as the citizen.
- Submit a Tamil or English road report, confirm Chennai and municipal ownership, and upload a small JPEG/PNG.
- Sign in separately as the roads demo officer. Verify that the report appears; water officers and unrelated citizens must not see it.
- Acknowledge, start work, upload resolution evidence and submit resolution.
- Citizen appeals; officer resumes work, uploads a **new** proof and submits resolution again.
- Verify a second appeal is unavailable and citizen closure succeeds.
- Download evidence while authorized; test that a signed link expires after a minute. Verify unrelated accounts cannot mint a link.
- Remove/disable the model configuration temporarily to confirm guided intake still works; restore it privately.

## Operational notes

Vercel functions use the Mumbai region. Choose your Supabase region and project quotas intentionally. Attachments use the server upload path and a 4 MB limit so they fit within Vercel's request size limits. Media is not publicly hosted. Unregistered objects can result from interrupted uploads; an administrator should review and remove old unattached objects, and configure monitoring, retention and backups before collecting real citizen data. No scheduled jobs, production government notifications or automatic SLA escalations are configured.

## Optional automatic checks

The current GitHub OAuth login allows repository writes but lacks the `workflow` scope. CI is provided as `docs/github-actions-ci.yml` rather than an active workflow so the app can be pushed with the existing access. To enable automatic checks, authorize that additional GitHub permission, move the file to `.github/workflows/ci.yml` and push it. All checks can be run locally with the commands in the README.
