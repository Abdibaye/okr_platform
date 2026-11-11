# Incremental building blocks

The base starter require no database, typed API framework or authentication. Add these to ordinary project files only when the user requests the capability. Keep the base startup and health route working without external credentials; publish an added capability only after its migration and smoke test pass.

| Capability | Building block |
| --- | --- |
| Postgres | [Drizzle](.neander/blocks/drizzle/README.md) |
| Typed API | [tRPC](.neander/blocks/trpc/README.md) |
| OAuth | [Better Auth](.neander/blocks/better-auth/README.md) |

Managed production database metadata uses the existing recipe contract:

```yaml
- service: web
  name: DATABASE_URL
  required: true
  source: provisioned
  provider: Neon
```

For local work, follow the [Drizzle development database setup](.neander/blocks/drizzle/README.md#local-development-database): local Docker PostgreSQL, an existing system PostgreSQL database, or separately attached development Neon. Never use production database credentials in local chat, templates or recipe sandboxes. Schema migrations are explicit, additive operations before app rollout; they must not run during Docker build or every application startup. A database change is not reversed by an application rollback.

Origin-dependent server variables declare provider `Neander`, binding `public_origin`, and an optional path. For example, `BETTER_AUTH_URL` can bind to the origin and `BACKEND_URI` to `/api`. Keep browser calls same-origin and do not bake secrets or callback origins into `NEXT_PUBLIC_*`/`VITE_*` values. OAuth provider client credentials remain user input; registering a provider callback still requires the provider's setup.

Upstream integrations: [Drizzle and Neon](https://orm.drizzle.team/docs/get-started/neon-new), [tRPC Next route handler](https://trpc.io/docs/server/adapters/fetch), [Better Auth installation](https://www.better-auth.com/docs/installation), [SQLAlchemy PostgreSQL](https://docs.sqlalchemy.org/en/20/dialects/postgresql.html), [Alembic tutorial](https://alembic.sqlalchemy.org/en/latest/tutorial.html), [Authlib Starlette OAuth](https://docs.authlib.org/en/latest/client/starlette.html).

## Prior integration certification, 9 September 2026

This record covers the source examples before extraction; this repository's CI checks the base production container. Add-on changes must repeat the block-specific validation below.

The example files were installed into standalone temporary copies with exact direct versions and generated lockfiles. Both ORM histories applied twice to isolated PostgreSQL; CRUD, invalid input and persistence across application process restarts passed. tRPC accepted a valid HTTP call and rejected invalid input both at runtime and in a TypeScript check. Full Next.js ORM/tRPC/auth and Python ORM/auth Docker builds passed without runtime credentials in the build context; both production containers passed frontend/health smoke checks. CRUD data and authenticated sessions survived actual container restarts on both stacks.

Auth checks use disposable seeded database sessions, never a test bypass in the application. Better Auth rejects anonymous/tampered cookies and untrusted-origin logout, and revokes sessions on logout. Authlib rejects anonymous sessions, forged callback state, malformed origins and untrusted-origin logout. Public Google discovery produced a state-protected S256 PKCE redirect with the configured callback. Real Google account login/callback remains unverified until credentials and provider callback registration are supplied. Run the block's `.neander/check-auth` script only against an isolated development database.
