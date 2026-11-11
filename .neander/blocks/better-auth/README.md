# Better Auth + Drizzle, version 1

Requires the Drizzle block. Add `pnpm add better-auth@1.7.3 @better-auth/drizzle-adapter@1.7.3`; `pnpm add -D auth@1.7.3`. Copy `.example` files to their shown paths without the suffix, merging existing modules. The pinned `auth` development dependency is the schema generator; do not hand-author Better Auth tables.

Supply local `BETTER_AUTH_SECRET` (a new 32-byte random secret), `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in gitignored `.env.local`. Local origin defaults to `http://localhost:3000`; production requires `BETTER_AUTH_URL`. Append these environment requirements for service `web`: `BETTER_AUTH_URL` uses `source: provisioned, provider: Neander, binding: public_origin`; `BETTER_AUTH_SECRET` uses `source: generated, provider: null, generator: opaque-random`; both Google variables use `source: user, provider: null`. All are required. Retain the existing Neon `DATABASE_URL` and migration profile.

## Generate the schema and migration

After copying `.neander/auth-schema-config.ts.example` to `.neander/auth-schema-config.ts`, generate the ORM schema from the installed Better Auth version:

```sh
pnpm exec auth generate \
  --config .neander/auth-schema-config.ts \
  --output server/auth-schema.ts \
  --yes
```

Append `export * from "./auth-schema"` to `server/schema.ts`, then have Drizzle generate the versioned SQL migration:

```sh
pnpm exec drizzle-kit generate
```

Inspect the generated schema and SQL, then commit `server/auth-schema.ts`, the `drizzle/` migration and history, the auth configuration, and all lockfile changes together. Apply it to the isolated development database with:

```sh
node --env-file=.env.local .neander/migrate.mjs
```

Do not use `auth migrate` with this block: Better Auth generates the Drizzle schema, while Drizzle owns migration generation and history. Production applies that committed history through Neander's isolated `nextjs-drizzle` migration step, never during the image build or application startup. Rerun both generation commands whenever Better Auth options or plugins change the required schema.

Register `<planned origin>/api/auth/callback/google` with Google. In a client component call `authClient.signIn.social({ provider: "google", callbackURL: "/" })`; use `authClient.useSession()` and `authClient.signOut()`. `/api/me` demonstrates an authoritative server session check. For private application records, apply the same check to every read/write and scope database queries by `session.user.id`; do not assume installing auth protects the public todo demonstration automatically. Account auto-linking is disabled.

Verify production build needs no credentials, anonymous `/api/me` returns 401, untrusted-origin sign-in/sign-out is rejected, OAuth state/callback succeeds with the configured provider, and the session survives an app restart using the same database/secret. Live Google callback verification requires actual provider credentials and registration; isolated tests cannot certify it. Sources: [Next integration](https://better-auth.com/docs/integrations/next), [Drizzle adapter/schema generation](https://better-auth.com/docs/adapters/drizzle).

After the generated migration has been applied, use a disposable development database and run `node --env-file=.env.local .neander/check-auth.mjs <local-origin>`. This checks anonymous/tampered cookies, a seeded persisted session, CSRF and logout through HTTP, then removes its test user. It does not generate or apply schemas. This deliberately bypasses Google in the test fixture, not in application code. OAuth access/refresh tokens are encrypted by Better Auth at rest.

## Maintained deployment recipe

This block includes `.neander/compose.yaml.example`, a complete recipe including its database prerequisites. Merge its `x-neander` declarations into the project's `.neander/compose.yaml` as you install the block; do not replace existing services, probes or application-specific requirements. Every environment entry includes `service`, `name`, `required`, `source` and `provider`. The `provider: null` field is mandatory for generated and user-supplied values. Keep the matching migration profile and commit its source files and lockfile in the same change.

Read `docs/deployment-contract.md` before changing database or authentication setup. The example is for this block's Google OAuth flow; an email/password-only app must declare only the credentials its implementation actually uses. Keep the public health endpoint accessible when protecting application pages. A valid recipe goes directly to Cloud Run Compose; adding an add-on must not depend on a recipe agent to reconstruct this metadata at Publish time.
