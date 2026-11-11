# Next.js + TypeScript

Use Node 24 and pnpm 11.18.0. Run `pnpm install --frozen-lockfile`, then `pnpm dev` (http://localhost:3000). `pnpm check` checks types; `pnpm build` prepares the production standalone output. No credentials or external services are required.

Publish uses `.neander/compose.yaml`. For local production verification, run `docker build -f .neander/Dockerfile -t my-next-app .` and `docker run --rm -p 8080:8080 my-next-app`. `/api/health` returns JSON. `public/` and `.next/static` are copied explicitly into the runtime image.

Add database/auth/API dependencies only when requested. Use server-side runtime environment variables for callback and backend origins; `NEXT_PUBLIC_*` values are frozen during the build. Keep browser calls relative to `/api`. Never commit `.env` files with credentials. Stack provenance is in `docs/architecture/stack-decision.md`.

When adding persistence, follow the [Drizzle development database setup](.neander/blocks/drizzle/README.md#local-development-database): use local Docker PostgreSQL, an existing development PostgreSQL instance, or optional managed development Neon. The opt-in local Compose file is separate from the production recipe; a bare starter does not start a database.


## Maintenance and verification

This private Neander template repository owns the application, pinned lockfiles, deployment recipe, and [incremental building blocks](add-ons.md). Changes are reviewed here independently of the Neander application. New projects take a one-time copy of a selected commit; starter updates never overwrite existing projects.

Run from this repository root:

```sh
docker build -f .neander/Dockerfile -t neander-starter-nextjs:local .
python3 scripts/test_entrypoint.py
docker run --detach --name starter-check --publish 127.0.0.1:8080:8080 neander-starter-nextjs:local
python3 scripts/smoke.py http://127.0.0.1:8080
docker rm --force starter-check
```

The CI workflow runs these base container checks on every pull request and main push. It requires no cloud credentials or database. After installing a database block, use `python3 scripts/check-addon-crud.py ORIGIN`, restart the disposable app, then repeat with its printed ID to check persistence and delete the test row. Follow the block's README for migrations and authentication checks.

Pinned dependencies, production recipes, and building blocks were preserved during extraction from Neander. Repeat production certification when dependencies or base-image tags change; local container checks do not establish Cloud Run latency or real OAuth-provider login. No open-source license is granted by this private repository.

## Keeping Publish ready

Follow [the deployment contract](docs/deployment-contract.md) when adding database or authentication features. Each block includes a complete production recipe example; merge it in the same change as the implementation. The base starter remains database-free.
