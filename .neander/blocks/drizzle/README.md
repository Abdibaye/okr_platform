# Drizzle + managed Neon, version 1

Add only when persistence is requested. `pnpm add drizzle-orm@0.45.2 pg@8.23.0 @next/env@16.3.4`; `pnpm add -D drizzle-kit@0.31.10 @types/pg@8.23.1`.

Copy this block's `.example` files to their shown paths relative to the project root, removing only the `.example` suffix. Create parent directories. Merge files if the app already has those paths; never replace user code. The sample `/api/todos` is intentionally public until authentication is added; do not use it for private records.

For development, choose the local PostgreSQL workflow below, an existing system PostgreSQL database, or Neander's **Attach managed Neon** button. Add the required provisioned Neon `DATABASE_URL` entry to `x-neander.environment` for production. No production credential belongs in local `.env.local`.

## Local development database

Only install this block when persistence is requested. The bare starter needs no database. If Docker is available, copy the opt-in development Compose file to the project root without overwriting an existing file:

```sh
cp -n .neander/blocks/drizzle/compose.dev.yaml.example compose.dev.yaml
docker compose -p YOUR_UNIQUE_PROJECT -f compose.dev.yaml up -d --wait
```

Inspect and merge an existing `compose.dev.yaml` instead of replacing it. The default port is `127.0.0.1:55432`; if occupied, use `PGPORT=55433 docker compose -p YOUR_UNIQUE_PROJECT -f compose.dev.yaml up -d --wait` and use that port in the connection URL. Keep the same override for subsequent Compose commands. The named volume is scoped to the explicit Compose project. Replace `YOUR_UNIQUE_PROJECT` with a stable unique name for this project and use it on every command.

Add this line to the gitignored `.env.local`, preserving other variables and any existing database configuration:

```dotenv
DATABASE_URL=postgresql://neander_dev:neander_dev_only@127.0.0.1:55432/neander_dev
```

These fixed credentials are only for the loopback development container. Never copy this URL into deployment settings. Alternatively, use an existing local PostgreSQL database and put its application-role connection URL in `.env.local`; skip Docker startup. Confirm it is a development database before applying migrations. Neander can also attach an isolated development Neon database through its deployment environment panel; that is optional for local work.

If a local PostgreSQL server is already running and your existing role can create databases, provision a project-specific development database. Replace the uppercase placeholders with your local role and project name; skip creation if that database already exists:

```sh
createdb --host=127.0.0.1 --port=5432 --username=YOUR_LOCAL_ROLE YOUR_PROJECT_dev
```

Set `.env.local` to `DATABASE_URL=postgresql://YOUR_LOCAL_ROLE:YOUR_LOCAL_PASSWORD@127.0.0.1:5432/YOUR_PROJECT_dev`, using the server's actual authentication and URL-encoding password characters as needed. Do not create or change system roles to follow this example; use Docker above if no suitable local server/role exists.

After installing the block's dependencies and files, migrate and start the app. An exported `DATABASE_URL` overrides `.env.local`; remove it in the development shell first so an ambient production connection cannot be used:

```sh
unset DATABASE_URL
node --env-file=.env.local .neander/migrate.mjs
pnpm dev
```

Next.js loads `.env.local`; restart the app after changing it. In another terminal, test the sample API:

```sh
python3 scripts/check-addon-crud.py http://127.0.0.1:3000
```

Stop and restart `pnpm dev`, then rerun the script with the printed ID as its second argument. It verifies the updated row survived and deletes only that test row. Adapt the smoke check if you replaced the sample `/api/todos` API. Local PostgreSQL success proves local connectivity, migrations and persistence; it does not prove managed Neon provisioning or a production deployment.

When finished, stop the local database while keeping its data:

```sh
docker compose -p YOUR_UNIQUE_PROJECT -f compose.dev.yaml down
```

Do not add `--volumes` or automatically reset the database. A later `up -d --wait` reuses the named volume. See Docker's [PostgreSQL image](https://hub.docker.com/_/postgres), [startup health wait](https://docs.docker.com/reference/cli/docker/compose/up/), and [volume-preserving shutdown](https://docs.docker.com/reference/cli/docker/compose/down/).

## Migrations and production

The block includes the first additive migration and its Drizzle history. After adding schema changes, generate an additive migration with `pnpm exec drizzle-kit generate`, inspect its SQL, and commit the generated `drizzle/` directory. If pnpm requests build approval for Drizzle Kit, approve only `esbuild` with `pnpm approve-builds esbuild` and commit the resulting `pnpm-workspace.yaml`. Change the Dockerfile dependency-layer COPY to `COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./` so frozen production installs use the same narrow approval. Apply development migrations explicitly with `node --env-file=.env.local .neander/migrate.mjs`. The same fixed command without `--env-file` is for the isolated production migration action with only its database credential. Never run it during Docker build or application startup. The script uses Drizzle history and a PostgreSQL advisory lock; a concurrent migration fails instead of racing. Do not use `drizzle-kit push` on managed production.

Verify `pnpm build` without `DATABASE_URL`; then run with the development URI. POST `/api/todos` with `{"title":"Persist me"}`, PATCH its `id` with `{"done":true}`, restart the app and GET to verify persistence, then DELETE `?id=<id>`. Invalid titles/IDs must return 400. Follow [Drizzle PostgreSQL](https://orm.drizzle.team/docs/get-started-postgresql) and [versioned migrations](https://orm.drizzle.team/docs/migrations).

Declare `migration: nextjs-drizzle` directly under `x-neander` when the migration files are present. Publish then runs that fixed profile in the isolated database-only migration step before application rollout. Do not add arbitrary shell commands to Compose.

## Maintained deployment recipe

This block includes `.neander/compose.yaml.example`, a complete recipe including its database prerequisites. Merge its `x-neander` declarations into the project's `.neander/compose.yaml` as you install the block; do not replace existing services, probes or application-specific requirements. Every environment entry includes `service`, `name`, `required`, `source` and `provider`. The `provider: null` field is mandatory for generated and user-supplied values. Keep the matching migration profile and commit its source files and lockfile in the same change.

Read `docs/deployment-contract.md` before changing database or authentication setup. Keep the public health endpoint accessible when protecting application pages. A valid recipe goes directly to Cloud Run Compose; adding an add-on must not depend on a recipe agent to reconstruct this metadata at Publish time.

Use one stable, unique project name in place of `YOUR_UNIQUE_PROJECT` on **every** Compose command. Always pass both `-p` and `-f`; inherited `COMPOSE_PROJECT_NAME` or `COMPOSE_FILE` must not select another project. Use a different free host port for each concurrently running database.
