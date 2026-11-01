# Work locally, publish through GitHub

The application is in this repository. Synced project files under the parent `sources/` folder are references and must remain unchanged.

```sh
npm ci
npm run dev:demo
```

Open http://localhost:3000. This explicitly starts the local demonstration, regardless of hosted settings. English/Tamil intake, routing, fictional officer queues, evidence and the resolution/appeal flow use this browser's local storage. Demo mode makes no OpenRouter requests and does not submit to Supabase or government agencies. Use illustrative reports only.

```sh
npm test
npm run typecheck
npm run build
npm run test:e2e
```

Database tests run the actual migration SQL in local embedded PostgreSQL with Supabase Auth/Storage stand-ins; no Docker, database password or hosted project is required. Provider tests use mocks. These tests do not prove that hosted Auth, AI or storage works.

GitHub holds application code and migrations. Supabase holds the live accounts, records and evidence. Publishing code does not apply a database migration. The routing upgrade adds two queues, server-side safety checks and stored explanations, so it requires a one-time hosted database upgrade before production activation.

For a hosted upgrade, inspect `supabase/routing_preflight.sql` and remote migration history first. If the initial schema is present and the upgrade absent, apply only `supabase/migrations/202611010002_verified_routing.sql`. If setup is partial or the upgrade exists, inspect actual definitions before making repairs. Never rerun the initial migration to resolve a conflict. The upgrade runs in one transaction and preserves existing complaints, evidence, roles and audit records; legacy complaints are not retrospectively reassigned.

New submission code checks `routing_version()` and fails closed with a clear message if the database is outdated. Keep the old production app active until the migration is inspected/applied and hosted tests pass. Provision fictional electricity/stormwater officers through an administrator after real Auth users exist; do not seed passwords or alter existing officers automatically.

Use provider settings or an ignored local configuration file for secrets. Never commit them or paste credentials into chat.
