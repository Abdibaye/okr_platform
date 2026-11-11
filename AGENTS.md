# Project setup

Read `README.md` for runtime versions and existing development/check/build commands.
The bare starter needs no database, credentials or external services.
When persistence is requested, follow `.neander/blocks/drizzle/README.md` for dependencies, local PostgreSQL setup, migrations and CRUD/restart verification.
Copy the development Compose example to the root only when installing that block; preserve existing files and database data.
Keep local credentials in gitignored `.env.local`. Production uses the separate managed Neon recipe contract.
Report local database checks separately from managed Neon and production deployment proof.

When adding database/auth capabilities, merge the block's complete `.neander/compose.yaml.example` in the same change. Read `docs/deployment-contract.md`; preserve the static-valid recipe fast path. Include explicit `provider: null` for user/generated requirements. Keep the public health endpoint available. Do not invent a Neon-hostname guard for a generic PostgreSQL block or weaken existing application-specific restrictions. Always scope local Docker Compose with an explicit unique `-p` and `-f`.

When installing Better Auth, use the pinned `auth` CLI to generate `server/auth-schema.ts`; do not hand-author its tables. Export that schema from `server/schema.ts`, then use Drizzle Kit to generate and commit the SQL migration. Do not use `auth migrate` with the Drizzle adapter. Apply the committed migration before running `.neander/check-auth.mjs`; that script verifies runtime behavior only.
